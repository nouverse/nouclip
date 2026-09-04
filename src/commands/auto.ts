import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { ASSGenerator } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner, type FramingMode } from '@/core/ffmpeg';
import { WhisperClient } from '@/core/whisper';
import { YouTubeDownloader } from '@/core/youtube';
import { logger } from '@/utils/logger';
import { formatSecondsToTimestamp, parseRange, parseTimestamp } from '@/utils/time';

export interface AutoCommandOptions {
  range?: string;
  start?: string;
  from?: string;
  end?: string;
  to?: string;
  duration?: string;
  aspect?: string;
  mode?: FramingMode;
  blur?: boolean;
  lang?: string;
  fontSize?: string;
  primaryColor?: string;
  highlightColor?: string;
  draft?: boolean;
  noBurn?: boolean;
  output?: string;
  downloadDir?: string;
  outputDir?: string;
  keepTemp?: boolean;
}

export async function autoCommand(videoPathOrUrl: string, options: AutoCommandOptions) {
  config.ensureDirs();
  logger.banner();

  let input = videoPathOrUrl;
  const isYt = YouTubeDownloader.isYouTubeUrl(videoPathOrUrl);

  if (isYt) {
    logger.info('YouTube URL detected. Checking cache / downloading...');
    const outDir = options.downloadDir ? resolve(options.downloadDir) : config.downloadDir;
    input = await YouTubeDownloader.download(videoPathOrUrl, { outputDir: outDir });
  } else {
    input = resolve(videoPathOrUrl);
    if (!existsSync(input)) {
      logger.error(`Video file not found: ${input}`);
      process.exit(1);
    }
  }

  const baseName = basename(input, extname(input));
  const tempFiles: string[] = [];

  try {
    let workingVideo = input;
    let startSec = 0;
    let durSec = 0;
    let hasCut = false;

    // 1. Resolve Time Range
    if (options.range) {
      const parsed = parseRange(options.range);
      startSec = parsed.start;
      durSec = parsed.duration;
      hasCut = true;
    } else if (options.start || options.from) {
      startSec = parseTimestamp(options.start || options.from);
      if (options.duration) {
        durSec = parseTimestamp(options.duration);
      } else if (options.end || options.to) {
        durSec = parseTimestamp(options.end || options.to) - startSec;
      } else {
        durSec = 30; // default 30s
      }
      hasCut = true;
    }

    if (hasCut) {
      logger.step(
        1,
        4,
        `Cutting segment: ${formatSecondsToTimestamp(startSec)} -> ${formatSecondsToTimestamp(startSec + durSec)} (${Math.round(durSec)}s)...`
      );
      const cutOut = join(
        config.segmentDir,
        `${baseName}_cut_${Math.round(startSec)}s-${Math.round(startSec + durSec)}s.mp4`
      );
      await FFmpegRunner.cutVideo(input, cutOut, startSec, durSec, true);
      workingVideo = cutOut;
      tempFiles.push(cutOut);
      logger.success(`Clipped to: ${cutOut}`);
    }

    // 2. Reframe Aspect Ratio & Mode
    const aspectStr = options.aspect || '9:16';
    const framingMode: FramingMode = options.mode || (options.blur ? 'blur' : 'center');
    const aspectPreset = FFmpegRunner.parseAspectRatio(aspectStr);

    logger.step(
      2,
      4,
      `Reframing to aspect ${aspectPreset.name} (${aspectPreset.width}x${aspectPreset.height}, mode=${framingMode})...`
    );

    const framedOut = join(
      config.segmentDir,
      `${baseName}_framed_${aspectPreset.name.replace(':', 'x')}_${framingMode}.mp4`
    );

    await FFmpegRunner.reframe(workingVideo, framedOut, {
      aspect: aspectStr,
      mode: framingMode
    });
    tempFiles.push(framedOut);
    logger.success(`Framed video ready: ${framedOut}`);

    // 3. Audio extraction & Whisper transcription
    logger.step(3, 4, 'Extracting audio & generating word timestamps with Whisper...');
    const tempWav = join(config.segmentDir, `${baseName}_audio.temp.wav`);
    await FFmpegRunner.extractAudio(framedOut, tempWav);
    tempFiles.push(tempWav);

    const transcriptBase = hasCut
      ? `${baseName}_${Math.round(startSec)}s-${Math.round(startSec + durSec)}s`
      : baseName;

    const transcriptJsonPath = join(config.transcriptDir, `${transcriptBase}.whisper.json`);
    const assPath = join(config.transcriptDir, `${transcriptBase}.ass`);

    const whisperRes = await WhisperClient.transcribe(tempWav, {
      language: options.lang || 'id',
      outputJson: transcriptJsonPath
    });

    logger.success(
      `Transcription ready: ${whisperRes.words.length} words -> ${transcriptJsonPath}`
    );

    // 4. Generate Kinetic Subtitles ASS
    const assContent = ASSGenerator.generateKineticASS(whisperRes.words, {
      fontSize: options.fontSize ? Number.parseInt(options.fontSize, 10) : 60,
      primaryColor: options.primaryColor,
      highlightColor: options.highlightColor
    });
    writeFileSync(assPath, assContent, 'utf-8');
    logger.success(`Subtitle script generated: ${assPath}`);

    // 5. Handle Draft / Review Mode
    const isDraft = options.draft || options.noBurn;
    if (isDraft) {
      console.log('');
      logger.success('✨ DRAFT GENERATED SUCCESSFULLY (No burn mode)');
      console.log('---------------------------------------------------------');
      console.log(`📹 Video Segment  : ${framedOut}`);
      console.log(`📝 Subtitle Script: ${assPath}`);
      console.log(`📊 Word Timestamps: ${transcriptJsonPath}`);
      console.log('---------------------------------------------------------');
      console.log('💡 To review & edit text: Open the .ass file in any editor.');
      console.log('💡 When ready to burn final video:');
      console.log(
        `   nouclip subtitle "${framedOut}" --sub "${assPath}" -o "${join(config.outputDir, `${transcriptBase}_final.mp4`)}"`
      );
      return;
    }

    // 6. Burn animated kinetic subtitles
    logger.step(4, 4, 'Burning animated kinetic typography into final video...');
    const finalDir = options.outputDir ? resolve(options.outputDir) : config.outputDir;
    const finalOutput = options.output
      ? resolve(options.output)
      : join(finalDir, `${transcriptBase}_short.mp4`);

    await FFmpegRunner.burnSubtitles(framedOut, assPath, finalOutput);
    logger.success('🎉 Render complete! Final video saved to:');
    console.log(`👉 ${finalOutput}`);

    // Cleanup raw temp wav unless requested to keep
    if (!options.keepTemp && existsSync(tempWav)) {
      try {
        unlinkSync(tempWav);
      } catch {}
    }
  } catch (err: any) {
    logger.error(`Pipeline failed: ${err.message}`);
    process.exit(1);
  }
}
