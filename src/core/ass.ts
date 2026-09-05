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

export class ASSGenerator {
  /**
   * Generates ASS (Advanced SubStation Alpha) subtitle file
   * with kinetic highlighted words (active word turns yellow/cyber-amber with bounce).
   *
   * Features:
   * - Lower-Third Alignment (bottom center, safe zone above TikTok/Reels UI)
   * - Max word duration cap (1.2s max per word to prevent stuck lingering subtitles)
   * - Silence gap handling (subtitles disappear during pauses > 0.4s)
   */
  static generateKineticASS(
    words: WordTimestamp[],
    options: {
      fontSize?: number;
      primaryColor?: string;
      highlightColor?: string;
      wordsPerGroup?: number;
      maxWordDuration?: number;
      gapThreshold?: number;
    } = {}
  ): string {
    const fontSize = options.fontSize || 62;
    const primaryColor = options.primaryColor || '&H00FFFFFF'; // White
    const highlightColor = options.highlightColor || '&H0000FFFF'; // Bright Yellow / Cyber Amber
    const maxWordDuration = options.maxWordDuration || 1.0; // Max duration to display an active word
    const gapThreshold = options.gapThreshold || 0.4; // Silence threshold to hide subtitle

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

    // Filter out invalid/empty words
    const cleanWords = words.filter((w) => w.word && w.word.trim().length > 0);
    const groupSize = options.wordsPerGroup || 2;
    const lines: string[] = [];

    let i = 0;
    while (i < cleanWords.length) {
      // Build group of words, breaking early if there's a long pause (> gapThreshold)
      const group: WordTimestamp[] = [cleanWords[i]];
      let nextIdx = i + 1;

      while (nextIdx < cleanWords.length && group.length < groupSize) {
        const prevWord = group[group.length - 1];
        const nextWord = cleanWords[nextIdx];
        if (nextWord.start - prevWord.end > gapThreshold) {
          // Pause detected, end group here
          break;
        }
        group.push(nextWord);
        nextIdx++;
      }

      // Generate dialogue entries for each active word in this group
      for (let j = 0; j < group.length; j++) {
        const activeWord = group[j];
        const startTime = activeWord.start;

        // Calculate end time: cap long trailing pauses
        let endTime = activeWord.end;
        if (j < group.length - 1) {
          endTime = group[j + 1].start;
        } else {
          // Last word in group: cap to maxWordDuration
          endTime = Math.min(endTime, startTime + maxWordDuration);
        }

        // Ensure minimum visibility of 0.25s and valid range
        if (endTime <= startTime) {
          endTime = startTime + 0.3;
        }

        const startStr = ASSGenerator.formatTime(startTime);
        const endStr = ASSGenerator.formatTime(endTime);

        // Build text with active word pop
        const textParts = group.map((w, idx) => {
          const cleanText = w.word.trim().toUpperCase().replace(/[{}]/g, '');
          if (idx === j) {
            return `{\\c${highlightColor}\\t(0,80,\\fscx112\\fscy112)\\t(80,160,\\fscx100\\fscy100)}${cleanText}{\\r}`;
          }
          return `{\\c${primaryColor}}${cleanText}{\\r}`;
        });

        const dialogue = `Dialogue: 0,${startStr},${endStr},KineticTitle,,0,0,0,,${textParts.join(' ')}`;
        lines.push(dialogue);
      }

      i = nextIdx;
    }

    return `${header + lines.join('\n')}\n`;
  }

  static formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);

    const h = hrs.toString();
    const m = mins.toString().padStart(2, '0');
    const s = secs.toString().padStart(2, '0');
    const c = cs.toString().padStart(2, '0');

    return `${h}:${m}:${s}.${c}`;
  }
}
