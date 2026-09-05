import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '@/core/config';

/**
 * Resolves a media/asset argument against the workspace.
 *
 * Lookup order:
 * 1. The path as given (absolute or relative to cwd)
 * 2. downloads dir
 * 3. segments dir
 * 4. output dir
 * 5. transcripts dir
 *
 * Falls back to the resolved direct path so callers can report a concrete
 * location in their "not found" message.
 */
export function resolveMediaInput(
  inputPath: string,
  searchDirs: string[] = [
    config.downloadDir,
    config.segmentDir,
    config.outputDir,
    config.transcriptDir
  ]
): string {
  if (!inputPath) return inputPath;

  const direct = resolve(inputPath);
  if (existsSync(direct)) return direct;

  for (const dir of searchDirs) {
    const candidate = join(dir, inputPath);
    if (existsSync(candidate)) return candidate;
  }

  return direct;
}
