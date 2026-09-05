import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '@/version';

describe('VERSION', () => {
  it('matches the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8')) as {
      version: string;
    };

    expect(VERSION).toBe(pkg.version);
  });
});
