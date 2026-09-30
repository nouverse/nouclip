import { spawn } from 'node:child_process';
import type { WordTimestamp } from '@/core/ass';
import { YouTubeDownloader } from '@/core/youtube';

/**
 * Word timestamps from a YouTube video's own captions — before any audio is sent to Whisper.
 *
 * A YouTube video usually already has what transcription would produce: YouTube's speech
 * recognition times every word (the `<lang>-orig` automatic track), and captions a person uploaded
 * are checked by a human. Either costs nothing, needs no STT endpoint, and covers the whole video —
 * which is what makes `highlight` on a two-hour podcast possible without transcribing two hours.
 *
 * Which track, in order:
 *
 * 1. **Uploaded captions** in the requested language — a person wrote them. Timed per line, so the
 *    words are spread across each line by length (`timing: 'estimated'`).
 * 2. **YouTube's recognition** in the requested language — per-word timing, recognizer mistakes.
 * 3. Nothing. An automatic *translation* into the requested language is never used: it is not what
 *    was said, and subtitles that disagree with the speaker are worse than none.
 */

export type CaptionKind = 'uploaded' | 'recognized';
export type CaptionTiming = 'word' | 'estimated';

export interface CaptionResult {
  kind: CaptionKind;
  timing: CaptionTiming;
  /** The track's language code as YouTube lists it, e.g. `id`, `en-orig`. */
  track: string;
  /**
   * An uploaded track in a language other than the one spoken — a human translation. Legitimate
   * subtitles, but the words are not what is being said, so word-by-word highlighting drifts.
   */
  translated: boolean;
  words: WordTimestamp[];
  /** `<title> [<id>]`, the name a download of the same video gets — so files line up. */
  name: string;
  /** Seconds, when YouTube says. */
  duration?: number;
}

interface TrackFormat {
  ext?: string;
  url?: string;
}

/** The part of `yt-dlp -J` this reads. */
export interface VideoCaptionInfo {
  id?: string;
  title?: string;
  duration?: number;
  /** The spoken language, when YouTube knows it. */
  language?: string;
  subtitles?: Record<string, TrackFormat[]>;
  automatic_captions?: Record<string, TrackFormat[]>;
}

export interface PickedTrack {
  kind: CaptionKind;
  track: string;
  url: string;
  ext: 'json3' | 'vtt';
}

/** Formats read, best first: json3 carries per-word offsets, vtt is the fallback every track has. */
const FORMATS = ['json3', 'vtt'] as const;

export class YouTubeCaptions {
  /**
   * The best track for `lang`, or `null` when there is none worth using (see the module comment).
   *
   * `lang` matches a track exactly or as a region variant (`en` matches `en-US`). A recognized track
   * is taken from `<lang>-orig`, or from a bare `<lang>` only when YouTube says the video is spoken
   * in that language — otherwise a bare automatic `<lang>` is a translation.
   */
  static pickTrack(info: VideoCaptionInfo, lang: string): PickedTrack | null {
    const wanted = lang.toLowerCase();
    const matches = (code: string) => {
      const c = code.toLowerCase();
      return c === wanted || c.startsWith(`${wanted}-`);
    };

    for (const [code, formats] of Object.entries(info.subtitles ?? {})) {
      if (code === 'live_chat' || !matches(code) || code.endsWith('-orig')) continue;
      const format = pickFormat(formats);
      if (format) return { kind: 'uploaded', track: code, ...format };
    }

    const automatic = info.automatic_captions ?? {};
    const spokenHere = (info.language ?? '').toLowerCase().split('-')[0] === wanted;
    for (const code of [`${wanted}-orig`, ...(spokenHere ? [wanted] : [])]) {
      const formats = automatic[code];
      const format = formats && pickFormat(formats);
      if (format) return { kind: 'recognized', track: code, ...format };
    }
    return null;
  }

  /** Parses a track into words. json3 keeps per-word times where it has them. */
  static parse(
    body: string,
    ext: 'json3' | 'vtt'
  ): { words: WordTimestamp[]; timing: CaptionTiming } {
    return ext === 'json3' ? parseJson3(JSON.parse(body)) : parseVtt(body);
  }

  /**
   * The words inside `[start, start + duration)`, shifted so the range begins at zero — the same
   * clock as a clip cut from that range, which is what its subtitles are timed against.
   */
  static slice(words: WordTimestamp[], start: number, duration: number): WordTimestamp[] {
    const end = start + duration;
    return words
      .filter((w) => w.start >= start && w.start < end)
      .map((w) => ({
        ...w,
        start: round(w.start - start),
        end: round(Math.min(w.end, end) - start)
      }));
  }

