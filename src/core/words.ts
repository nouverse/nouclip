import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { removeQuietly } from '@/commands/extract';
import type { WordTimestamp } from '@/core/ass';
import { type CaptionResult, YouTubeCaptions } from '@/core/captions';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import type { TimeSelection } from '@/core/selection';
import { WhisperClient } from '@/core/whisper';
import { YouTubeDownloader } from '@/core/youtube';
import { CliError, getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

/**
 * Where the words come from.
 *
 * - `auto` (default): a YouTube video's own captions when it has usable ones, Whisper otherwise.
 * - `only`: captions or nothing — for when no transcription service is set up.
 * - `off`: always Whisper, e.g. when the captions are known to be poor.
 */
export const CAPTION_MODES = ['auto', 'only', 'off'] as const;
export type CaptionsMode = (typeof CAPTION_MODES)[number];

export function parseCaptionsMode(value: string | undefined): CaptionsMode {
  const mode = (value ?? 'auto').toLowerCase();
  if (!(CAPTION_MODES as readonly string[]).includes(mode)) {
    throw new CliError(
      `Unknown --captions "${value}". Expected one of: ${CAPTION_MODES.join(', ')}.`
    );
  }
  return mode as CaptionsMode;
}

export interface ObtainedWords {
  words: WordTimestamp[];
  text: string;
  duration: number;
  via: 'captions' | 'whisper';
  /** A name for files made from this source: the download's name, or `<title> [<id>]`. */
  name: string;
  /** Present when the words came from captions — which track, and how it is timed. */
  caption?: CaptionResult;
}

export interface ObtainOptions {
  lang: string;
  captions?: CaptionsMode;
  /** When set, only this range, with times starting at zero — the clock of a clip cut from it. */
  selection?: TimeSelection;
  downloadDir?: string;
}

/**
 * The words of a video, a local file or a YouTube link — from captions when there are some.
 *
 * Captions cost nothing and need no STT endpoint, so a YouTube link with them is never downloaded
 * here: summarizing or finding the moments of a long video reads its captions and stops.
 */
export async function obtainWords(source: string, options: ObtainOptions): Promise<ObtainedWords> {
  const mode = options.captions ?? 'auto';
  const selection = options.selection?.hasSelection ? options.selection : undefined;

  const captioned = await captionWords(source, options.lang, mode, selection);
  if (captioned) return captioned;
  return fromWhisper(source, options, selection);
}

/**
 * The words from a YouTube link's captions, for `selection` when given — or `null` when Whisper
 * should be asked instead. Throws only for `--captions only`, where there is no instead.
 *
 * Split from `obtainWords` for `auto`, which has already downloaded and reframed the clip by the time
 * it needs words: its fallback is Whisper on that clip, not another download.
 */
export async function captionWords(
  source: string,
  lang: string,
  mode: CaptionsMode,
  selection?: TimeSelection
): Promise<ObtainedWords | null> {
  const range = selection?.hasSelection ? selection : undefined;
  if (!YouTubeDownloader.isYouTubeUrl(source)) {
    if (mode === 'only')
      throw new CliError(
        '--captions only needs a YouTube link: a local file has no captions to read.'
      );
    return null;
  }
  if (mode === 'off') return null;

  const caption = await tryCaptions(source, lang, mode);
  if (caption) {
    const words = range
      ? YouTubeCaptions.slice(caption.words, range.start, range.duration)
      : caption.words;
    if (words.length > 0) return fromCaptions(caption, words, range);
    logger.warn('The captions have no words in that range; transcribing it instead.');
  }
  if (mode === 'only')
    throw new CliError(
      `No usable "${lang}" captions on ${source} (and --captions only was given).`
    );
  return null;
}

async function tryCaptions(
  url: string,
  lang: string,
  mode: CaptionsMode
): Promise<CaptionResult | null> {
  try {
    logger.info(`Looking for "${lang}" captions on YouTube before transcribing...`);
    return await YouTubeCaptions.fromYouTube(url, lang);
  } catch (err) {
    if (mode === 'only') throw new CliError(`Could not read captions: ${getErrorMessage(err)}`);
    logger.warn(`Could not read captions (${getErrorMessage(err)}); transcribing instead.`);
    return null;
  }
}

function fromCaptions(
  caption: CaptionResult,
  words: WordTimestamp[],
  selection?: TimeSelection
): ObtainedWords {
  logger.success(
    `Using YouTube captions (${caption.kind === 'uploaded' ? 'uploaded' : 'YouTube speech recognition'}, ` +
      `track ${caption.track}, ${caption.timing === 'word' ? 'per-word timing' : 'timing estimated per line'}): ${words.length} words`
  );
  if (caption.translated) {
    logger.warn(
      'These captions are a translation: the words will not match what is spoken, word for word.'
    );
  }
  return {
    words,
    text: words.map((w) => w.word).join(' '),
    duration: selection ? selection.duration : (caption.duration ?? words.at(-1)?.end ?? 0),
    via: 'captions',
    name: caption.name,
    caption
  };
}

async function fromWhisper(
  source: string,
  options: ObtainOptions,
  selection?: TimeSelection
): Promise<ObtainedWords> {
  const input = YouTubeDownloader.isYouTubeUrl(source)
    ? await YouTubeDownloader.download(source, {
        outputDir: options.downloadDir ?? config.downloadDir,
        ...(selection
          ? { section: { start: selection.start, end: selection.start + selection.duration } }
          : {})
      })
    : resolveMediaInput(source);
  if (!existsSync(input)) throw new CliError(`File not found: ${source} (Checked: ${input})`);

  const name = basename(input, extname(input));
  const wav = join(config.segmentDir, `${name}.words.temp.wav`);
  // A downloaded section already starts at the range; a local file is read from it.
  const range =
    selection && !YouTubeDownloader.isYouTubeUrl(source)
      ? { start: selection.start, duration: selection.duration }
      : {};

  try {
    await FFmpegRunner.extractAudio(input, wav, range);
    const result = await WhisperClient.transcribe(wav, { language: options.lang });
    return {
      words: result.words,
      text: result.text,
      duration: result.duration,
      via: 'whisper',
      name
    };
  } finally {
    removeQuietly(wav);
  }
}
