/**
 * Error primitives shared across commands.
 *
 * Commands throw instead of calling `process.exit` directly so they stay
 * unit-testable; `src/cli.ts` is the single place that maps an error to an
 * exit code and a rendered message.
 */

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** Narrows an unknown thrown value into a printable message. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err === null || err === undefined) return 'Unknown error';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Exit code carried by an error, defaulting to 1 for non-CliError values. */
export function getExitCode(err: unknown): number {
  return err instanceof CliError ? err.exitCode : 1;
}
