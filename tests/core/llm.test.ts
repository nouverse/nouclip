import { describe, expect, it } from 'bun:test';
import { LLMClient } from '@/core/llm';

const validPayload = JSON.stringify({
  clips: [
    {
      title: 'A',
      hook: 'h',
      start: 1,
      end: 2,
      duration: 1,
      viralityScore: 90,
      reason: 'r'
    }
  ]
});

describe('LLMClient.parseClipsResponse', () => {
  it('parses a clean JSON object', () => {
    expect(LLMClient.parseClipsResponse(validPayload)).toHaveLength(1);
  });

  it('recovers clips from a fenced code block', () => {
    const fenced = `Sure!\n\`\`\`json\n${validPayload}\n\`\`\``;
    expect(LLMClient.parseClipsResponse(fenced)[0].title).toBe('A');
  });

  it('recovers clips wrapped in prose', () => {
    expect(
      LLMClient.parseClipsResponse(`Here you go: ${validPayload} Hope that helps.`)
    ).toHaveLength(1);
  });

  it('drops clips with unusable timestamps', () => {
    const mixed = JSON.stringify({
      clips: [
        { title: 'bad', start: 'x', end: 2 },
        { title: 'good', start: 1, end: 2 }
      ]
    });
    expect(LLMClient.parseClipsResponse(mixed).map((c) => c.title)).toEqual(['good']);
  });

  it('returns an empty array for unusable content', () => {
    expect(LLMClient.parseClipsResponse('{}')).toEqual([]);
    expect(LLMClient.parseClipsResponse('not json at all')).toEqual([]);
    expect(LLMClient.parseClipsResponse('{"clips": "nope"}')).toEqual([]);
  });
});

describe('LLMClient prompts', () => {
  it('states the clip budget and duration bounds', () => {
    const prompt = LLMClient.buildSystemPrompt(3, 20, 45);
    expect(prompt).toContain('top 3');
    expect(prompt).toContain('between 20s and 45s');
  });

  it('truncates the transcript and samples the word list', () => {
    const words = Array.from({ length: 600 }, (_, i) => ({
      word: `w${i}`,
      start: i,
      end: i + 0.5
    }));
    const prompt = LLMClient.buildUserPrompt('x'.repeat(5000), words, 5);

    expect(prompt).toContain('and 100 more words');
    expect(prompt).not.toContain('"w500"');
    expect(prompt).toContain('"w499"');
  });

  it('omits the truncation note for short transcripts', () => {
    const prompt = LLMClient.buildUserPrompt('short', [{ word: 'a', start: 0, end: 1 }], 5);
    expect(prompt).not.toContain('more words');
  });
});

describe('LLMClient.findViralHooks', () => {
  const originalFetch = globalThis.fetch;

  it('posts to /chat/completions and returns parsed clips', async () => {
    let captured: { url: string; body: any; headers: any } | undefined;

    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = {
        url,
        body: JSON.parse(init.body as string),
        headers: init.headers
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: validPayload } }] }), {
        status: 200
      });
    }) as unknown as typeof fetch;

    try {
      const client = new LLMClient({
        baseUrl: 'https://example.com/v1/',
        apiKey: 'secret',
        model: 'test-model'
      });
      const clips = await client.findViralHooks('transcript', [{ word: 'a', start: 0, end: 1 }]);

      expect(clips).toHaveLength(1);
      expect(captured?.url).toBe('https://example.com/v1/chat/completions');
      expect(captured?.body.model).toBe('test-model');
      expect(captured?.body.messages).toHaveLength(2);
      expect(captured?.headers.Authorization).toBe('Bearer secret');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces an HTTP error with its status', async () => {
    globalThis.fetch = (async () =>
      new Response('rate limited', { status: 429 })) as unknown as typeof fetch;

    try {
      const client = new LLMClient({ baseUrl: 'https://example.com/v1', apiKey: 'k' });
      await expect(client.findViralHooks('t', [])).rejects.toThrow(/LLM API error \(429\)/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
