import { copyFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { ASSGenerator } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner, type FramingMode } from '@/core/ffmpeg';
import { WhisperClient } from '@/core/whisper';
import { YouTubeDownloader } from '@/core/youtube';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
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
  center?: boolean;
  lang?: string;
  fontSize?: string;
  primaryColor?: string;
  highlightColor?: string;
  draft?: boolean;
  noBurn?: boolean;
  subtitles?: boolean;
  noSubtitles?: boolean;
  noSubs?: boolean;
  noSubtitle?: boolean;
  output?: string;
  downloadDir?: string;
  outputDir?: string;
  keepTemp?: boolean;
}

export async function autoCommand(videoOrUrl: string, options: AutoCommandOptions) {
  config.ensureDirs();
  const tempFiles: string[] = [];

  try {
    logger.banner();

    // 1. Download if URL or Resolve Input File
    let input: string;
    if (YouTubeDownloader.isYouTubeUrl(videoOrUrl)) {
      logger.info(`Detected YouTube URL: ${videoOrUrl}`);
      input = await YouTubeDownloader.download(videoOrUrl, {
        outputDir: options.downloadDir || config.downloadDir
      });
    } else {
      input = resolveMediaInput(videoOrUrl);
      if (!existsSync(input)) {
        logger.error(`File not found: ${videoOrUrl} (Checked: ${input})`);
        process.exit(1);
      }
    }

    const baseName = basename(input, extname(input));

    // Calculate Cut Ranges
    let startSec = 0;
    let durSec = 0;
    let hasCut = false;

    if (options.range) {
      const parsed = parseRange(options.range);
      startSec = parsed.start;
      durSec = parsed.duration;
      hasCut = true;
    } else if (options.start || options.from || options.end || options.to || options.duration) {
      startSec = parseTimestamp(options.start || options.from);
      if (options.duration) {
        durSec = parseTimestamp(options.duration);
      } else if (options.end || options.to) {
        durSec = parseTimestamp(options.end || options.to) - startSec;
      }
      hasCut = durSec > 0;
    }

    const skipSubtitles =
      options.subtitles === false ||
      Boolean(options.noSubtitles) ||
      Boolean(options.noSubs) ||
      Boolean(options.noSubtitle);

    const totalSteps = skipSubtitles ? (hasCut ? 2 : 1) : hasCut ? 4 : 3;
    let currentStep = 1;

    let workingVideo = input;
    if (hasCut) {
      logger.step(
        currentStep++,
        totalSteps,
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

    // 2. Reframe Aspect Ratio & Mode (Default: blur)
    const aspectStr = options.aspect || '9:16';
    const framingMode: FramingMode = options.center
      ? 'center'
      : options.blur
        ? 'blur'
        : options.mode || 'blur';
    const aspectPreset = FFmpegRunner.parseAspectRatio(aspectStr);

    logger.step(
      currentStep++,
      totalSteps,
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

    // 3. Early Exit if Subtitles are disabled (Clean Video Only)
    const transcriptBase = hasCut
      ? `${baseName}_${Math.round(startSec)}s-${Math.round(startSec + durSec)}s`
      : baseName;
    const finalDir = options.outputDir ? resolve(options.outputDir) : config.outputDir;

    if (skipSubtitles) {
      const finalOutput = options.output
        ? resolve(options.output)
        : join(finalDir, `${transcriptBase}_${aspectPreset.name.replace(':', 'x')}_clean.mp4`);

      if (resolve(framedOut) !== resolve(finalOutput)) {
        copyFileSync(framedOut, finalOutput);
      }

      console.log('');
      logger.success('🎉 Clean framing complete (0 subtitles)! Video saved to:');
      console.log(`👉 ${finalOutput}`);
      return;
    }

    // 4. Audio extraction & Whisper transcription
    logger.step(
      currentStep++,
      totalSteps,
      'Extracting audio & generating word timestamps with Whisper...'
    );
    const tempWav = join(config.segmentDir, `${baseName}_audio.temp.wav`);
    await FFmpegRunner.extractAudio(framedOut, tempWav);
    tempFiles.push(tempWav);

    const transcriptJsonPath = join(config.transcriptDir, `${transcriptBase}.whisper.json`);
    const assPath = join(config.transcriptDir, `${transcriptBase}.ass`);

    const whisperRes = await WhisperClient.transcribe(tempWav, {
      language: options.lang || 'id',
      outputJson: transcriptJsonPath
    });

    logger.success(
      `Transcription ready: ${whisperRes.words.length} words -> ${transcriptJsonPath}`
    );

    // 5. Generate Kinetic Subtitles ASS
    const assContent = ASSGenerator.generateKineticASS(whisperRes.words, {
      fontSize: options.fontSize ? Number.parseInt(options.fontSize, 10) : 60,
      primaryColor: options.primaryColor,
      highlightColor: options.highlightColor
    });
    writeFileSync(assPath, assContent, 'utf-8');
    logger.success(`Subtitle script generated: ${assPath}`);

    // 6. Handle Draft / Review Mode
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

    // 7. Burn animated kinetic subtitles
    logger.step(
      currentStep++,
      totalSteps,
      'Burning animated kinetic typography into final video...'
    );
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
