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

export interface MixBgmOptions {
  bgmVolume?: number;
  ducking?: boolean;
  hasAudio?: boolean;
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

function formatArgTime(seconds: number): string {
  return Number(seconds.toFixed(3)).toString();
}

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
          if (w > 0 && h > 0) {
            if (w >= h) {
              const height = 1080;
              const width = Math.round((height * w) / h / 2) * 2;
              return { width, height, name: `${w}:${h}` };
            }
            const width = 1080;
            const height = Math.round((width * h) / w / 2) * 2;
            return { width, height, name: `${w}:${h}` };
          }
        }
        return { width: 1080, height: 1920, name: '9:16' };
      }
    }
  }

  static aspectSlug(preset: AspectRatioPreset): string {
    return preset.name.replace(':', 'x');
  }

  // ---------------------------------------------------------------------------
  // Argument builders — pure, isolated, directly testable.
  // ---------------------------------------------------------------------------

  static buildCutArgs(
    inputPath: string,
    outputPath: string,
    start: number,
    duration: number,
    reencode = false
  ): string[] {
    const args: string[] = [
      '-y',
      '-ss',
      formatArgTime(start),
      '-i',
      inputPath,
      '-t',
      formatArgTime(duration)
    ];

    if (reencode) {
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k'
      );
    } else {
      args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
    }

    args.push(outputPath);
    return args;
  }

  static buildExtractAudioArgs(
    videoPath: string,
    outputPath: string,
    options: { sampleRate?: number; start?: number; duration?: number } = {}
  ): string[] {
    const args: string[] = ['-y'];

    if (options.start !== undefined) {
      args.push('-ss', formatArgTime(options.start));
    }
    args.push('-i', videoPath);
    if (options.duration !== undefined) {
      args.push('-t', formatArgTime(options.duration));
    }

    const sampleRate = options.sampleRate || 16000;
    args.push('-vn', '-acodec', 'pcm_s16le', '-ar', sampleRate.toString(), '-ac', '1', outputPath);
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
    const mode: FramingMode = options.mode || 'blur';

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

  static buildMixBgmArgs(
    videoPath: string,
    bgmPath: string,
    outputPath: string,
    options: MixBgmOptions = {}
  ): string[] {
    const bgmVolume = options.bgmVolume ?? 0.1;
    const ducking = options.ducking !== false;
    const hasAudio = options.hasAudio !== false;

    if (!hasAudio) {
      return [
        '-y',
        '-i',
        videoPath,
        '-stream_loop',
        '-1',
        '-i',
        bgmPath,
        '-filter_complex',
        `[1:a]volume=${bgmVolume}[aout]`,
        '-map',
        '0:v',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        outputPath
      ];
    }

    let audioFilter: string;
    if (ducking) {
      audioFilter = [
        `[1:a]volume=${bgmVolume}[bgm_vol]`,
        '[bgm_vol][0:a]sidechaincompress=threshold=0.12:ratio=4:attack=50:release=350[ducked_bgm]',
        '[0:a][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]'
      ].join(';');
    } else {
      audioFilter = [
        `[1:a]volume=${bgmVolume}[bgm_vol]`,
        '[0:a][bgm_vol]amix=inputs=2:duration=first:dropout_transition=2[aout]'
      ].join(';');
    }

    return [
      '-y',
      '-i',
      videoPath,
      '-stream_loop',
      '-1',
      '-i',
      bgmPath,
      '-filter_complex',
      audioFilter,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      outputPath
    ];
  }

  static buildTrimSilenceArgs(
    inputPath: string,
    outputPath: string,
    intervals: Array<{ start: number; end: number }>,
    hasAudio = true
  ): string[] {
    if (intervals.length === 0) {
      throw new Error('At least one speech interval is required for trimming');
    }

    if (intervals.length === 1) {
      const { start, end } = intervals[0];
      return FFmpegRunner.buildCutArgs(inputPath, outputPath, start, end - start, true);
    }

    const videoSegments: string[] = [];
    const audioSegments: string[] = [];
    const concatInputs: string[] = [];

    intervals.forEach((int, idx) => {
      videoSegments.push(
        `[0:v]trim=start=${formatArgTime(int.start)}:end=${formatArgTime(int.end)},setpts=PTS-STARTPTS[v${idx}]`
      );
      concatInputs.push(`[v${idx}]`);

      if (hasAudio) {
        audioSegments.push(
          `[0:a]atrim=start=${formatArgTime(int.start)}:end=${formatArgTime(int.end)},asetpts=PTS-STARTPTS[a${idx}]`
        );
        concatInputs.push(`[a${idx}]`);
      }
    });

    const filterParts = [...videoSegments, ...audioSegments];
    const n = intervals.length;
    const aParam = hasAudio ? 1 : 0;

    if (hasAudio) {
      filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=${aParam}[v][a]`);
      return [
        '-y',
        '-i',
        inputPath,
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        outputPath
      ];
    }

    filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=0[v]`);
    return [
      '-y',
      '-i',
      inputPath,
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
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
        // Ignored.
      }
    }
  }

  static async mixBgm(
    videoPath: string,
    bgmPath: string,
    outputPath: string,
    options: MixBgmOptions = {}
  ): Promise<void> {
    await FFmpegRunner.run(
      FFmpegRunner.getFFmpegPath(),
      FFmpegRunner.buildMixBgmArgs(videoPath, bgmPath, outputPath, options)
    );
  }

  static async trimSilence(
    inputPath: string,
    outputPath: string,
    intervals: Array<{ start: number; end: number }>,
    hasAudio = true
  ): Promise<void> {
    await FFmpegRunner.run(
      FFmpegRunner.getFFmpegPath(),
      FFmpegRunner.buildTrimSilenceArgs(inputPath, outputPath, intervals, hasAudio)
    );
  }

  // ---------------------------------------------------------------------------
  // Low-level process runner
  // ---------------------------------------------------------------------------

  /**
   * Executes a command and captures stdout.
   * Throws with the captured stderr when the exit code is non-zero.
   */
  static exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `"${basename(command)}" not found. Install FFmpeg or set NOUCLIP_FFMPEG_PATH / NOUCLIP_FFPROBE_PATH.`
            )
          );
        } else {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed (exit ${code}): ${command}\n${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /** Run a command without capturing stdout; errors still unwrap stderr. */
  static async run(command: string, args: string[]): Promise<void> {
    await FFmpegRunner.exec(command, args);
  }
}
