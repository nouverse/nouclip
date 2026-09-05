/**
 * Single source of truth for the CLI version at runtime.
 *
 * Kept in sync with package.json by `tests/version.test.ts` — bump both
 * together, CI fails otherwise.
 */
export const VERSION = '1.0.0';
