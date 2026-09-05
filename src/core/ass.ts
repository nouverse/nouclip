export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words: WordTimestamp[];
}

export interface KineticASSOptions {
  fontSize?: number;
  primaryColor?: string;
  highlightColor?: string;
  wordsPerGroup?: number;
  /** Cap on how long the final word of a group stays on screen. */
  maxWordDuration?: number;
  /** Silence longer than this ends the current caption group. */
  gapThreshold?: number;
}

export const ASS_DEFAULTS = {
  fontSize: 62,
  /** White */
  primaryColor: '&H00FFFFFF',
  /** Bright yellow / cyber amber */
  highlightColor: '&H0000FFFF',
  wordsPerGroup: 2,
  maxWordDuration: 1.0,
  gapThreshold: 0.4,
  /** Floor so a very short word is still readable. */
  minWordDuration: 0.3
} as const;

export class ASSGenerator {
  /** Drops empty words and anything with unusable timings. */
  static sanitizeWords(words: WordTimestamp[]): WordTimestamp[] {
    return words.filter(
      (w) =>
        typeof w?.word === 'string' &&
        w.word.trim().length > 0 &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end)
    );
  }

  /**
   * Chunks words into caption groups of at most `groupSize`,
   * breaking early when the silence before the next word exceeds `gapThreshold`.
   */
  static groupWords(
    words: WordTimestamp[],
    groupSize: number,
    gapThreshold: number
  ): WordTimestamp[][] {
    const groups: WordTimestamp[][] = [];
    let i = 0;

    while (i < words.length) {
      const group: WordTimestamp[] = [words[i]];
      let nextIdx = i + 1;

      while (nextIdx < words.length && group.length < groupSize) {
        const prev = group[group.length - 1];
        if (words[nextIdx].start - prev.end > gapThreshold) break;
        group.push(words[nextIdx]);
        nextIdx++;
      }

      groups.push(group);
      i = nextIdx;
    }

    return groups;
  }

  /**
   * Generates an ASS (Advanced SubStation Alpha) subtitle script with kinetic
   * word highlighting — the active word turns amber and bounces.
   *
   * - Lower-third alignment, above the TikTok/Reels UI safe zone
   * - Active words are capped so captions never linger through a pause
   * - Groups break on silence so captions disappear during gaps
   */
  static generateKineticASS(words: WordTimestamp[], options: KineticASSOptions = {}): string {
    const fontSize = options.fontSize || ASS_DEFAULTS.fontSize;
    const primaryColor = options.primaryColor || ASS_DEFAULTS.primaryColor;
    const highlightColor = options.highlightColor || ASS_DEFAULTS.highlightColor;
    const maxWordDuration = options.maxWordDuration || ASS_DEFAULTS.maxWordDuration;
    const gapThreshold = options.gapThreshold || ASS_DEFAULTS.gapThreshold;
    const groupSize = options.wordsPerGroup || ASS_DEFAULTS.wordsPerGroup;

    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: KineticTitle, Arial Black, ${fontSize}, ${primaryColor}, &H000000FF, &H00000000, &H80000000, -1, 0, 0, 0, 100, 100, 2, 0, 1, 5, 2, 2, 50, 50, 360, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const cleanWords = ASSGenerator.sanitizeWords(words);
    const lines: string[] = [];

    for (const group of ASSGenerator.groupWords(cleanWords, groupSize, gapThreshold)) {
      for (let j = 0; j < group.length; j++) {
        const activeWord = group[j];
        const startTime = activeWord.start;

        // Hold until the next word starts; cap the trailing word so it does not
        // linger across a pause.
        let endTime =
          j < group.length - 1
            ? group[j + 1].start
            : Math.min(activeWord.end, startTime + maxWordDuration);

        if (endTime <= startTime) {
          endTime = startTime + ASS_DEFAULTS.minWordDuration;
        }

        const textParts = group.map((w, idx) => {
          const cleanText = w.word.trim().toUpperCase().replace(/[{}]/g, '');
          if (idx === j) {
            return `{\\c${highlightColor}\\t(0,80,\\fscx112\\fscy112)\\t(80,160,\\fscx100\\fscy100)}${cleanText}{\\r}`;
          }
          return `{\\c${primaryColor}}${cleanText}{\\r}`;
        });

        lines.push(
          `Dialogue: 0,${ASSGenerator.formatTime(startTime)},${ASSGenerator.formatTime(endTime)},KineticTitle,,0,0,0,,${textParts.join(' ')}`
        );
      }
    }

    return `${header + lines.join('\n')}\n`;
  }

  /** ASS timestamp: `H:MM:SS.cc`. */
  static formatTime(seconds: number): string {
    const total = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

    // Round to centiseconds first: deriving fields from `total % 1` turns
    // 5.3 into 5.29 because of binary floating point.
    const totalCs = Math.round(total * 100);
    const cs = totalCs % 100;
    const totalSecs = (totalCs - cs) / 100;

    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${hrs}:${pad(mins)}:${pad(secs)}.${pad(cs)}`;
  }
}
