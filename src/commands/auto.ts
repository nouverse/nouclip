import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { removeQuietly } from '@/commands/extract';
import { resolveFramingMode } from '@/commands/framing';
import { parseFontSize } from '@/commands/subtitle';
import { ASSGenerator } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { type TimeSelectionOptions, resolveTimeSelection, selectionSuffix } from '@/core/selection';
import { findSpeechIntervals, shiftWordTimestamps } from '@/core/transcript';
import { WhisperClient } from '@/core/whisper';
import { YouTubeDownloader } from '@/core/youtube';
import { CliError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
import { formatSecondsToTimestamp } from '@/utils/time';

/**
 * Commander turns `--no-x` into `options.x === false`, so every negatable flag
 * is read from its positive key. `subtitles`/`subs`/`subtitle` and
 * `burn`/`draft` are aliases of the same two decisions.
 */
export interface AutoCommandOptions extends TimeSelectionOptions {
  aspect?: string;
  mode?: string;
  blur?: boolean;
  center?: boolean;
  lang?: string;
  style?: string;
  fontSize?: string;
  primaryColor?: string;
  highlightColor?: string;
  silenceTrim?: boolean;
  silenceGap?: string;
  bgm?: string;
  bgmVolume?: string;
  ducking?: boolean;
  draft?: boolean;
  burn?: boolean;
  subtitles?: boolean;
  subs?: boolean;
  subtitle?: boolean;
  output?: string;
  downloadDir?: string;
  outputDir?: string;
  keepTemp?: boolean;
}

/** True when any of the `--no-subtitles` aliases was passed. */
export function shouldSkipSubtitles(options: AutoCommandOptions): boolean {
  return options.subtitles === false || options.subs === false || options.subtitle === false;
}

/** True when the run should stop before burning (`--draft` / `--no-burn`). */
export function isDraftRun(options: AutoCommandOptions): boolean {
  return options.draft === true || options.burn === false;
}

export async function autoCommand(videoOrUrl: string, options: AutoCommandOptions = {}) {
  config.ensureDirs();

  logger.banner();

  // 1. Download if URL, otherwise resolve the local input.
  const input = await resolveSource(videoOrUrl, options);
  const baseName = basename(input, extname(input));

  const selection = resolveTimeSelection(options);
  const skipSubtitles = shouldSkipSubtitles(options);

  const totalSteps =
    (selection.hasSelection ? 1 : 0) + (skipSubtitles ? 1 : 3) + (options.bgm ? 1 : 0);
  let currentStep = 1;

  // 2. Cut the requested segment.
  let workingVideo = input;
  if (selection.hasSelection) {
    const { start, duration } = selection;
    logger.step(
      currentStep++,
      totalSteps,
      `Cutting segment: ${formatSecondsToTimestamp(start)} -> ${formatSecondsToTimestamp(start + duration)} (${Math.round(duration)}s)...`
    );
    const cutOut = join(config.segmentDir, `${baseName}_cut${selectionSuffix(selection)}.mp4`);
    await FFmpegRunner.cutVideo(input, cutOut, start, duration, true);
    workingVideo = cutOut;
    logger.success(`Clipped to: ${cutOut}`);
  }

  // 3. Reframe to the target aspect ratio.
  const aspectStr = options.aspect || '9:16';
  const framingMode = resolveFramingMode(options);
  const aspectPreset = FFmpegRunner.parseAspectRatio(aspectStr);
  const aspectSlug = FFmpegRunner.aspectSlug(aspectPreset);

  logger.step(
    currentStep++,
    totalSteps,
    `Reframing to aspect ${aspectPreset.name} (${aspectPreset.width}x${aspectPreset.height}, mode=${framingMode})...`
  );

  const framedOut = join(config.segmentDir, `${baseName}_framed_${aspectSlug}_${framingMode}.mp4`);
  await FFmpegRunner.reframe(workingVideo, framedOut, { aspect: aspectStr, mode: framingMode });
  logger.success(`Framed video ready: ${framedOut}`);

  const transcriptBase = `${baseName}${selectionSuffix(selection)}`;
  const finalDir = options.outputDir ? resolve(options.outputDir) : config.outputDir;

  // 4. Clean-video shortcut.
  if (skipSubtitles) {
    let cleanVideo = framedOut;
    if (options.bgm) {
      const bgmPath = resolveMediaInput(options.bgm);
      if (!existsSync(bgmPath)) {
        throw new CliError(`BGM audio file not found: ${options.bgm} (Checked: ${bgmPath})`);
      }
      logger.step(currentStep++, totalSteps, 'Mixing BGM audio with sidechain ducking...');
      const mixedOut = join(config.segmentDir, `${transcriptBase}_clean_bgm.mp4`);
      const bgmVol = options.bgmVolume ? Number.parseFloat(options.bgmVolume) : 0.1;
      await FFmpegRunner.mixBgm(cleanVideo, bgmPath, mixedOut, {
        bgmVolume: Number.isFinite(bgmVol) ? bgmVol : 0.1,
        ducking: options.ducking !== false
      });
      cleanVideo = mixedOut;
      logger.success(`BGM mixed: ${mixedOut}`);
    }

    const finalOutput = options.output
      ? resolve(options.output)
      : join(finalDir, `${transcriptBase}_${aspectSlug}_clean.mp4`);

    if (resolve(cleanVideo) !== resolve(finalOutput)) {
      copyFileSync(cleanVideo, finalOutput);
    }

    console.log('');
    logger.success('🎉 Clean framing complete (0 subtitles)! Video saved to:');
    console.log(`👉 ${finalOutput}`);
    return;
  }

  // 5. Audio extraction & Whisper transcription.
  logger.step(
    currentStep++,
    totalSteps,
    'Extracting audio & generating word timestamps with Whisper...'
  );
  const tempWav = join(config.segmentDir, `${baseName}_audio.temp.wav`);
  const transcriptJsonPath = join(config.transcriptDir, `${transcriptBase}.whisper.json`);
  const assPath = join(config.transcriptDir, `${transcriptBase}.ass`);

  await FFmpegRunner.extractAudio(framedOut, tempWav);

  let whisperRes: Awaited<ReturnType<typeof WhisperClient.transcribe>>;
  try {
    whisperRes = await WhisperClient.transcribe(tempWav, {
      language: options.lang || 'id',
      outputJson: transcriptJsonPath
    });
  } finally {
    if (!options.keepTemp) removeQuietly(tempWav);
  }

  logger.success(`Transcription ready: ${whisperRes.words.length} words -> ${transcriptJsonPath}`);

  let activeVideo = framedOut;
  let activeWords = whisperRes.words;

  // 6. Silence & filler pause trimming (Optional).
  if (options.silenceTrim) {
    const maxGap = options.silenceGap ? Number.parseFloat(options.silenceGap) : 0.6;
    const intervals = findSpeechIntervals(activeWords, {
      maxGap: Number.isFinite(maxGap) ? maxGap : 0.6
    });

    if (intervals.length > 1) {
      logger.info(`Detected ${intervals.length} speech segments, trimming pauses...`);
      const trimmedOut = join(config.segmentDir, `${baseName}_trimmed.mp4`);
      await FFmpegRunner.trimSilence(activeVideo, trimmedOut, intervals);
      activeWords = shiftWordTimestamps(activeWords, intervals);
      activeVideo = trimmedOut;
      logger.success(`Silence trimmed: ${trimmedOut}`);
    }
  }

  // 7. Generate the kinetic subtitle script.
  const assContent = ASSGenerator.generateKineticASS(activeWords, {
    style: options.style || 'default',
    fontSize: parseFontSize(options.fontSize),
    primaryColor: options.primaryColor,
    highlightColor: options.highlightColor
  });
  writeFileSync(assPath, assContent, 'utf-8');
  logger.success(`Subtitle script generated [style=${options.style || 'default'}]: ${assPath}`);

  // 8. Stop here in draft mode so the ASS can be reviewed by hand.
  if (isDraftRun(options)) {
    printDraftSummary(activeVideo, assPath, transcriptJsonPath, transcriptBase);
    return;
  }

  // 9. Burn the animated kinetic typography.
  logger.step(currentStep++, totalSteps, 'Burning animated kinetic typography into video...');
  const burnedOutput = join(config.segmentDir, `${transcriptBase}_burned.mp4`);
  await FFmpegRunner.burnSubtitles(activeVideo, assPath, burnedOutput);

  let finalRenderedVideo = burnedOutput;

  // 10. Mix BGM with Sidechain Ducking (Optional).
  if (options.bgm) {
    const bgmPath = resolveMediaInput(options.bgm);
    if (!existsSync(bgmPath)) {
      throw new CliError(`BGM audio file not found: ${options.bgm} (Checked: ${bgmPath})`);
    }
    logger.step(
      currentStep++,
      totalSteps,
      'Mixing background music (BGM) with sidechain ducking...'
    );
    const mixedWithBgm = join(config.segmentDir, `${transcriptBase}_with_bgm.mp4`);
    const bgmVol = options.bgmVolume ? Number.parseFloat(options.bgmVolume) : 0.1;
    await FFmpegRunner.mixBgm(burnedOutput, bgmPath, mixedWithBgm, {
      bgmVolume: Number.isFinite(bgmVol) ? bgmVol : 0.1,
      ducking: options.ducking !== false
    });
    finalRenderedVideo = mixedWithBgm;
    logger.success(`BGM mixed with ducking: ${mixedWithBgm}`);
  }

  const finalOutput = options.output
    ? resolve(options.output)
    : join(finalDir, `${transcriptBase}_short.mp4`);

  if (resolve(finalRenderedVideo) !== resolve(finalOutput)) {
    copyFileSync(finalRenderedVideo, finalOutput);
  }

  logger.success('🎉 Render complete! Final video saved to:');
  console.log(`👉 ${finalOutput}`);
}

async function resolveSource(videoOrUrl: string, options: AutoCommandOptions): Promise<string> {
  if (YouTubeDownloader.isYouTubeUrl(videoOrUrl)) {
    logger.info(`Detected YouTube URL: ${videoOrUrl}`);
    return YouTubeDownloader.download(videoOrUrl, {
      outputDir: options.downloadDir ? resolve(options.downloadDir) : config.downloadDir
    });
  }

  const input = resolveMediaInput(videoOrUrl);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${videoOrUrl} (Checked: ${input})`);
  }
  return input;
}

function printDraftSummary(
  framedOut: string,
  assPath: string,
  transcriptJsonPath: string,
  transcriptBase: string
): void {
  console.log('');
  logger.success('✨ DRAFT GENERATED SUCCESSFULLY (No burn mode)');
  console.log('='.repeat(60));
  console.log(`1. Framed Video   : ${framedOut}`);
  console.log(`2. Subtitle Script: ${assPath}`);
  console.log(`3. Word Timestamps: ${transcriptJsonPath}`);
  console.log('='.repeat(60));
  console.log('Edit the .ass file styling or text as needed, then burn using:');
  console.log(
    `👉 nouclip subtitle "${framedOut}" --sub "${assPath}" -o "${transcriptBase}_short.mp4"`
  );
  console.log('');
}
