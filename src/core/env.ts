import { existsSync, readFileSync } from 'node:fs';

/**
 * Minimal `.env` reader (no dependency, no interpolation).
 * Supports `KEY=value`, `#` comments, inline ` #` comments and quoted values.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;

    let val = trimmed.slice(eqIdx + 1).trim();

    const isQuoted =
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2);

    if (isQuoted) {
      val = val.slice(1, -1);
    } else {
      // Inline comments only apply to unquoted values.
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) {
        val = val.slice(0, commentIdx).trim();
      }
    }

    result[key] = val;
  }

  return result;
}

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  try {
    return parseEnvContent(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Copies parsed values into `process.env` without overwriting variables that
 * are already set — real environment always wins over a dotfile.
 */
export function applyEnv(
  values: Record<string, string>,
  target: NodeJS.ProcessEnv = process.env
): void {
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

/** Returns the first defined, non-empty value among the given env keys. */
export function firstEnv(
  keys: string[],
  target: NodeJS.ProcessEnv = process.env
): string | undefined {
  for (const key of keys) {
    const value = target[key];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}
