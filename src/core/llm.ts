import { config } from '@/core/config';

export interface ClipHighlight {
  title: string;
  hook: string;
  start: number;
  end: number;
  duration: number;
  /** 1-100 */
  viralityScore: number;
  reason: string;
}

export interface HighlightAnalysisResult {
  clips: ClipHighlight[];
}

export interface LLMConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
}

export interface FindHooksOptions {
  maxClips?: number;
  targetMinDuration?: number;
  targetMaxDuration?: number;
}

export class LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;

  constructor(cfg: LLMConfig = {}) {
    this.baseUrl = cfg.baseUrl || config.openAiLlmUrl;
    this.apiKey = cfg.apiKey || config.openAiLlmApiKey;
    this.model = cfg.model || config.openAiLlmModel;
    this.temperature = cfg.temperature ?? 0.3;
  }

  static buildSystemPrompt(maxClips: number, minDur: number, maxDur: number): string {
    return `You are an elite short-form video editor and viral hook strategist for TikTok, YouTube Shorts, and Instagram Reels.
Your task is to analyze long-form transcripts with precise timestamps and identify the top ${maxClips} most engaging, high-retention clip segments.

CRITICAL RULES:
1. Clip duration MUST be between ${minDur}s and ${maxDur}s.
2. The start timestamp MUST begin with a punchy hook (controversial statement, relatable problem, strong insight, or engaging question).
3. The end timestamp MUST conclude a complete thought or punchline (NEVER cut off mid-sentence).
4. Extract timestamps ONLY from the provided word-level timing data.
5. Return strictly valid JSON conforming to the requested schema.`;
  }

  static buildUserPrompt(
    transcriptText: string,
    words: { word: string; start: number; end: number }[],
    maxClips: number
  ): string {
    const sample = words.slice(0, 500);
    const remainder =
      words.length > 500
        ? `... [and ${words.length - 500} more words till ${words[words.length - 1]?.end}s]`
        : '';

    return `Here is the transcript summary and word timestamps:
TRANSCRIPT SUMMARY:
"${transcriptText.slice(0, 4000)}"

WORD-LEVEL TIMESTAMPS SAMPLE:
${JSON.stringify(sample)}
${remainder}

Find the top ${maxClips} viral clips. Return a JSON object with this exact structure:
{
  "clips": [
    {
      "title": "Short punchy headline",
      "hook": "First opening sentence acting as the hook",
      "start": 12.4,
      "end": 48.2,
      "duration": 35.8,
      "viralityScore": 95,
      "reason": "Why this moment hooks the viewer and retains attention"
    }
  ]
}`;
  }

  /**
   * Extracts the clips array from a model response.
   * Tolerates prose-wrapped or fenced JSON, which small local models emit
   * even when asked for `response_format: json_object`.
   */
  static parseClipsResponse(content: string): ClipHighlight[] {
    const candidates = [content];
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) candidates.push(fenced[1]);
    const braced = content.match(/\{[\s\S]*\}/);
    if (braced) candidates.push(braced[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Partial<HighlightAnalysisResult>;
        if (Array.isArray(parsed?.clips)) {
          return parsed.clips.filter(
            (clip) => Number.isFinite(clip?.start) && Number.isFinite(clip?.end)
          );
        }
      } catch {
        /* try the next candidate */
      }
    }

    return [];
  }

  /**
   * Analyze a transcript with any OpenAI-compatible LLM endpoint
   * (OpenAI, Groq, OpenRouter, Ollama, local models, etc.) to detect viral
   * moments with clean start/end timestamps.
   */
  async findViralHooks(
    transcriptText: string,
    words: { word: string; start: number; end: number }[],
    options: FindHooksOptions = {}
  ): Promise<ClipHighlight[]> {
    const maxClips = options.maxClips || 5;
    const minDur = options.targetMinDuration || 20;
    const maxDur = options.targetMaxDuration || 60;

    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: LLMClient.buildSystemPrompt(maxClips, minDur, maxDur) },
          {
            role: 'user',
            content: LLMClient.buildUserPrompt(transcriptText, words, maxClips)
          }
        ],
        response_format: { type: 'json_object' },
        temperature: this.temperature
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return LLMClient.parseClipsResponse(data.choices?.[0]?.message?.content || '{}');
  }
}
