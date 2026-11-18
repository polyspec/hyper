// The end of a command of the recipe check (HYR-8): the findings are printed one per line, the passing line is printed
// when there is none, and an error that the command throws is the finding CHECK_ERROR with its message.

/** Prints `findings`, or `passed` when there is none, and returns the exit status of the command. */
export function report(findings: string[], passed: string): number {
  for (const finding of findings) process.stdout.write(`${finding}\n`);
  if (findings.length === 0) process.stdout.write(`${passed}\n`);
  return findings.length === 0 ? 0 : 1;
}

/** Runs `main` and sets its exit status, or prints CHECK_ERROR and sets 1 when it throws. */
export function runCommand(main: () => number): void {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stdout.write(`CHECK_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
