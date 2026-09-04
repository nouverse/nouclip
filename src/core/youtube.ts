import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { logger } from '@/utils/logger';

export class YouTubeDownloader {
  static isYouTubeUrl(url: string): boolean {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/.test(url);
  }

  /**
   * Extract YouTube Video ID from URL.
   */
  static extractVideoId(url: string): string | null {
    const match = url.match(
      /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/
    );
    return match ? match[1] : null;
  }

  /**
   * Check if a YouTube video has already been downloaded in the output directory.
   */
  static findExistingDownload(url: string, outputDir: string): string | null {
    if (!existsSync(outputDir)) return null;

    const videoId = YouTubeDownloader.extractVideoId(url);
    if (!videoId) return null;

    try {
      const files = readdirSync(outputDir);
      for (const file of files) {
        if (file.includes(`[${videoId}]`) && file.endsWith('.mp4')) {
          const fullPath = join(outputDir, file);
          if (existsSync(fullPath) && statSync(fullPath).size > 1024) {
            return fullPath;
          }
        }
      }
    } catch {}

    return null;
  }

  /**
   * Download a YouTube video or specific clip section via yt-dlp.
   * Reuses existing cached file if already downloaded in outputDir.
   */
  static async download(
    url: string,
    options: {
      outputDir?: string;
      outputFileName?: string;
      force?: boolean;
      section?: { start: number; end: number };
    } = {}
  ): Promise<string> {
    const outDir = options.outputDir || config.downloadDir;
    mkdirSync(outDir, { recursive: true });

    // Check download cache unless forcing re-download or downloading a specific section
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

    const ytdlp = config.ytdlpPath || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    const ffmpegDir = FFmpegRunner.getFFmpegDir();

    const args = [
      url,
      '-f',
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format',
      'mp4'
    ];

    if (ffmpegDir) {
      args.push('--ffmpeg-location', ffmpegDir);
    }

    args.push('-o', outTemplate, '--no-playlist', '--print', 'after_move:filepath');

    if (options.section) {
      const { start, end } = options.section;
      args.push('--download-sections', `*${start}-${end}`);
    }

    logger.info('Downloading video via yt-dlp...');

    return new Promise((resolve, reject) => {
      const proc = spawn(ytdlp, args);
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

      proc.on('close', (code) => {
        console.log('');
        if (code === 0) {
          const lines = stdout
            .trim()
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].endsWith('.mp4') && existsSync(lines[i])) {
              return resolve(lines[i]);
            }
          }

          if (options.outputFileName && existsSync(join(outDir, options.outputFileName))) {
            return resolve(join(outDir, options.outputFileName));
          }

          try {
            const files = readdirSync(outDir)
              .filter((f) => f.endsWith('.mp4') && !f.includes('_cut') && !f.includes('_vertical'))
              .map((f) => ({ name: f, time: statSync(join(outDir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);

            if (files.length > 0) {
              return resolve(join(outDir, files[0].name));
            }
          } catch {}

          resolve(outDir);
        } else {
          reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(-300)}`));
        }
      });
    });
  }
}
