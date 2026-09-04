import { readFileSync, writeFileSync } from 'node:fs';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { logger } from '@/utils/logger';

export interface WhisperResult {
  language: string;
  duration: number;
  text: string;
  words: WordTimestamp[];
}

export class WhisperClient {
  /**
   * Transcribe an audio file using OpenAI-compatible Whisper API / Voice Compute.
   */
  static async transcribe(
    audioPath: string,
    options: {
      language?: string;
      model?: string;
      outputJson?: string;
      apiUrl?: string;
      apiKey?: string;
    } = {}
  ): Promise<WhisperResult> {
    const lang = options.language || 'id';
    const outJson = options.outputJson || `${audioPath.replace(/\.[^/.]+$/, '')}.whisper.json`;
    const apiUrl = options.apiUrl || config.voiceComputeUrl || 'http://localhost:8880';
    const apiKey = options.apiKey || config.voiceComputeApiKey;

    logger.info(`Sending audio to Whisper STT API (${apiUrl})...`);

    try {
      const result = await WhisperClient.transcribeViaApi(
        audioPath,
        apiUrl,
        apiKey,
        lang,
        options.model || 'large-v3'
      );
      writeFileSync(outJson, JSON.stringify(result, null, 2), 'utf-8');
      return result;
    } catch (err: any) {
      throw new Error(
        `Failed to connect to Whisper API at ${apiUrl}: ${err.message}.\nMake sure Voice Compute is running (https://github.com/nouverse/voice-compute) or set NOUCLIP_VOICE_COMPUTE_URL to a valid OpenAI-compatible Whisper endpoint.`
      );
    }
  }

  private static async transcribeViaApi(
    audioPath: string,
    apiUrl: string,
    apiKey: string | undefined,
    language: string,
    model: string
  ): Promise<WhisperResult> {
    const endpoint = `${apiUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`;
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

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as any;

    const rawWords = data.words || [];
    const normalizedWords: WordTimestamp[] = rawWords.map((w: any) => ({
      word: w.word,
      start: typeof w.start === 'number' ? w.start : Number.parseFloat(w.start || '0'),
      end: typeof w.end === 'number' ? w.end : Number.parseFloat(w.end || '0'),
      probability: w.probability
    }));

    return {
      language: data.language || language,
      duration: data.duration || 0,
      text: data.text || '',
      words: normalizedWords
    };
  }
}
