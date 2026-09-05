import { describe, expect, it } from 'bun:test';
import { applyEnv, firstEnv, parseEnvContent } from '@/core/env';

describe('parseEnvContent', () => {
  it('parses simple assignments', () => {
    expect(parseEnvContent('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('ignores blank lines, comments and lines without "="', () => {
    expect(parseEnvContent('\n# comment\nJUNK\n  \nA=1')).toEqual({ A: '1' });
  });

  it('strips surrounding quotes', () => {
    expect(parseEnvContent(`A="hello world"\nB='single'`)).toEqual({
      A: 'hello world',
      B: 'single'
    });
  });

  it('strips inline comments from unquoted values only', () => {
    expect(parseEnvContent('A=value # trailing')).toEqual({ A: 'value' });
    expect(parseEnvContent('A="value # kept"')).toEqual({ A: 'value # kept' });
  });

  it('keeps "=" characters inside the value', () => {
    expect(parseEnvContent('TOKEN=abc=def==')).toEqual({ TOKEN: 'abc=def==' });
  });

  it('handles CRLF line endings', () => {
    expect(parseEnvContent('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('applyEnv', () => {
  it('does not overwrite variables that are already set', () => {
    const target: NodeJS.ProcessEnv = { EXISTING: 'keep' };
    applyEnv({ EXISTING: 'ignored', FRESH: 'set' }, target);
    expect(target).toEqual({ EXISTING: 'keep', FRESH: 'set' });
  });

  it('overwrites an explicitly empty variable', () => {
    const target: NodeJS.ProcessEnv = { EMPTY: '' };
    applyEnv({ EMPTY: 'x' }, target);
    expect(target.EMPTY).toBe('');
  });
});

describe('firstEnv', () => {
  const target: NodeJS.ProcessEnv = { SECOND: 'b', THIRD: 'c', BLANK: '' };

  it('returns the first key that has a non-empty value', () => {
    expect(firstEnv(['FIRST', 'SECOND', 'THIRD'], target)).toBe('b');
  });

  it('skips empty values', () => {
    expect(firstEnv(['BLANK', 'THIRD'], target)).toBe('c');
  });

  it('returns undefined when nothing matches', () => {
    expect(firstEnv(['NOPE'], target)).toBeUndefined();
  });
});
