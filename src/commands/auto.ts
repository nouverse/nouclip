import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { removeQuietly } from '@/commands/extract';
import { resolveFramingMode } from '@/commands/framing';
import { parseFontSize } from '@/commands/subtitle';
import { ASSGenerator } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { type TimeSelectionOptions, resolveTimeSelection, selectionSuffix } from '@/core/selection';
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
  fontSize?: string;
  primaryColor?: string;
  highlightColor?: string;
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

  const totalSteps = (selection.hasSelection ? 1 : 0) + (skipSubtitles ? 1 : 3);
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
    const finalOutput = options.output
      ? resolve(options.output)
      : join(finalDir, `${transcriptBase}_${aspectSlug}_clean.mp4`);

    if (resolve(framedOut) !== resolve(finalOutput)) {
      copyFileSync(framedOut, finalOutput);
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

  // 6. Generate the kinetic subtitle script.
  const assContent = ASSGenerator.generateKineticASS(whisperRes.words, {
    fontSize: parseFontSize(options.fontSize),
    primaryColor: options.primaryColor,
    highlightColor: options.highlightColor
  });
  writeFileSync(assPath, assContent, 'utf-8');
  logger.success(`Subtitle script generated: ${assPath}`);

  // 7. Stop here in draft mode so the ASS can be reviewed by hand.
  if (isDraftRun(options)) {
    printDraftSummary(framedOut, assPath, transcriptJsonPath, transcriptBase);
    return;
  }

  // 8. Burn the animated kinetic typography.
  logger.step(currentStep++, totalSteps, 'Burning animated kinetic typography into final video...');
  const finalOutput = options.output
    ? resolve(options.output)
    : join(finalDir, `${transcriptBase}_short.mp4`);

  await FFmpegRunner.burnSubtitles(framedOut, assPath, finalOutput);
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
}
