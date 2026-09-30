import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { removeQuietly } from '@/commands/extract';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { type TimeSelectionOptions, resolveTimeSelection, selectionSuffix } from '@/core/selection';
import {
  TRANSCRIPT_FORMATS,
  type TranscriptData,
  isTranscriptFormat,
  renderTranscript
} from '@/core/transcript';
import { WhisperClient } from '@/core/whisper';
import { obtainWords, parseCaptionsMode } from '@/core/words';
import { YouTubeDownloader } from '@/core/youtube';
import { CliError, getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export interface TranscriptCommandOptions extends TimeSelectionOptions {
  format?: string;
  lang?: string;
  output?: string;
  /** `auto` (default), `only` or `off` — see `CaptionsMode`. */
  captions?: string;
}

export async function transcriptCommand(
  videoOrJsonPath: string,
  options: TranscriptCommandOptions = {}
) {
  config.ensureDirs();

  const format = (options.format || 'txt').toLowerCase();
  if (!isTranscriptFormat(format)) {
    throw new CliError(
      `Unknown transcript format "${options.format}". Expected one of: ${TRANSCRIPT_FORMATS.join(', ')}.`
    );
  }

  const { data, baseName, source } = await load(videoOrJsonPath, options);

  if (data.words.length === 0) {
    throw new CliError(`No words found in transcript: ${source}`);
  }

  const outPath = options.output
    ? resolve(options.output)
    : join(config.transcriptDir, `${baseName}_transcript.${format}`);

  writeFileSync(outPath, renderTranscript(data, format, source), 'utf-8');
  logger.success(`Transcript exported (${format.toUpperCase()}): ${outPath}`);
}

/**
 * A transcript JSON is read as it is. A video — a file or a YouTube link — goes through
 * `obtainWords`: a YouTube link's own captions first, so it is often not downloaded at all.
 */
async function load(
  videoOrJson: string,
  options: TranscriptCommandOptions
): Promise<{ data: TranscriptData; baseName: string; source: string }> {
  const lang = options.lang || 'id';
  const selection = resolveTimeSelection(options);

  if (YouTubeDownloader.isYouTubeUrl(videoOrJson)) {
    const got = await obtainWords(videoOrJson, {
      lang,
      captions: parseCaptionsMode(options.captions),
      selection
    });
    return {
      data: { words: got.words, text: got.text, duration: got.duration },
      baseName: `${got.name}${selectionSuffix(selection)}`,
      source: videoOrJson
    };
  }

  const input = resolveMediaInput(videoOrJson);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${videoOrJson} (Checked: ${input})`);
  }
  const baseName = basename(input, extname(input));
  if (!input.endsWith('.json') && (selection.hasSelection || options.captions === 'only')) {
    const got = await obtainWords(input, {
      lang,
      captions: parseCaptionsMode(options.captions),
      selection
    });
    return {
      data: { words: got.words, text: got.text, duration: got.duration },
      baseName: `${baseName}${selectionSuffix(selection)}`,
      source: input
    };
  }
  return { data: await loadTranscript(input, baseName, lang), baseName, source: input };
}

async function loadTranscript(
  input: string,
  baseName: string,
  language: string
): Promise<TranscriptData> {
  if (input.endsWith('.json')) {
    logger.info(`Loading transcript from JSON: ${input}`);
    try {
      const raw = JSON.parse(readFileSync(input, 'utf-8')) as Partial<TranscriptData>;
      return {
        words: (raw.words ?? []) as WordTimestamp[],
        text: raw.text,
        duration: raw.duration
      };
    } catch (err) {
      throw new CliError(`Could not read transcript JSON ${input}: ${getErrorMessage(err)}`);
    }
  }

  logger.info(`Extracting and transcribing ${input}...`);
  const tempWav = join(config.segmentDir, `${baseName}.temp.wav`);

  try {
    await FFmpegRunner.extractAudio(input, tempWav);
    return await WhisperClient.transcribe(tempWav, { language });
  } finally {
    removeQuietly(tempWav);
  }
}
