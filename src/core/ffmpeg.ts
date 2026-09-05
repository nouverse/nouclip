import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { config } from '@/core/config';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export type FramingMode = 'blur' | 'center' | 'pad' | 'stretch';

export const FRAMING_MODES: readonly FramingMode[] = ['blur', 'center', 'pad', 'stretch'];

export function isFramingMode(value: string): value is FramingMode {
  return (FRAMING_MODES as readonly string[]).includes(value);
}

export interface AspectRatioPreset {
  width: number;
  height: number;
  name: string;
}

export interface ReframeOptions {
  aspect?: string;
  mode?: FramingMode;
  targetWidth?: number;
  targetHeight?: number;
}

/** Shared x264 output settings so every re-encoding path stays consistent. */
const X264_OUTPUT = [
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'copy'
];

export class FFmpegRunner {
  static getFFmpegPath(): string {
    const custom = config.ffmpegPath;
    if (custom && existsSync(custom)) {
      return custom;
    }
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }

  static getFFprobePath(): string {
    const custom = config.ffprobePath;
    if (custom && existsSync(custom)) {
      return custom;
    }
    return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  }

  static getFFmpegDir(): string | undefined {
    const ffmpegPath = FFmpegRunner.getFFmpegPath();
    if (ffmpegPath.includes('/') || ffmpegPath.includes('\\')) {
      return dirname(ffmpegPath);
    }
    return undefined;
  }

