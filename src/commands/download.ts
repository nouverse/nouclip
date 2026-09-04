import { YouTubeDownloader } from '@/core/youtube';
import { logger } from '@/utils/logger';

export async function downloadCommand(
  url: string,
  options: {
    start?: string;
    end?: string;
    output?: string;
    dir?: string;
  }
) {
  if (!YouTubeDownloader.isYouTubeUrl(url)) {
    logger.error(`Invalid YouTube URL: ${url}`);
    process.exit(1);
  }

  const section =
    options.start && options.end
      ? {
          start: Number.parseFloat(options.start),
          end: Number.parseFloat(options.end)
        }
      : undefined;

  try {
    const downloadedPath = await YouTubeDownloader.download(url, {
      outputDir: options.dir || 'downloads',
      outputFileName: options.output,
      section
    });

    logger.success(`Downloaded to: ${downloadedPath}`);
  } catch (err: any) {
    logger.error(`Download error: ${err.message}`);
    process.exit(1);
  }
}
