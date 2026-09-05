import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface FileItem {
  name: string;
  path: string;
  sizeMB: number;
  modified: string;
  mtimeMs: number;
}

export interface DirStats {
  count: number;
  totalSizeMB: number;
}

export const ASSET_EXTENSIONS = {
  downloads: ['.mp4', '.mkv', '.webm'],
  transcripts: ['.json', '.ass', '.srt', '.vtt', '.txt'],
  segments: ['.mp4'],
  output: ['.mp4']
} as const;

export type AssetKind = keyof typeof ASSET_EXTENSIONS;

/** Canonical asset kind for a user-supplied `list` argument (`ls outputs`). */
export function normalizeAssetKind(input: string): AssetKind | 'all' {
  const type = input.trim().toLowerCase().replace(/s$/, '');
  switch (type) {
    case 'download':
      return 'downloads';
    case 'transcript':
      return 'transcripts';
    case 'segment':
      return 'segments';
    case 'output':
      return 'output';
    default:
      return 'all';
  }
}

export function toMB(bytes: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((bytes / (1024 * 1024)) * factor) / factor;
}

export function getDirStats(dirPath: string): DirStats {
  if (!existsSync(dirPath)) return { count: 0, totalSizeMB: 0 };

  try {
    let totalBytes = 0;
    let count = 0;

    for (const name of readdirSync(dirPath)) {
      try {
        const s = statSync(join(dirPath, name));
        if (s.isFile()) {
          totalBytes += s.size;
          count++;
        }
      } catch {
        /* skip unreadable entries */
      }
    }

    return { count, totalSizeMB: toMB(totalBytes, 1) };
  } catch {
    return { count: 0, totalSizeMB: 0 };
  }
}

/** Lists files in a directory, newest first, optionally filtered by extension. */
export function listFilesInDir(dirPath: string, filterExt?: readonly string[]): FileItem[] {
  if (!existsSync(dirPath)) return [];

  try {
    return readdirSync(dirPath)
      .filter((f) => !filterExt || filterExt.some((ext) => f.toLowerCase().endsWith(ext)))
      .flatMap((name) => {
        const full = join(dirPath, name);
        try {
          const s = statSync(full);
          if (!s.isFile()) return [];
          return [
            {
              name,
              path: full,
              sizeMB: toMB(s.size),
              modified: new Date(s.mtimeMs).toISOString(),
              mtimeMs: s.mtimeMs
            }
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}
