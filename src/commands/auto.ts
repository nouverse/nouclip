import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { removeQuietly } from '@/commands/extract';
import { resolveFramingMode } from '@/commands/framing';
import { parseFontSize } from '@/commands/subtitle';
import { ASSGenerator, type WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import {
  NO_SELECTION,
  type TimeSelection,
  type TimelineOptions,
  type TimelineSegment,
  describeTimeline,
  isSplicePlan,
  parseTimelinePlan,
  planBounds,
  planSelection,
  resolveTimeline,
  selectionSuffix,
  shiftSegments,
  timelineSuffix
} from '@/core/selection';
import {
  assignTimelineSegments,
  findSpeechIntervals,
  shiftWordTimestamps
} from '@/core/transcript';
import { WhisperClient } from '@/core/whisper';
import { captionWords, parseCaptionsMode } from '@/core/words';
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
export interface AutoCommandOptions extends TimelineOptions {
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
  jsRuntimes?: string;
  force?: boolean;
  scale?: boolean;
  /** `auto` (default), `only` or `off` — see `CaptionsMode`. */
  captions?: string;
}

/** True when any of the `--no-subtitles` aliases was passed. */
export function shouldSkipSubtitles(options: AutoCommandOptions): boolean {
  return options.subtitles === false || options.subs === false || options.subtitle === false;
}

/** True when the run should stop before burning (`--draft` / `--no-burn`). */
export function isDraftRun(options: AutoCommandOptions): boolean {
  return options.draft === true || options.burn === false;
}

export interface ResolvedMedia {
  path: string;
  isPreClipped: boolean;
}

export async function autoCommand(videoOrUrl: string, options: AutoCommandOptions = {}) {
  config.ensureDirs();

  logger.banner();

  // 1. What to keep — one range, or a timeline of segments and skip windows — and the subtitles
  //    preference, before anything is downloaded.
  const plan = parseTimelinePlan(options);
  const splicing = isSplicePlan(plan);
  const selection = splicing ? NO_SELECTION : planSelection(plan);
  const skipSubtitles = shouldSkipSubtitles(options);

  // 2. Download if URL (section-aware), otherwise resolve the local input. A timeline downloads
  //    only the window spanning its segments, and the splice then reads inside that section.
  const bounds = splicing ? planBounds(plan) : selection;
  const resolved = await resolveSource(videoOrUrl, options, bounds);
  const input = resolved.path;
  const baseName = basename(input, extname(input));

  const needsCutting = !splicing && selection.hasSelection && !resolved.isPreClipped;
  const totalSteps =
    (needsCutting || splicing ? 1 : 0) + (skipSubtitles ? 1 : 3) + (options.bgm ? 1 : 0);
  let currentStep = 1;

  // 3. Splice the timeline, or cut the requested segment (skipped if already downloaded as a section).
  let workingVideo = input;
  /** The spliced segments in the source video's own clock, for its captions and file names. */
  let timeline: TimelineSegment[] | undefined;
  if (splicing) {
    const meta = await FFmpegRunner.getMetadata(input);
    const offset = resolved.isPreClipped ? bounds.start : 0;
    const resolvedTimeline = resolveTimeline(plan, { duration: meta.duration, offset });
    timeline = shiftSegments(resolvedTimeline.segments, offset);

    logger.step(
      currentStep++,
      totalSteps,
      `Splicing ${timeline.length} segment${timeline.length === 1 ? '' : 's'} (${resolvedTimeline.totalDuration.toFixed(1)}s)...`
    );
    for (const line of describeTimeline(timeline)) logger.info(`  ${line}`);

    const spliceOut = join(config.segmentDir, `${baseName}_spliced${timelineSuffix(timeline)}.mp4`);
    await FFmpegRunner.spliceTimeline(input, spliceOut, resolvedTimeline.segments, {
      hasAudio: meta.hasAudio
    });
    workingVideo = spliceOut;
    logger.success(`Spliced to: ${spliceOut}`);
  } else if (needsCutting) {
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

  // 4. Reframe to the target aspect ratio.
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

  const transcriptBase = timeline
    ? `${baseName}${timelineSuffix(timeline)}`
    : resolved.isPreClipped
      ? baseName
      : `${baseName}${selectionSuffix(selection)}`;
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

  // 5. Word timestamps: the video's own YouTube captions when it has them, Whisper otherwise.
  //    A spliced clip re-times the captions onto its own clock; Whisper simply hears the clip.
  logger.step(
    currentStep++,
    totalSteps,
    'Getting word timestamps (captions first, then Whisper)...'
  );
  const transcriptJsonPath = join(config.transcriptDir, `${transcriptBase}.whisper.json`);
  const assPath = join(config.transcriptDir, `${transcriptBase}.ass`);
  const lang = options.lang || 'id';

  const captioned = await captionWords(
    videoOrUrl,
    lang,
    parseCaptionsMode(options.captions),
    selection,
    timeline
  );
  let whisperRes: { words: WordTimestamp[]; text: string };
  if (captioned) {
    // Written in the Whisper JSON shape, so `subtitle`, `highlight` and a draft review read it the same.
    writeFileSync(
      transcriptJsonPath,
      JSON.stringify(
        {
          language: lang,
          duration: captioned.duration,
          text: captioned.text,
          words: captioned.words,
          source: 'youtube-captions',
          track: captioned.caption?.track,
          timing: captioned.caption?.timing,
          ...(timeline ? { timeline } : {})
        },
        null,
        2
      ),
      'utf-8'
    );
    whisperRes = captioned;
  } else {
    const tempWav = join(config.segmentDir, `${baseName}_audio.temp.wav`);
    await FFmpegRunner.extractAudio(framedOut, tempWav);
    try {
      whisperRes = await WhisperClient.transcribe(tempWav, {
        language: lang,
        outputJson: transcriptJsonPath
      });
    } finally {
      if (!options.keepTemp) removeQuietly(tempWav);
    }

    if (timeline) {
      // Whisper heard the spliced clip, so its times are right already; tagging each word with
      // its segment keeps a caption from spanning a cut, in this run and in a draft review.
      whisperRes = { ...whisperRes, words: assignTimelineSegments(whisperRes.words, timeline) };
      writeFileSync(
        transcriptJsonPath,
        JSON.stringify({ ...whisperRes, timeline }, null, 2),
        'utf-8'
      );
    }
  }

  logger.success(
    `Word timestamps ready: ${whisperRes.words.length} words -> ${transcriptJsonPath}`
  );

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
    highlightColor: options.highlightColor,
    noScale: options.scale === false
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

export async function resolveSource(
  videoOrUrl: string,
  options: AutoCommandOptions,
  selection: TimeSelection
): Promise<ResolvedMedia> {
  if (YouTubeDownloader.isYouTubeUrl(videoOrUrl)) {
    logger.info(`Detected YouTube URL: ${videoOrUrl}`);
    const outDir = options.downloadDir ? resolve(options.downloadDir) : config.downloadDir;

    if (selection.hasSelection) {
      const start = selection.start;
      const end = selection.start + selection.duration;
      logger.info(
        `Downloading section only: ${formatSecondsToTimestamp(start)} -> ${formatSecondsToTimestamp(end)} (${Math.round(selection.duration)}s)...`
      );
      const downloadedPath = await YouTubeDownloader.download(videoOrUrl, {
        outputDir: outDir,
        section: { start, end },
        jsRuntimes: options.jsRuntimes,
        force: options.force
      });
      return { path: downloadedPath, isPreClipped: true };
    }

    const downloadedPath = await YouTubeDownloader.download(videoOrUrl, {
      outputDir: outDir,
      jsRuntimes: options.jsRuntimes,
      force: options.force
    });
    return { path: downloadedPath, isPreClipped: false };
  }

  const input = resolveMediaInput(videoOrUrl);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${videoOrUrl} (Checked: ${input})`);
  }
  return { path: input, isPreClipped: false };
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
