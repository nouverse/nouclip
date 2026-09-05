import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '@/core/config';

/**
 * Resolves video or media input path intelligently.
 * Checks:
 * 1. Absolute / Relative path anywhere on system (e.g. /mnt/nas/video.mp4, ./video.mp4)
 * 2. Inside downloads dir (~/.nouclip/downloads/video.mp4)
 * 3. Inside segments dir (~/.nouclip/segments/video.mp4)
 * 4. Inside output dir (~/.nouclip/output/video.mp4)
 */
export function resolveMediaInput(inputPath: string): string {
  if (!inputPath) return inputPath;

  // 1. Direct path check
  const direct = resolve(inputPath);
  if (existsSync(direct)) {
    return direct;
  }

  // 2. Check within configured downloads dir
  const inDownloads = join(config.downloadDir, inputPath);
  if (existsSync(inDownloads)) {
    return inDownloads;
  }

  // 3. Check within segments dir
  const inSegments = join(config.segmentDir, inputPath);
  if (existsSync(inSegments)) {
    return inSegments;
  }

  // 4. Check within output dir
  const inOutput = join(config.outputDir, inputPath);
  if (existsSync(inOutput)) {
    return inOutput;
  }

  // 5. Check within transcripts dir (if asking for json/ass)
  const inTranscripts = join(config.transcriptDir, inputPath);
  if (existsSync(inTranscripts)) {
    return inTranscripts;
  }

  return direct;
}
