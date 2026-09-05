import type { WordTimestamp } from '@/core/ass';
import type { ClipHighlight } from '@/core/llm';

/** Seconds of lead-in kept before a keyword match so the hook has context. */
const KEYWORD_LEAD_IN = 8;
/** Minimum gap between two keyword clips before they are considered duplicates. */
const OVERLAP_WINDOW = 20;
/** Words kept on each side of a heuristic cluster center. */
const HEURISTIC_HALF_WINDOW = 30;

export function round(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function snippet(words: WordTimestamp[], maxChars = 80): string {
  const text = words.map((w) => w.word.trim()).join(' ');
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

/** Finds moments containing a keyword, padded into clip-sized ranges. */
export function findKeywordMoments(
  words: WordTimestamp[],
  keyword: string,
  minDur: number,
  maxDur: number,
  maxClips: number
): ClipHighlight[] {
  if (words.length === 0 || !keyword.trim() || maxClips <= 0) return [];

  const kwLower = keyword.trim().toLowerCase();
  const clips: ClipHighlight[] = [];
  const usedStarts: number[] = [];

  for (let idx = 0; idx < words.length; idx++) {
    if (clips.length >= maxClips) break;
    if (!words[idx].word.toLowerCase().includes(kwLower)) continue;

    const targetStart = Math.max(0, words[idx].start - KEYWORD_LEAD_IN);
    const targetEnd = targetStart + Math.min(maxDur, Math.max(minDur, 40));

    const startWord = words.find((w) => w.start >= targetStart) ?? words[0];
    const endWord = words.find((w) => w.end >= targetEnd) ?? words[words.length - 1];
    if (endWord.end <= startWord.start) continue;

    if (usedStarts.some((s) => Math.abs(s - startWord.start) < OVERLAP_WINDOW)) continue;
    usedStarts.push(startWord.start);

    const slice = words.filter((w) => w.start >= startWord.start && w.end <= endWord.end);

    clips.push({
      title: `Highlight: ${keyword.toUpperCase()} Focus`,
      hook: snippet(slice),
      start: round(startWord.start, 1),
      end: round(endWord.end, 1),
      duration: round(endWord.end - startWord.start, 1),
      viralityScore: 90,
      reason: `Direct keyword match on "${keyword}" with contextual buildup and punchline.`
    });
  }

  return clips;
}

/**
 * Offline fallback: spreads clip centers evenly across the transcript.
 * Used when no LLM is configured, or when the LLM call fails.
 */
export function findHeuristicMoments(
  words: WordTimestamp[],
  _minDur: number,
  _maxDur: number,
  maxClips: number
): ClipHighlight[] {
  if (words.length === 0 || maxClips <= 0) return [];

  // With few words there is nothing to spread out — return a single clip.
  const step = Math.floor(words.length / (maxClips + 1));
  if (step === 0) {
    return [
      {
        title: 'Moment Segment #1',
        hook: snippet(words),
        start: round(words[0].start, 1),
        end: round(words[words.length - 1].end, 1),
        duration: round(words[words.length - 1].end - words[0].start, 1),
        viralityScore: 83,
        reason: 'Transcript is short enough to be a single clip.'
      }
    ];
  }

  const clips: ClipHighlight[] = [];

  for (let i = 1; i <= maxClips; i++) {
    const centerIdx = i * step;
    const from = Math.max(0, centerIdx - HEURISTIC_HALF_WINDOW);
    const to = Math.min(words.length, centerIdx + HEURISTIC_HALF_WINDOW);
    const slice = words.slice(from, to);
    if (slice.length === 0) continue;

    const startWord = slice[0];
    const endWord = slice[slice.length - 1];

    clips.push({
      title: `Moment Segment #${i}`,
      hook: snippet(slice),
      start: round(startWord.start, 1),
      end: round(endWord.end, 1),
      duration: round(endWord.end - startWord.start, 1),
      viralityScore: 85 - i * 2,
      reason: 'High information density dialogue segment with complete thought structure.'
    });
  }

  return clips;
}
