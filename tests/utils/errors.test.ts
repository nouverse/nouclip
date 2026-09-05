import { describe, expect, it } from 'bun:test';
import { CliError, getErrorMessage, getExitCode } from '@/utils/errors';

describe('CliError', () => {
  it('carries a message and default exit code', () => {
    const err = new CliError('boom');
    expect(err.message).toBe('boom');
    expect(err.exitCode).toBe(1);
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts a custom exit code', () => {
    expect(new CliError('nope', 3).exitCode).toBe(3);
  });
});

describe('getErrorMessage', () => {
  it('unwraps common thrown shapes', () => {
    expect(getErrorMessage(new Error('failed'))).toBe('failed');
    expect(getErrorMessage('raw string')).toBe('raw string');
    expect(getErrorMessage({ code: 42 })).toBe('{"code":42}');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
    expect(getErrorMessage(null)).toBe('Unknown error');
  });

  it('survives values that cannot be serialized', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(getErrorMessage(circular)).toBe('[object Object]');
  });
});

describe('getExitCode', () => {
  it('uses the CliError code, otherwise 1', () => {
    expect(getExitCode(new CliError('x', 7))).toBe(7);
    expect(getExitCode(new Error('x'))).toBe(1);
    expect(getExitCode('x')).toBe(1);
  });
});
