import { describe, expect, test } from "bun:test";
import { apiOptions, choice, parseCommand, positiveInteger, uint32 } from "../src/cli.ts";

const command = {
  name: "example",
  description: "Exercise CLI parsing.",
  options: {
    ...apiOptions,
    requiredValue: {
      description: "Required example value",
      valueName: "value",
      required: true,
    },
    optionalValue: {
      description: "Optional example value",
      valueName: "value",
    },
  },
} as const;

describe("CLI options", () => {
  test("applies defaults and accepts both option value syntaxes", () => {
    expect(parseCommand(command, ["--required-value", "required", "--optional-value=optional"])).toEqual({
      apiUrl: "https://api-dev.hedles.io",
      requiredValue: "required",
      optionalValue: "optional",
    });
  });

  test("rejects missing, unknown, and duplicate options", () => {
    expect(() => parseCommand(command, [])).toThrow("--required-value is required");
    expect(() => parseCommand(command, ["--unknown", "value"])).toThrow("Unknown option: --unknown");
    expect(() => parseCommand(command, ["--required-value", "one", "--required-value", "two"])).toThrow(
      "--required-value may only be provided once",
    );
  });

  test("validates choice and numeric option values", () => {
    expect(choice("cosigned", "--custody-mode", ["cosigned", "custodial"])).toBe("cosigned");
    expect(() => choice("invalid", "--custody-mode", ["cosigned", "custodial"])).toThrow(
      "--custody-mode must be one of: cosigned, custodial",
    );
    expect(positiveInteger("3600", "--expires-in")).toBe(3600);
    expect(() => positiveInteger("0", "--expires-in")).toThrow("--expires-in must be a positive integer");
    expect(uint32("4294967295", "--destination-tag")).toBe(4294967295);
    expect(() => uint32("4294967296", "--destination-tag")).toThrow(
      "--destination-tag must be an integer between 0 and 4294967295",
    );
  });
});
