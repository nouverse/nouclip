import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '@/core/config';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export type FramingMode = 'blur' | 'center' | 'pad' | 'stretch';

export interface AspectRatioPreset {
  width: number;
  height: number;
  name: string;
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
          if (w && h && !Number.isNaN(w) && !Number.isNaN(h)) {
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

  static async getMetadata(videoPath: string): Promise<VideoMetadata> {
    const ffprobe = FFmpegRunner.getFFprobePath();
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,duration',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      videoPath
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(ffprobe, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffprobe failed: ${stderr}`));
        try {
          const data = JSON.parse(stdout);
          const stream = data.streams?.[0] || {};
          const format = data.format || {};

          const duration = Number.parseFloat(stream.duration || format.duration || '0');
          const width = Number.parseInt(stream.width || '0', 10);
          const height = Number.parseInt(stream.height || '0', 10);

          let fps = 30;
          if (stream.r_frame_rate) {
            const [num, den] = stream.r_frame_rate.split('/').map(Number);
            if (num && den) fps = Math.round(num / den);
          }

          resolve({ duration, width, height, fps, hasAudio: true });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  static async extractAudio(
    videoPath: string,
    outputPath: string,
    options: { sampleRate?: number; start?: number; duration?: number } = {}
  ): Promise<void> {
    const ffmpeg = FFmpegRunner.getFFmpegPath();
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

    await FFmpegRunner.run(ffmpeg, args);
  }

  static async cutVideo(
    inputPath: string,
    outputPath: string,
    start: number,
    duration: number,
    reencode = false
  ): Promise<void> {
    const ffmpeg = FFmpegRunner.getFFmpegPath();
    const args = ['-y', '-ss', start.toString(), '-i', inputPath, '-t', duration.toString()];

    if (!reencode) {
      args.push('-c', 'copy', outputPath);
    } else {
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
    }

    await FFmpegRunner.run(ffmpeg, args);
  }

  static async reframe(
    inputPath: string,
    outputPath: string,
    options: {
      aspect?: string;
      mode?: FramingMode;
      targetWidth?: number;
      targetHeight?: number;
    } = {}
  ): Promise<void> {
    const ffmpeg = FFmpegRunner.getFFmpegPath();
    const preset = FFmpegRunner.parseAspectRatio(options.aspect || '9:16');
    const TW = options.targetWidth || preset.width;
    const TH = options.targetHeight || preset.height;
    const mode = options.mode || 'center';

    let args: string[] = [];

    if (mode === 'blur') {
      const filter = [
        `[0:v]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},gblur=sigma=30,setsar=1[bg]`,
        `[0:v]scale=${TW}:${TH}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
        '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
      ].join(';');

      args = [
        '-y',
        '-i',
        inputPath,
        '-filter_complex',
        filter,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        outputPath
      ];
    } else if (mode === 'pad') {
      const vf = `scale=${TW}:${TH}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      args = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        outputPath
      ];
    } else if (mode === 'stretch') {
      const vf = `scale=${TW}:${TH},setsar=1`;
      args = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        outputPath
      ];
    } else {
      const vf = `scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH}:(iw-ow)/2:(ih-oh)/2,setsar=1`;
      args = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        outputPath
      ];
    }

    await FFmpegRunner.run(ffmpeg, args);
  }

  static async cropTo916(
    inputPath: string,
    outputPath: string,
    options: { mode?: 'center' | 'blur' | 'pad' } = { mode: 'center' }
  ): Promise<void> {
    await FFmpegRunner.reframe(inputPath, outputPath, {
      aspect: '9:16',
      mode: options.mode || 'center'
    });
  }

  static async burnSubtitles(
    inputPath: string,
    assPath: string,
    outputPath: string
  ): Promise<void> {
    const ffmpeg = FFmpegRunner.getFFmpegPath();
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      `ass='${escapedAss}'`,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      outputPath
    ];

    await FFmpegRunner.run(ffmpeg, args);
  }

  static run(bin: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args);
      let stderr = '';

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg error (exit ${code}): ${stderr.slice(-500)}`));
      });
    });
  }
}
