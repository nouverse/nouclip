import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveMediaInput } from '@/utils/path';

let root: string;
let downloads: string;
let segments: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nouclip-path-test-'));
  downloads = join(root, 'downloads');
  segments = join(root, 'segments');
  mkdirSync(downloads);
  mkdirSync(segments);
  writeFileSync(join(downloads, 'a.mp4'), 'x');
  writeFileSync(join(segments, 'a.mp4'), 'x');
  writeFileSync(join(segments, 'only-here.mp4'), 'x');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveMediaInput', () => {
  it('returns an existing absolute path as-is', () => {
    const direct = join(downloads, 'a.mp4');
    expect(resolveMediaInput(direct, [segments])).toBe(direct);
  });

  it('finds a bare filename inside a search directory', () => {
    expect(resolveMediaInput('only-here.mp4', [downloads, segments])).toBe(
      join(segments, 'only-here.mp4')
    );
  });

  it('respects search-directory precedence', () => {
    expect(resolveMediaInput('a.mp4', [downloads, segments])).toBe(join(downloads, 'a.mp4'));
    expect(resolveMediaInput('a.mp4', [segments, downloads])).toBe(join(segments, 'a.mp4'));
  });

  it('falls back to the resolved direct path so callers can report it', () => {
    expect(resolveMediaInput('nope.mp4', [downloads])).toBe(resolve('nope.mp4'));
  });

  it('passes empty input straight through', () => {
    expect(resolveMediaInput('', [downloads])).toBe('');
  });
});
