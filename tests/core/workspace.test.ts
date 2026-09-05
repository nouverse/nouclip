import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDirStats, listFilesInDir, normalizeAssetKind, toMB } from '@/core/workspace';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nouclip-workspace-test-'));
  writeFileSync(join(dir, 'a.mp4'), Buffer.alloc(2 * 1024 * 1024));
  writeFileSync(join(dir, 'b.json'), '{}');
  writeFileSync(join(dir, 'c.txt'), 'hello');
  mkdirSync(join(dir, 'nested'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('toMB', () => {
  it('converts bytes with the requested precision', () => {
    expect(toMB(1024 * 1024)).toBe(1);
    expect(toMB(1536 * 1024, 1)).toBe(1.5);
    expect(toMB(0)).toBe(0);
  });
});

describe('getDirStats', () => {
  it('counts files and totals their size, skipping subdirectories', () => {
    const stats = getDirStats(dir);
    expect(stats.count).toBe(3);
    expect(stats.totalSizeMB).toBeGreaterThanOrEqual(2);
  });

  it('returns zeros for a missing directory', () => {
    expect(getDirStats(join(dir, 'does-not-exist'))).toEqual({ count: 0, totalSizeMB: 0 });
  });
});

describe('listFilesInDir', () => {
  it('lists every file when no filter is given', () => {
    expect(
      listFilesInDir(dir)
        .map((f) => f.name)
        .sort()
    ).toEqual(['a.mp4', 'b.json', 'c.txt']);
  });

  it('filters by extension, case-insensitively', () => {
    expect(listFilesInDir(dir, ['.mp4']).map((f) => f.name)).toEqual(['a.mp4']);
  });

  it('excludes directories', () => {
    expect(listFilesInDir(dir).some((f) => f.name === 'nested')).toBe(false);
  });

  it('sorts newest first', () => {
    const items = listFilesInDir(dir);
    const times = items.map((i) => i.mtimeMs);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('reports an ISO modified timestamp and MB size', () => {
    const [item] = listFilesInDir(dir, ['.mp4']);
    expect(item.sizeMB).toBe(2);
    expect(item.path).toBe(join(dir, 'a.mp4'));
    expect(new Date(item.modified).toISOString()).toBe(item.modified);
  });

  it('returns an empty list for a missing directory', () => {
    expect(listFilesInDir(join(dir, 'nope'))).toEqual([]);
  });
});

describe('normalizeAssetKind', () => {
  it('accepts singular and plural spellings', () => {
    expect(normalizeAssetKind('downloads')).toBe('downloads');
    expect(normalizeAssetKind('download')).toBe('downloads');
    expect(normalizeAssetKind('Transcript')).toBe('transcripts');
    expect(normalizeAssetKind('segments')).toBe('segments');
    expect(normalizeAssetKind('outputs')).toBe('output');
    expect(normalizeAssetKind('output')).toBe('output');
  });

  it('falls back to "all"', () => {
    expect(normalizeAssetKind('all')).toBe('all');
    expect(normalizeAssetKind('whatever')).toBe('all');
  });
});
