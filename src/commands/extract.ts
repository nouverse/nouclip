import { existsSync, unlinkSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { WhisperClient } from '@/core/whisper';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
import { formatSecondsToTimestamp, parseRange, parseTimestamp } from '@/utils/time';

export async function extractCommand(
  videoPath: string,
  options: {
    range?: string;
    start?: string;
    from?: string;
    end?: string;
    to?: string;
    duration?: string;
    lang?: string;
    output?: string;
    model?: string;
    keepWav?: boolean;
  }
) {
  config.ensureDirs();
  const input = resolveMediaInput(videoPath);

  if (!existsSync(input)) {
    logger.error(`File not found: ${videoPath} (Checked: ${input})`);
    process.exit(1);
  }

  logger.info(`Source media: ${input}`);
  const baseName = basename(input, extname(input));

  let startSec = 0;
  let durSec = 0;
  let hasRange = false;

  if (options.range) {
    const parsed = parseRange(options.range);
    startSec = parsed.start;
    durSec = parsed.duration;
    hasRange = true;
  } else if (options.start || options.from) {
    startSec = parseTimestamp(options.start || options.from);
    if (options.duration) {
      durSec = parseTimestamp(options.duration);
    } else if (options.end || options.to) {
      durSec = parseTimestamp(options.end || options.to) - startSec;
    }
    hasRange = true;
  }

  const rangeSuffix = hasRange ? `_${Math.round(startSec)}s-${Math.round(startSec + durSec)}s` : '';

  const tempWav = join(config.segmentDir, `${baseName}${rangeSuffix}.temp.wav`);

  if (hasRange) {
    logger.info(
      `Extracting audio range: ${formatSecondsToTimestamp(startSec)} -> ${formatSecondsToTimestamp(startSec + durSec)} (${Math.round(durSec)}s)...`
    );
    await FFmpegRunner.extractAudio(input, tempWav, {
      start: startSec,
      duration: durSec
    });
  } else {
    logger.info(`Extracting full audio from ${input}...`);
    await FFmpegRunner.extractAudio(input, tempWav);
  }

  logger.success(`Audio ready: ${tempWav}`);

  const jsonPath = options.output
    ? resolve(options.output)
    : join(config.transcriptDir, `${baseName}${rangeSuffix}.whisper.json`);

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

    if (!options.keepWav && existsSync(tempWav)) {
      try {
        unlinkSync(tempWav);
      } catch {}
    }
  } catch (err: any) {
    logger.error(`Extraction failed: ${err.message}`);
    process.exit(1);
  }
}
