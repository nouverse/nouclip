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

export type SubtitleStylePreset = 'default' | 'hormozi' | 'storyteller' | 'cinematic';

export interface SubtitleStyleConfig {
  fontName: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  backColor: string;
  bold: number;
  italic: number;
  outline: number;
  shadow: number;
  spacing: number;
  uppercase: boolean;
  scaleFactor: number;
  marginV: number;
}

export const SUBTITLE_STYLE_PRESETS: Record<SubtitleStylePreset, SubtitleStyleConfig> = {
  default: {
    fontName: 'Arial Black',
    fontSize: 62,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H0000FFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: -1,
    italic: 0,
    outline: 5,
    shadow: 2,
    spacing: 2,
    uppercase: true,
    scaleFactor: 112,
    marginV: 360
  },
  hormozi: {
    fontName: 'Arial Black',
    fontSize: 70,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H0000FF00', // Electric Green
    outlineColor: '&H00000000',
    backColor: '&HB0000000',
    bold: -1,
    italic: 0,
    outline: 6,
    shadow: 3,
    spacing: 2,
    uppercase: true,
    scaleFactor: 118,
    marginV: 380
  },
  storyteller: {
    fontName: 'Arial',
    fontSize: 54,
    primaryColor: '&H00F5F5F5',
    highlightColor: '&H0050E3C2', // Soft Cyan/Teal
    outlineColor: '&H00101010',
    backColor: '&H60000000',
    bold: 0,
    italic: 0,
    outline: 3,
    shadow: 1,
    spacing: 1,
    uppercase: false,
    scaleFactor: 108,
    marginV: 340
  },
  cinematic: {
    fontName: 'Trebuchet MS',
    fontSize: 58,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H0000A5FF', // Golden Amber
    outlineColor: '&H00000000',
    backColor: '&HA0000000',
    bold: -1,
    italic: 0,
    outline: 4,
    shadow: 2,
    spacing: 4,
    uppercase: true,
    scaleFactor: 110,
    marginV: 360
  }
};

export function isSubtitleStylePreset(val: string): val is SubtitleStylePreset {
  return val in SUBTITLE_STYLE_PRESETS;
}

export interface KineticASSOptions {
  style?: SubtitleStylePreset | string;
  fontSize?: number;
  primaryColor?: string;
  highlightColor?: string;
  wordsPerGroup?: number;
  /** Cap on how long the final word of a group stays on screen. */
  maxWordDuration?: number;
  /** Silence longer than this ends the current caption group. */
  gapThreshold?: number;
  marginV?: number;
}

export const ASS_DEFAULTS = {
  fontSize: 62,
  primaryColor: '&H00FFFFFF',
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

  /** Resolves preset configuration combined with custom overrides. */
  static resolveStyle(options: KineticASSOptions = {}): SubtitleStyleConfig {
    const presetKey = (options.style || 'default').toLowerCase() as SubtitleStylePreset;
    const base = isSubtitleStylePreset(presetKey)
      ? SUBTITLE_STYLE_PRESETS[presetKey]
      : SUBTITLE_STYLE_PRESETS.default;

    return {
      ...base,
      fontSize: options.fontSize || base.fontSize,
      primaryColor: options.primaryColor || base.primaryColor,
      highlightColor: options.highlightColor || base.highlightColor,
      marginV: options.marginV || base.marginV
    };
  }

  /**
   * Generates an ASS (Advanced SubStation Alpha) subtitle script with kinetic
   * word highlighting and selectable typography style preset.
   */
  static generateKineticASS(words: WordTimestamp[], options: KineticASSOptions = {}): string {
    const style = ASSGenerator.resolveStyle(options);
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
Style: KineticTitle, ${style.fontName}, ${style.fontSize}, ${style.primaryColor}, &H000000FF, ${style.outlineColor}, ${style.backColor}, ${style.bold}, ${style.italic}, 0, 0, 100, 100, ${style.spacing}, 0, 1, ${style.outline}, ${style.shadow}, 2, 50, 50, ${style.marginV}, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const cleanWords = ASSGenerator.sanitizeWords(words);
    const lines: string[] = [];

    for (const group of ASSGenerator.groupWords(cleanWords, groupSize, gapThreshold)) {
      for (let j = 0; j < group.length; j++) {
        const activeWord = group[j];
        const startTime = activeWord.start;

        let endTime =
          j < group.length - 1
            ? group[j + 1].start
            : Math.min(activeWord.end, startTime + maxWordDuration);

        if (endTime <= startTime) {
          endTime = startTime + ASS_DEFAULTS.minWordDuration;
        }

        const textParts = group.map((w, idx) => {
          const raw = w.word.trim().replace(/[{}]/g, '');
          const formatted = style.uppercase ? raw.toUpperCase() : raw;
          if (idx === j) {
            const scale = style.scaleFactor;
            return `{\\c${style.highlightColor}\\t(0,80,\\fscx${scale}\\fscy${scale})\\t(80,160,\\fscx100\\fscy100)}${formatted}{\\r}`;
          }
          return `{\\c${style.primaryColor}}${formatted}{\\r}`;
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
