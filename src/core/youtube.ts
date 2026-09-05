import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { logger } from '@/utils/logger';

export interface DownloadSection {
  start: number;
  end: number;
}

export interface DownloadOptions {
  outputDir?: string;
  outputFileName?: string;
  force?: boolean;
  section?: DownloadSection;
}

/** Minimum size before a cached file is trusted as a complete download. */
const MIN_CACHED_BYTES = 1024;

export class YouTubeDownloader {
  static isYouTubeUrl(url: string): boolean {
    return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+$/.test(url.trim());
  }

  /** Extracts the 11-character video id from any common YouTube URL shape. */
  static extractVideoId(url: string): string | null {
    const match = url.match(
      /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/
    );
    return match ? match[1] : null;
  }

  static getYtDlpPath(): string {
    return config.ytdlpPath || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  }

  /** Checks whether this video id was already downloaded into `outputDir`. */
  static findExistingDownload(url: string, outputDir: string): string | null {
    if (!existsSync(outputDir)) return null;

    const videoId = YouTubeDownloader.extractVideoId(url);
    if (!videoId) return null;

    try {
      for (const file of readdirSync(outputDir)) {
        if (!file.includes(`[${videoId}]`) || !file.endsWith('.mp4')) continue;
        const fullPath = join(outputDir, file);
        if (existsSync(fullPath) && statSync(fullPath).size > MIN_CACHED_BYTES) {
          return fullPath;
        }
      }
    } catch {
      /* unreadable dir means no cache hit */
    }

    return null;
  }

  static buildDownloadArgs(
    url: string,
    options: { outTemplate: string; ffmpegDir?: string; section?: DownloadSection }
  ): string[] {
    const args = [
      url,
      '-f',
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format',
      'mp4'
    ];

    if (options.ffmpegDir) {
      args.push('--ffmpeg-location', options.ffmpegDir);
    }

    args.push('-o', options.outTemplate, '--no-playlist', '--print', 'after_move:filepath');

    if (options.section) {
      args.push('--download-sections', `*${options.section.start}-${options.section.end}`);
    }

    return args;
  }

  /** Picks the final file path yt-dlp printed via `--print after_move:filepath`. */
  static parsePrintedPath(
    stdout: string,
    exists: (path: string) => boolean = existsSync
  ): string | null {
    const lines = stdout
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].endsWith('.mp4') && exists(lines[i])) {
        return lines[i];
      }
    }
    return null;
  }

  /**
   * Download a YouTube video or a specific section via yt-dlp,
   * reusing a cached file when one is already present.
   */
  static async download(url: string, options: DownloadOptions = {}): Promise<string> {
    const outDir = options.outputDir || config.downloadDir;
    mkdirSync(outDir, { recursive: true });

    // Cache only applies to a plain, full-video download.
    if (!options.force && !options.section && !options.outputFileName) {
      const existing = YouTubeDownloader.findExistingDownload(url, outDir);
      if (existing) {
        logger.success(`Reusing cached download: ${existing}`);
        return existing;
      }
    }

    const outTemplate = options.outputFileName
      ? join(outDir, options.outputFileName)
      : join(outDir, '%(title).60s [%(id)s].%(ext)s');

    const ytdlp = YouTubeDownloader.getYtDlpPath();
    const args = YouTubeDownloader.buildDownloadArgs(url, {
      outTemplate,
      ffmpegDir: FFmpegRunner.getFFmpegDir(),
      section: options.section
    });

    logger.info('Downloading video via yt-dlp...');

    const stdout = await YouTubeDownloader.spawnYtDlp(ytdlp, args);

    const printed = YouTubeDownloader.parsePrintedPath(stdout);
    if (printed) return printed;

    if (options.outputFileName) {
      const explicit = join(outDir, options.outputFileName);
      if (existsSync(explicit)) return explicit;
    }

    const newest = YouTubeDownloader.findNewestVideo(outDir);
    if (newest) return newest;

    throw new Error(`yt-dlp finished but no downloaded file was found in ${outDir}`);
  }

  private static findNewestVideo(outDir: string): string | null {
    try {
      const files = readdirSync(outDir)
        .filter((f) => f.endsWith('.mp4') && !f.includes('_cut') && !f.includes('_vertical'))
        .map((f) => ({ name: f, time: statSync(join(outDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

      return files.length > 0 ? join(outDir, files[0].name) : null;
    } catch {
      return null;
    }
  }

  private static spawnYtDlp(bin: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => {
        const str = d.toString();
        stdout += str;
        if (str.includes('%')) {
          process.stdout.write(`\r  ${str.trim()}`);
        }
      });

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              'yt-dlp not found. Install it (https://github.com/yt-dlp/yt-dlp) or set NOUCLIP_YTDLP_PATH.'
            )
          );
          return;
        }
        reject(err);
      });

      proc.on('close', (code) => {
        console.log('');
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(-300)}`));
      });
    });
  }
}
