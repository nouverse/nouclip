import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { WhisperClient } from '@/core/whisper';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export async function transcriptCommand(
  videoOrJsonPath: string,
  options: {
    format?: 'txt' | 'srt' | 'vtt' | 'json';
    lang?: string;
    output?: string;
  }
) {
  config.ensureDirs();
  const input = resolveMediaInput(videoOrJsonPath);

  if (!existsSync(input)) {
    logger.error(`File not found: ${videoOrJsonPath} (Checked: ${input})`);
    process.exit(1);
  }

  const baseName = basename(input, extname(input));
  const format = options.format || 'txt';
  let rawData: { words: WordTimestamp[]; text: string; duration: number };

  if (input.endsWith('.json')) {
    logger.info(`Loading transcript from JSON: ${input}`);
    rawData = JSON.parse(readFileSync(input, 'utf-8'));
  } else {
    logger.info(`Extracting and transcribing ${input}...`);
    const tempWav = join(config.segmentDir, `${baseName}.temp.wav`);
    await FFmpegRunner.extractAudio(input, tempWav);
    const res = await WhisperClient.transcribe(tempWav, {
      language: options.lang || 'id'
    });
    rawData = res;
  }

  const words = rawData.words || [];
  const duration = rawData.duration || 0;

  if (words.length === 0) {
    logger.error('No words found in transcript.');
    process.exit(1);
  }

  let formattedContent = '';

  if (format === 'txt') {
    const lines: string[] = [
      '='.repeat(60),
      'TRANSCRIPT EXPORT (NOUCLIP)',
      `Source   : ${input}`,
      `Duration : ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s (${duration.toFixed(1)}s)`,
      `Words    : ${words.length}`,
      '='.repeat(60),
      ''
    ];

    let currentPara: string[] = [];
    let currentStart = 0.0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (currentPara.length === 0) currentStart = w.start;
      currentPara.push(w.word.trim());

      const isEnd =
        w.word.trim().endsWith('.') ||
        w.word.trim().endsWith('?') ||
        w.word.trim().endsWith('!') ||
        (i < words.length - 1 && words[i + 1].start - w.end > 1.2) ||
        currentPara.length >= 20;

      if (isEnd || i === words.length - 1) {
        const sMin = Math.floor(currentStart / 60)
          .toString()
          .padStart(2, '0');
        const sSec = Math.floor(currentStart % 60)
          .toString()
          .padStart(2, '0');
        const eMin = Math.floor(w.end / 60)
          .toString()
          .padStart(2, '0');
        const eSec = Math.floor(w.end % 60)
          .toString()
          .padStart(2, '0');
        lines.push(`[${sMin}:${sSec} -> ${eMin}:${eSec}] ${currentPara.join(' ')}\n`);
        currentPara = [];
      }
    }
    formattedContent = lines.join('\n');
  } else if (format === 'srt') {
    const srtBlocks: string[] = [];
    let blockIdx = 1;
    let group: WordTimestamp[] = [];

    for (let i = 0; i < words.length; i++) {
      group.push(words[i]);
      if (group.length >= 4 || i === words.length - 1) {
        const start = formatSrtTime(group[0].start);
        const end = formatSrtTime(group[group.length - 1].end);
        const text = group.map((w) => w.word.trim()).join(' ');
        srtBlocks.push(`${blockIdx++}\n${start} --> ${end}\n${text}\n`);
        group = [];
      }
    }
    formattedContent = srtBlocks.join('\n');
  } else if (format === 'vtt') {
    const vttBlocks: string[] = ['WEBVTT\n'];
    let group: WordTimestamp[] = [];

    for (let i = 0; i < words.length; i++) {
      group.push(words[i]);
      if (group.length >= 4 || i === words.length - 1) {
        const start = formatVttTime(group[0].start);
        const end = formatVttTime(group[group.length - 1].end);
        const text = group.map((w) => w.word.trim()).join(' ');
        vttBlocks.push(`${start} --> ${end}\n${text}\n`);
        group = [];
      }
    }
    formattedContent = vttBlocks.join('\n');
  } else if (format === 'json') {
    formattedContent = JSON.stringify(rawData, null, 2);
  }

  const outPath = options.output
    ? resolve(options.output)
    : join(config.transcriptDir, `${baseName}_transcript.${format}`);

  writeFileSync(outPath, formattedContent, 'utf-8');
  logger.success(`Transcript exported (${format.toUpperCase()}): ${outPath}`);
}

function formatSrtTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000)
    .toString()
    .padStart(3, '0');
  return `${hrs}:${mins}:${secs},${ms}`;
}

function formatVttTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000)
    .toString()
    .padStart(3, '0');
  return `${hrs}:${mins}:${secs}.${ms}`;
}
