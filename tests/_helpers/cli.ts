export async function runCommand(
  script: string,
  args: string[],
  environment: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn(["bun", "run", script, ...args], {
    cwd: `${import.meta.dir}/../..`,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}
