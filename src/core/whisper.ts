import { readFileSync, writeFileSync } from 'node:fs';
import type { WordTimestamp } from '@/core/ass';
import { DEFAULTS, config } from '@/core/config';
import { getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';

export interface WhisperResult {
  language: string;
  duration: number;
  text: string;
  words: WordTimestamp[];
}

export interface TranscribeOptions {
  language?: string;
  model?: string;
  outputJson?: string;
  apiUrl?: string;
  apiKey?: string;
}

export class WhisperClient {
  /**
   * Builds the OpenAI-compatible transcription endpoint.
   * Accepts a bare host (`http://localhost:8880`), a versioned base
   * (`https://api.openai.com/v1`) or the full endpoint, so users can paste
   * whichever form their provider documents without producing `/v1/v1/...`.
   */
  static buildTranscriptionEndpoint(apiUrl: string): string {
    const base = apiUrl.trim().replace(/\/+$/, '');
    if (base.endsWith('/audio/transcriptions')) return base;
    if (/\/v\d+$/.test(base)) return `${base}/audio/transcriptions`;
    return `${base}/v1/audio/transcriptions`;
  }

  /** Coerces a provider response into {@link WhisperResult}. */
  static normalizeResponse(data: unknown, fallbackLanguage: string): WhisperResult {
    const payload = (data ?? {}) as {
      language?: string;
      duration?: number | string;
      text?: string;
      words?: Array<{
        word?: string;
        start?: number | string;
        end?: number | string;
        probability?: number;
      }>;
    };

    const toNumber = (value: number | string | undefined): number => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      const parsed = Number.parseFloat(value ?? '0');
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const words: WordTimestamp[] = (payload.words ?? [])
      .filter((w) => typeof w?.word === 'string')
      .map((w) => ({
        word: w.word as string,
        start: toNumber(w.start),
        end: toNumber(w.end),
        probability: w.probability
      }));

    return {
      language: payload.language || fallbackLanguage,
      duration: toNumber(payload.duration),
      text: payload.text ?? '',
      words
    };
  }

  /**
   * Transcribe an audio file using an OpenAI-compatible Whisper / STT API.
   */
  static async transcribe(
    audioPath: string,
    options: TranscribeOptions = {}
  ): Promise<WhisperResult> {
    const lang = options.language || 'id';
    const outJson = options.outputJson || `${audioPath.replace(/\.[^/.]+$/, '')}.whisper.json`;
    const apiUrl = options.apiUrl || config.openAiAudioUrl || DEFAULTS.audioUrl;
    const apiKey = options.apiKey || config.openAiAudioApiKey;
    const model = options.model || config.openAiAudioModel;

    logger.info(`Sending audio to Whisper / Audio STT API (${apiUrl})...`);

    let result: WhisperResult;
    try {
      result = await WhisperClient.transcribeViaApi(audioPath, apiUrl, apiKey, lang, model);
    } catch (err) {
      throw new Error(
        [
          `Failed to reach the Audio STT API at ${apiUrl}: ${getErrorMessage(err)}`,
          'Make sure Whisper STT is running (e.g. voice-compute) or set NOUCLIP_OPENAI_AUDIO_URL',
          'to a valid OpenAI-compatible speech endpoint (e.g. Groq, OpenAI).'
        ].join('\n')
      );
    }

    writeFileSync(outJson, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  }

  private static async transcribeViaApi(
    audioPath: string,
    apiUrl: string,
    apiKey: string | undefined,
    language: string,
    model: string
  ): Promise<WhisperResult> {
    const endpoint = WhisperClient.buildTranscriptionEndpoint(apiUrl);
    const audioBuffer = readFileSync(audioPath);
    const fileName = audioPath.split(/[/\\]/).pop() || 'audio.wav';

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), fileName);
    formData.append('model', model);
    formData.append('language', language);
    formData.append('word_timestamps', 'true');
    formData.append('timestamp_granularities[]', 'word');
    formData.append('response_format', 'verbose_json');

    const headers: Record<string, string> = {};
    if (apiKey && apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const res = await fetch(endpoint, { method: 'POST', headers, body: formData });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    return WhisperClient.normalizeResponse(await res.json(), language);
  }
}
