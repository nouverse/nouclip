import { resolve } from 'node:path';
import { config } from '@/core/config';
import { YouTubeDownloader } from '@/core/youtube';
import { CliError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { parseTimestamp } from '@/utils/time';

export interface DownloadCommandOptions {
  start?: string;
  end?: string;
  output?: string;
  dir?: string;
  force?: boolean;
}

export async function downloadCommand(url: string, options: DownloadCommandOptions = {}) {
  if (!YouTubeDownloader.isYouTubeUrl(url)) {
    throw new CliError(`Invalid YouTube URL: ${url}`);
  }

  config.ensureDirs();

  let section: { start: number; end: number } | undefined;
  if (options.start || options.end) {
    if (!options.start || !options.end) {
      throw new CliError('Section download needs both --start and --end.');
    }
    const start = parseTimestamp(options.start);
    const end = parseTimestamp(options.end);
    if (end <= start) {
      throw new CliError(`Invalid section: --end (${options.end}) must be after --start.`);
    }
    section = { start, end };
  }

  const downloadedPath = await YouTubeDownloader.download(url, {
    outputDir: options.dir ? resolve(options.dir) : config.downloadDir,
    outputFileName: options.output,
    force: options.force,
    section
  });

  logger.success(`Downloaded to: ${downloadedPath}`);
}