  /** What a download of this video is called (`%(title).60s [%(id)s]`), without the extension. */
  static nameOf(info: VideoCaptionInfo, url: string): string {
    const id = info.id ?? YouTubeDownloader.extractVideoId(url) ?? 'video';
    const title = (info.title ?? 'video').slice(0, 60).replace(/[\\/:*?"<>|]/g, '_');
    return `${title} [${id}]`;
  }

  /** `yt-dlp -J`: every caption track the video has, without downloading anything. */
  static async fetchInfo(url: string): Promise<VideoCaptionInfo> {
    const stdout = await run(YouTubeDownloader.getYtDlpPath(), [
      '-J',
      '--skip-download',
      '--no-playlist',
      url
    ]);
    return JSON.parse(stdout) as VideoCaptionInfo;
  }

  /**
   * The words of `url`'s best caption track in `lang`, or `null` when it has none.
   *
   * `fetchImpl` is for tests; the track itself is a plain HTTPS fetch of the URL yt-dlp listed.
   */
  static async fromYouTube(
    url: string,
    lang: string,
    deps: { info?: VideoCaptionInfo; fetchImpl?: typeof fetch } = {}
  ): Promise<CaptionResult | null> {
    const info = deps.info ?? (await YouTubeCaptions.fetchInfo(url));
    const picked = YouTubeCaptions.pickTrack(info, lang);
    if (!picked) return null;

    const response = await (deps.fetchImpl ?? fetch)(picked.url);
    if (!response.ok)
      throw new Error(`caption track ${picked.track} could not be fetched (${response.status})`);
    const { words, timing } = YouTubeCaptions.parse(await response.text(), picked.ext);
    if (words.length === 0) return null;
    const spoken = (info.language ?? '').toLowerCase().split('-')[0];
    return {
      kind: picked.kind,
      timing,
      track: picked.track,
      translated:
        picked.kind === 'uploaded' && spoken !== '' && spoken !== lang.toLowerCase().split('-')[0],
      words,
      name: YouTubeCaptions.nameOf(info, url),
      ...(info.duration ? { duration: info.duration } : {})
    };
  }
}

function pickFormat(formats: TrackFormat[]): { url: string; ext: 'json3' | 'vtt' } | null {
  for (const ext of FORMATS) {
    const found = formats.find((f) => f.ext === ext && f.url);
    if (found?.url) return { url: found.url, ext };
  }
  return null;
}

interface Json3 {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
  }>;
}

/** Every event with text is new text; a seg with `tOffsetMs` is a word with a time of its own. */
function parseJson3(doc: Json3): { words: WordTimestamp[]; timing: CaptionTiming } {
  const words: WordTimestamp[] = [];
  let wordTimed = false;

  for (const event of doc.events ?? []) {
    const segs = (event.segs ?? []).filter((s) => (s.utf8 ?? '').trim() !== '');
    if (segs.length === 0) continue;
    const start = (event.tStartMs ?? 0) / 1000;
    const end = start + (event.dDurationMs ?? 0) / 1000;

    if (segs.some((s) => s.tOffsetMs !== undefined)) {
      wordTimed = true;
      segs.forEach((seg, i) => {
        const next = segs[i + 1];
        words.push({
          word: (seg.utf8 ?? '').trim(),
          start: start + (seg.tOffsetMs ?? 0) / 1000,
          end: next ? start + (next.tOffsetMs ?? 0) / 1000 : end
        });
      });
    } else {
      words.push(...spread(segs.map((s) => s.utf8).join(''), start, end));
    }
  }

  // Recognized captions overlap on screen, not in speech: a word ends where the next one begins.
  words.sort((a, b) => a.start - b.start);
  for (let i = 0; i < words.length - 1; i++)
    words[i].end = Math.min(words[i].end, words[i + 1].start);
  return { words: words.map(rounded), timing: wordTimed ? 'word' : 'estimated' };
}

const CUE =
  /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})[^\n]*\n([\s\S]*?)(?:\n\n|$)/g;

function parseVtt(text: string): { words: WordTimestamp[]; timing: CaptionTiming } {
  const words: WordTimestamp[] = [];
  const seen = new Set<string>();
  for (const match of text.replace(/\r\n/g, '\n').matchAll(CUE)) {
    // Inline tags are YouTube's karaoke markup; the words are what is between them.
    const line = match[3]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    for (const word of spread(line, vttSeconds(match[1]), vttSeconds(match[2]))) {
      // Rolling captions repeat the previous line; a word is kept the first time it is said.
      const key = `${word.word}@${word.start.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
    }
  }
  return { words: words.map(rounded), timing: 'estimated' };
}

/** A line's words spread over its duration by length — uploaded captions time lines, not words. */
function spread(line: string, start: number, end: number): WordTimestamp[] {
  const tokens = line.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const total = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
  let at = start;
  return tokens.map((word) => {
    const span = ((end - start) * word.length) / total;
    const w = { word, start: at, end: at + span };
    at += span;
    return w;
  });
}

function vttSeconds(stamp: string): number {
  const parts = stamp.split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function rounded(w: WordTimestamp): WordTimestamp {
  return { ...w, start: round(w.start), end: round(w.end) };
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(new Error(`yt-dlp could not be started: ${err.message}`)));
    proc.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`yt-dlp exited ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`))
    );
  });
}