  static parseAspectRatio(aspectStr = '9:16'): AspectRatioPreset {
    const clean = aspectStr.trim().toLowerCase().replace('x', ':');

    switch (clean) {
      case '9:16':
      case 'vertical':
      case 'shorts':
      case 'reels':
      case 'tiktok':
        return { width: 1080, height: 1920, name: '9:16' };
      case '1:1':
      case 'square':
      case 'feed':
        return { width: 1080, height: 1080, name: '1:1' };
      case '4:5':
      case 'portrait':
        return { width: 1080, height: 1350, name: '4:5' };
      case '16:9':
      case 'landscape':
      case 'horizontal':
        return { width: 1920, height: 1080, name: '16:9' };
      case '4:3':
        return { width: 1440, height: 1080, name: '4:3' };
      default: {
        if (clean.includes(':')) {
          const [w, h] = clean.split(':').map(Number);
          if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) {
            if (w < h) {
              const targetW = 1080;
              const targetH = Math.round((1080 * h) / w / 2) * 2;
              return { width: targetW, height: targetH, name: `${w}:${h}` };
            }
            const targetH = 1080;
            const targetW = Math.round((1080 * w) / h / 2) * 2;
            return { width: targetW, height: targetH, name: `${w}:${h}` };
          }
        }
        return { width: 1080, height: 1920, name: '9:16' };
      }
    }
  }

  /** Filesystem-safe form of an aspect name, e.g. `9:16` -> `9x16`. */
  static aspectSlug(preset: AspectRatioPreset): string {
    return preset.name.replace(':', 'x');
  }

  // ---------------------------------------------------------------------------
  // Pure argument builders (unit-tested without touching ffmpeg)
  // ---------------------------------------------------------------------------

  static buildExtractAudioArgs(
    videoPath: string,
    outputPath: string,
    options: { sampleRate?: number; start?: number; duration?: number } = {}
  ): string[] {
    const args = ['-y'];

    if (options.start !== undefined) {
      args.push('-ss', options.start.toString());
    }

    args.push('-i', videoPath);

    if (options.duration !== undefined) {
      args.push('-t', options.duration.toString());
    }

    args.push(
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      (options.sampleRate || 16000).toString(),
      '-ac',
      '1',
      outputPath
    );

    return args;
  }

  static buildCutArgs(
    inputPath: string,
    outputPath: string,
    start: number,
    duration: number,
    reencode = false
  ): string[] {
    const args = ['-y', '-ss', start.toString(), '-i', inputPath, '-t', duration.toString()];

    if (!reencode) {
      args.push('-c', 'copy', outputPath);
      return args;
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outputPath
    );
    return args;
  }

  static buildReframeArgs(
    inputPath: string,
    outputPath: string,
    options: ReframeOptions = {}
  ): string[] {
    const preset = FFmpegRunner.parseAspectRatio(options.aspect || '9:16');
    const tw = options.targetWidth || preset.width;
    const th = options.targetHeight || preset.height;
    const mode = options.mode || 'blur';

    if (mode === 'blur') {
      const filter = [
        `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},gblur=sigma=30,setsar=1[bg]`,
        `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
        '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
      ].join(';');

      return ['-y', '-i', inputPath, '-filter_complex', filter, ...X264_OUTPUT, outputPath];
    }

    let vf: string;
    if (mode === 'pad') {
      vf = `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    } else if (mode === 'stretch') {
      vf = `scale=${tw}:${th},setsar=1`;
    } else {
      vf = `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}:(iw-ow)/2:(ih-oh)/2,setsar=1`;
    }

    return ['-y', '-i', inputPath, '-vf', vf, ...X264_OUTPUT, outputPath];
  }

  /**
   * Escapes a path for use inside an ffmpeg filtergraph argument.
   * `ass=` / `subtitles=` values are parsed twice by ffmpeg, so the filter
   * metacharacters and the Windows drive colon both need a backslash.
   */
  static escapeFilterPath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/[:'[\],;]/g, (ch) => `\\${ch}`);
  }

  static buildBurnSubtitlesArgs(inputPath: string, assPath: string, outputPath: string): string[] {
    return [
      '-y',
      '-i',
      inputPath,
      '-vf',
      `ass='${FFmpegRunner.escapeFilterPath(assPath)}'`,
      ...X264_OUTPUT,
      outputPath
    ];
  }

  static buildProbeArgs(videoPath: string): string[] {
    return [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height,r_frame_rate,duration',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      videoPath
    ];
  }

  /** Turns raw `ffprobe -of json` output into {@link VideoMetadata}. */
  static parseProbeOutput(stdout: string): VideoMetadata {
    const data = JSON.parse(stdout) as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };

    const streams = data.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video') ?? streams[0] ?? {};
    const format = data.format ?? {};

    const duration = Number.parseFloat(String(video.duration ?? format.duration ?? '0'));
    const width = Number.parseInt(String(video.width ?? '0'), 10);
    const height = Number.parseInt(String(video.height ?? '0'), 10);

    let fps = 30;
    if (typeof video.r_frame_rate === 'string') {
      const [num, den] = video.r_frame_rate.split('/').map(Number);
      if (num > 0 && den > 0) fps = Math.round(num / den);
    }

    return {
      duration: Number.isFinite(duration) ? duration : 0,
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      fps,
      hasAudio: streams.some((s) => s.codec_type === 'audio')
    };
  }

  // ---------------------------------------------------------------------------
  // Process execution
  // ---------------------------------------------------------------------------

  static async getMetadata(videoPath: string): Promise<VideoMetadata> {
    const { stdout } = await FFmpegRunner.exec(
      FFmpegRunner.getFFprobePath(),
      FFmpegRunner.buildProbeArgs(videoPath)
    );

    try {
      return FFmpegRunner.parseProbeOutput(stdout);
    } catch {
      throw new Error(`Could not parse ffprobe output for ${videoPath}`);
    }
  }

  static async extractAudio(
    videoPath: string,
    outputPath: string,
    options: { sampleRate?: number; start?: number; duration?: number } = {}
  ): Promise<void> {
    await FFmpegRunner.run(
      FFmpegRunner.getFFmpegPath(),
      FFmpegRunner.buildExtractAudioArgs(videoPath, outputPath, options)
    );
  }

  static async cutVideo(
    inputPath: string,
    outputPath: string,
    start: number,
    duration: number,
    reencode = false
  ): Promise<void> {
    await FFmpegRunner.run(
      FFmpegRunner.getFFmpegPath(),
      FFmpegRunner.buildCutArgs(inputPath, outputPath, start, duration, reencode)
    );
  }

  static async reframe(
    inputPath: string,
    outputPath: string,
    options: ReframeOptions = {}
  ): Promise<void> {
    await FFmpegRunner.run(
      FFmpegRunner.getFFmpegPath(),
      FFmpegRunner.buildReframeArgs(inputPath, outputPath, options)
    );
  }

  static async cropTo916(
    inputPath: string,
    outputPath: string,
    options: { mode?: FramingMode } = {}
  ): Promise<void> {
    await FFmpegRunner.reframe(inputPath, outputPath, {
      aspect: '9:16',
      mode: options.mode || 'center'
    });
  }

  /**
   * Burns an ASS script into the video.
   *
   * The subtitle file is staged in a temp directory first: yt-dlp names files
   * after the video title, which routinely contains quotes, commas and brackets
   * that break ffmpeg's filtergraph parser even when escaped.
   */
  static async burnSubtitles(
    inputPath: string,
    assPath: string,
    outputPath: string
  ): Promise<void> {
    const stageDir = mkdtempSync(join(tmpdir(), 'nouclip-'));
    const stagedAss = join(stageDir, 'subtitles.ass');

    try {
      copyFileSync(assPath, stagedAss);
      await FFmpegRunner.run(
        FFmpegRunner.getFFmpegPath(),
        FFmpegRunner.buildBurnSubtitlesArgs(inputPath, stagedAss, outputPath)
      );
    } finally {
      try {
        rmSync(stageDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  /** Runs a binary, rejecting on a non-zero exit or a spawn failure. */
  static async run(bin: string, args: string[]): Promise<void> {
    await FFmpegRunner.exec(bin, args);
  }

  static exec(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args);
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });

      // Without this, a missing binary raises an unhandled 'error' event.
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `"${basename(bin)}" not found. Install FFmpeg or set NOUCLIP_FFMPEG_PATH / NOUCLIP_FFPROBE_PATH.`
            )
          );
          return;
        }
        reject(err);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`${basename(bin)} error (exit ${code}): ${stderr.slice(-500)}`));
      });
    });
  }
}
