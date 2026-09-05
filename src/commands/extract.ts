import { existsSync, unlinkSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { type TimeSelectionOptions, resolveTimeSelection, selectionSuffix } from '@/core/selection';
import { WhisperClient } from '@/core/whisper';
import { CliError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
import { formatSecondsToTimestamp } from '@/utils/time';

export interface ExtractCommandOptions extends TimeSelectionOptions {
  lang?: string;
  output?: string;
  model?: string;
  keepWav?: boolean;
}

export async function extractCommand(videoPath: string, options: ExtractCommandOptions = {}) {
  config.ensureDirs();

  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${videoPath} (Checked: ${input})`);
  }

  logger.info(`Source media: ${input}`);
  const baseName = basename(input, extname(input));

  const selection = resolveTimeSelection(options);
  const suffix = selectionSuffix(selection);
  const tempWav = join(config.segmentDir, `${baseName}${suffix}.temp.wav`);

  if (selection.hasSelection) {
    const { start, duration } = selection;
    logger.info(
      `Extracting audio range: ${formatSecondsToTimestamp(start)} -> ${formatSecondsToTimestamp(start + duration)} (${Math.round(duration)}s)...`
    );
    await FFmpegRunner.extractAudio(input, tempWav, { start, duration });
  } else {
    logger.info(`Extracting full audio from ${input}...`);
    await FFmpegRunner.extractAudio(input, tempWav);
  }

  logger.success(`Audio ready: ${tempWav}`);

  const jsonPath = options.output
    ? resolve(options.output)
    : join(config.transcriptDir, `${baseName}${suffix}.whisper.json`);

  logger.info(`Running Whisper transcription (${options.lang || 'id'})...`);

  try {
    const result = await WhisperClient.transcribe(tempWav, {
      language: options.lang || 'id',
      model: options.model,
      outputJson: jsonPath
    });

    logger.success(`Transcription completed (${result.words.length} words detected)`);
    console.log('📝 Output JSON saved to:');
    console.log(`👉 ${jsonPath}`);
  } finally {
    if (!options.keepWav) {
      removeQuietly(tempWav);
    }
  }
}

/** Best-effort temp-file cleanup: never masks the original failure. */
export function removeQuietly(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    /* leave the temp file behind rather than failing the command */
  }
}
