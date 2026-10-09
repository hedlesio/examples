import { DEFAULT_API_URL } from "./config.ts";

type OptionDefinition = {
  description: string;
  valueName: string;
  required?: true;
  repeatable?: true;
  defaultValue?: string;
};

type OptionDefinitions = Record<string, OptionDefinition>;

type ParsedOptions<T extends OptionDefinitions> = {
  [K in keyof T]: T[K] extends { repeatable: true }
    ? string[]
    : T[K] extends { required: true }
      ? string
      : T[K] extends { defaultValue: string }
        ? string
        : string | undefined;
};

type CommandDefinition<T extends OptionDefinitions> = {
  name: string;
  description: string;
  options: T;
};

export const apiOptions = {
  apiUrl: {
    description: "API base URL",
    valueName: "url",
    defaultValue: DEFAULT_API_URL,
  },
} as const;

export const authenticatedOptions = {
  ...apiOptions,
  organizationId: {
    description: "Organization ID; auto-discovered if omitted",
    valueName: "id",
  },
} as const;

function flagName(name: string): string {
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function helpText<T extends OptionDefinitions>(command: CommandDefinition<T>): string {
  const options = Object.entries(command.options).map(([name, definition]) => {
    const flag = `${flagName(name)} <${definition.valueName}>`;
    const qualifiers = [
      definition.required ? "required" : undefined,
      definition.repeatable ? "repeatable" : undefined,
      definition.defaultValue === undefined ? undefined : `default: ${definition.defaultValue}`,
    ].filter(Boolean);
    const description =
      qualifiers.length === 0
        ? definition.description
        : `${definition.description} (${qualifiers.join(", ")})`;
    return { flag, description };
  });
  const width = Math.max("--help".length, ...options.map(({ flag }) => flag.length));
  const lines = options.map(({ flag, description }) => `  ${flag.padEnd(width)}  ${description}`);
  lines.push(`  ${"--help".padEnd(width)}  Show this help`);
  return [`Usage: bun run ${command.name} [options]`, "", command.description, "", "Options:", ...lines].join(
    "\n",
  );
}

export function parseCommand<T extends OptionDefinitions>(
  command: CommandDefinition<T>,
  argv = Bun.argv.slice(2),
): ParsedOptions<T> | undefined {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(helpText(command));
    return undefined;
  }

  const definitions = new Map(
    Object.entries(command.options).map(([name, definition]) => [flagName(name), { name, definition }]),
  );
  const values: Record<string, string | string[]> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);

    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const match = definitions.get(flag);
    if (!match) throw new Error(`Unknown option: ${flag}`);

    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const nextValue = inlineValue ?? argv[index + 1];
    if (!nextValue || (inlineValue === undefined && nextValue.startsWith("--"))) {
      throw new Error(`${flag} requires a value`);
    }
    if (inlineValue === undefined) index += 1;

    const existing = values[match.name];
    if (match.definition.repeatable) {
      values[match.name] = Array.isArray(existing) ? [...existing, nextValue] : [nextValue];
      continue;
    }
    if (existing !== undefined) throw new Error(`${flag} may only be provided once`);
    values[match.name] = nextValue;
  }

  for (const [name, definition] of Object.entries(command.options)) {
    if (definition.repeatable) {
      if (values[name] === undefined) values[name] = [];
      if (definition.required && (values[name] as string[]).length === 0) {
        throw new Error(`${flagName(name)} is required`);
      }
      continue;
    }
    if (values[name] === undefined && definition.defaultValue !== undefined) {
      values[name] = definition.defaultValue;
    }
    if (definition.required && values[name] === undefined) {
      throw new Error(`${flagName(name)} is required`);
    }
  }

  return values as ParsedOptions<T>;
}

export function choice<const T extends readonly string[]>(
  value: string,
  flag: string,
  allowed: T,
): T[number] {
  if (!allowed.includes(value)) throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
  return value as T[number];
}

export function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function uint32(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
    throw new Error(`${flag} must be an integer between 0 and 4294967295`);
  }
  return parsed;
}
