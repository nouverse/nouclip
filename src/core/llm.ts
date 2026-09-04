import { config } from '@/core/config';

export interface ClipHighlight {
  title: string;
  hook: string;
  start: number;
  end: number;
  duration: number;
  viralityScore: number; // 1-100
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

export class LLMClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private temperature: number;

  constructor(cfg: LLMConfig = {}) {
    this.baseUrl = cfg.baseUrl || config.openAiBaseUrl;
    this.apiKey = cfg.apiKey || config.openAiApiKey;
    this.model = cfg.model || config.openAiModel;
    this.temperature = cfg.temperature ?? 0.3;
  }

  /**
   * Analyze transcript using any OpenAI-compatible LLM endpoint
   * (OpenAI, Groq, OpenRouter, Ollama, local models, etc.)
   * to detect top viral moments, hooks, and clean start/end timestamps.
   */
  async findViralHooks(
    transcriptText: string,
    words: { word: string; start: number; end: number }[],
    options: {
      maxClips?: number;
      targetMinDuration?: number;
      targetMaxDuration?: number;
    } = {}
  ): Promise<ClipHighlight[]> {
    const maxClips = options.maxClips || 5;
    const minDur = options.targetMinDuration || 20;
    const maxDur = options.targetMaxDuration || 60;

    const systemPrompt = `You are an elite short-form video editor and viral hook strategist for TikTok, YouTube Shorts, and Instagram Reels.
Your task is to analyze long-form transcripts with precise timestamps and identify the top ${maxClips} most engaging, high-retention clip segments.

CRITICAL RULES:
1. Clip duration MUST be between ${minDur}s and ${maxDur}s.
2. The start timestamp MUST begin with a punchy hook (controversial statement, relatable problem, strong insight, or engaging question).
3. The end timestamp MUST conclude a complete thought or punchline (NEVER cut off mid-sentence).
4. Extract timestamps ONLY from the provided word-level timing data.
5. Return strictly valid JSON conforming to the requested schema.`;

    const userPrompt = `Here is the transcript summary and word timestamps:
TRANSCRIPT SUMMARY:
"${transcriptText.slice(0, 4000)}"

WORD-LEVEL TIMESTAMPS SAMPLE:
${JSON.stringify(words.slice(0, 500))}
${words.length > 500 ? `... [and ${words.length - 500} more words till ${words[words.length - 1]?.end}s]` : ''}

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

    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
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
    const content = data.choices?.[0]?.message?.content || '{}';

    try {
      const parsed = JSON.parse(content) as HighlightAnalysisResult;
      return parsed.clips || [];
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as HighlightAnalysisResult;
        return parsed.clips || [];
      }
      return [];
    }
  }
}
