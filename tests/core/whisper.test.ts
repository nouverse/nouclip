import { describe, expect, it } from 'bun:test';
import { WhisperClient } from '@/core/whisper';

describe('WhisperClient.buildTranscriptionEndpoint', () => {
  it('appends /v1/audio/transcriptions to a bare host', () => {
    expect(WhisperClient.buildTranscriptionEndpoint('http://localhost:8880')).toBe(
      'http://localhost:8880/v1/audio/transcriptions'
    );
  });

  it('does not double the version segment on an already-versioned base', () => {
    expect(WhisperClient.buildTranscriptionEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/audio/transcriptions'
    );
    expect(WhisperClient.buildTranscriptionEndpoint('https://api.groq.com/openai/v1/')).toBe(
      'https://api.groq.com/openai/v1/audio/transcriptions'
    );
  });

  it('accepts a full endpoint unchanged', () => {
    const full = 'https://example.com/v1/audio/transcriptions';
    expect(WhisperClient.buildTranscriptionEndpoint(full)).toBe(full);
  });

  it('trims whitespace and trailing slashes', () => {
    expect(WhisperClient.buildTranscriptionEndpoint('  http://host:1234///  ')).toBe(
      'http://host:1234/v1/audio/transcriptions'
    );
  });
});

describe('WhisperClient.normalizeResponse', () => {
  it('maps a verbose_json payload', () => {
    const result = WhisperClient.normalizeResponse(
      {
        language: 'en',
        duration: 12.5,
        text: 'hello world',
        words: [{ word: 'hello', start: 0, end: 0.5, probability: 0.9 }]
      },
      'id'
    );

    expect(result).toEqual({
      language: 'en',
      duration: 12.5,
      text: 'hello world',
      words: [{ word: 'hello', start: 0, end: 0.5, probability: 0.9 }]
    });
  });

  it('coerces string timings emitted by some providers', () => {
    const result = WhisperClient.normalizeResponse(
      { duration: '30.2', words: [{ word: 'a', start: '1.25', end: '2' }] },
      'id'
    );
    expect(result.duration).toBe(30.2);
    expect(result.words[0]).toMatchObject({ start: 1.25, end: 2 });
  });

  it('falls back to the requested language and empty fields', () => {
    expect(WhisperClient.normalizeResponse({}, 'id')).toEqual({
      language: 'id',
      duration: 0,
      text: '',
      words: []
    });
    expect(WhisperClient.normalizeResponse(null, 'id').words).toEqual([]);
  });

  it('drops malformed word entries and non-numeric timings', () => {
    const result = WhisperClient.normalizeResponse(
      {
        words: [
          { start: 0, end: 1 },
          { word: 'ok', start: 'abc', end: 'def' }
        ]
      },
      'id'
    );
    expect(result.words).toEqual([{ word: 'ok', start: 0, end: 0, probability: undefined }]);
  });
});
