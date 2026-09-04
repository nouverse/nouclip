import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { WhisperClient } from '@/core/whisper';
import { logger } from '@/utils/logger';

export async function extractCommand(
  videoPath: string,
  options: {
    lang?: string;
    output?: string;
    model?: string;
  }
) {
  config.ensureDirs();
  const input = resolve(videoPath);
  if (!existsSync(input)) {
    logger.error(`File not found: ${input}`);
    process.exit(1);
  }

  const baseName = basename(input, extname(input));

  let wavPath = input;
  if (!input.endsWith('.wav')) {
    logger.info(`Extracting audio from ${input}...`);
    wavPath = join(config.segmentDir, `${baseName}.temp.wav`);
    await FFmpegRunner.extractAudio(input, wavPath);
    logger.success(`Audio extracted: ${wavPath}`);
  }

  const jsonPath = options.output
    ? resolve(options.output)
    : join(config.transcriptDir, `${baseName}.whisper.json`);

  logger.info(`Running Whisper transcription (${options.lang || 'id'})...`);

  try {
    const result = await WhisperClient.transcribe(wavPath, {
      language: options.lang || 'id',
      model: options.model,
      outputJson: jsonPath
    });

    logger.success(`Transcription completed (${result.words.length} words detected)`);
    logger.info(`Output JSON saved to: ${jsonPath}`);
  } catch (err: any) {
    logger.error(`Extraction failed: ${err.message}`);
    process.exit(1);
  }
}
