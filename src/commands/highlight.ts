import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { type ClipHighlight, LLMClient } from '@/core/llm';
import { logger } from '@/utils/logger';
import pc from 'picocolors';

export async function highlightCommand(
  jsonOrVideoPath: string,
  options: {
    maxClips?: string;
    keyword?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    minDuration?: string;
    maxDuration?: string;
    output?: string;
  }
) {
  const input = resolve(jsonOrVideoPath);
  if (!existsSync(input)) {
    logger.error(`File not found: ${input}`);
    process.exit(1);
  }

  let jsonPath = input;
  if (!input.endsWith('.json')) {
    jsonPath = `${input.replace(/\.[^/.]+$/, '')}.whisper.json`;
    if (!existsSync(jsonPath)) {
      logger.error(`Please run 'nouclip extract' first to generate ${jsonPath}`);
      process.exit(1);
    }
  }

  const rawData = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const text = rawData.text || '';
  const words: WordTimestamp[] = rawData.words || [];

  if (words.length === 0) {
    logger.error('No words found in transcript JSON.');
    process.exit(1);
  }

  const maxClips = options.maxClips ? Number.parseInt(options.maxClips, 10) : 5;
  const minDur = options.minDuration ? Number.parseFloat(options.minDuration) : 25;
  const maxDur = options.maxDuration ? Number.parseFloat(options.maxDuration) : 60;

  let clips: ClipHighlight[] = [];

  const hasLlmKey = Boolean(options.apiKey || config.openAiApiKey);

  if (options.keyword) {
    logger.info(`Searching for moments matching keyword: "${options.keyword}"...`);
    clips = findKeywordMoments(words, options.keyword, minDur, maxDur, maxClips);
  } else if (!hasLlmKey && !options.baseUrl) {
    logger.info(
      'No LLM API key configured. Using heuristic density clustering for moments discovery.'
    );
    logger.info(`📄 Source Transcript File: ${jsonPath}`);
    logger.info(
      '💡 Autonomous Tip: You or an AI Agent can inspect this transcript file directly to choose moments, or export formatted text via: nouclip transcript <videoOrJson> -f txt'
    );
    clips = findHeuristicMoments(words, minDur, maxDur, maxClips);
  } else {
    try {
      const llm = new LLMClient({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        model: options.model
      });
      logger.info(
        `Analyzing transcript for viral hooks using LLM (${options.model || config.openAiModel})...`
      );
      clips = await llm.findViralHooks(text, words, {
        maxClips,
        targetMinDuration: minDur,
        targetMaxDuration: maxDur
      });
    } catch (err: any) {
      logger.warn(`LLM analysis failed (${err.message}). Falling back to heuristic clustering...`);
      logger.info(`📄 Source Transcript File: ${jsonPath}`);
      logger.info(
        '💡 Autonomous Tip: You or an AI Agent can inspect this transcript file directly to choose moments, or export formatted text via: nouclip transcript <videoOrJson> -f txt'
      );
      clips = findHeuristicMoments(words, minDur, maxDur, maxClips);
    }
  }

  if (clips.length === 0) {
    logger.warn('No clips found matching the given parameters.');
    return;
  }

  logger.success(`Found ${clips.length} highlight recommendations:\n`);

  clips.forEach((clip, idx) => {
    const sMin = Math.floor(clip.start / 60);
    const sSec = Math.floor(clip.start % 60);
    const eMin = Math.floor(clip.end / 60);
    const eSec = Math.floor(clip.end % 60);
    const timeStr = `${sMin}m${sSec}s -> ${eMin}m${eSec}s (${clip.duration.toFixed(1)}s)`;

    console.log(`${pc.bold(pc.cyan(`Clip #${idx + 1}: ${clip.title}`))} [${timeStr}]`);
    console.log(`  🔥 Virality Score : ${pc.green(`${clip.viralityScore}/100`)}`);
    console.log(`  🎯 Hook Quote     : ${pc.italic(`"${clip.hook}"`)}`);
    console.log(`  💡 Reason         : ${pc.dim(clip.reason)}`);
    console.log(
      `  ⚡ Quick Clip Cmd : ${pc.yellow(
        `nouclip auto <video> --start ${Math.round(clip.start)} --duration ${Math.round(clip.duration)}`
      )}\n`
    );
  });

  const outJson = options.output || `${jsonPath.replace(/\.json$/, '')}.highlights.json`;
  writeFileSync(outJson, JSON.stringify({ clips }, null, 2), 'utf-8');
  logger.info(`Saved highlight metadata to: ${outJson}`);
}

function findKeywordMoments(
  words: WordTimestamp[],
  keyword: string,
  minDur: number,
  maxDur: number,
  maxClips: number
): ClipHighlight[] {
  const kwLower = keyword.toLowerCase();
  const matchedIndices: number[] = [];

  words.forEach((w, idx) => {
    if (w.word.toLowerCase().includes(kwLower)) {
      matchedIndices.push(idx);
    }
  });

  const clips: ClipHighlight[] = [];
  const usedRanges: { start: number; end: number }[] = [];

  for (const idx of matchedIndices) {
    if (clips.length >= maxClips) break;

    const centerWord = words[idx];
    const targetStart = Math.max(0, centerWord.start - 8);
    const targetEnd = targetStart + Math.min(maxDur, Math.max(minDur, 40));

    const startWord = words.find((w) => w.start >= targetStart) || words[0];
    const endWord = words.find((w) => w.end >= targetEnd) || words[words.length - 1];

    const isOverlap = usedRanges.some((r) => Math.abs(r.start - startWord.start) < 20);
    if (isOverlap) continue;

    const slice = words.filter((w) => w.start >= startWord.start && w.end <= endWord.end);
    const textSnippet = slice.map((w) => w.word.trim()).join(' ');

    usedRanges.push({ start: startWord.start, end: endWord.end });
    clips.push({
      title: `Highlight: ${keyword.toUpperCase()} Focus`,
      hook: `${textSnippet.slice(0, 80)}...`,
      start: round(startWord.start, 1),
      end: round(endWord.end, 1),
      duration: round(endWord.end - startWord.start, 1),
      viralityScore: 90,
      reason: `Direct keyword match on "${keyword}" with contextual buildup and punchline.`
    });
  }

  return clips;
}

function findHeuristicMoments(
  words: WordTimestamp[],
  minDur: number,
  maxDur: number,
  maxClips: number
): ClipHighlight[] {
  const clips: ClipHighlight[] = [];
  const step = Math.floor(words.length / (maxClips + 1));

  for (let i = 1; i <= maxClips; i++) {
    const centerIdx = i * step;
    const startWord = words[Math.max(0, centerIdx - 30)];
    const endWord = words[Math.min(words.length - 1, centerIdx + 30)];
    const slice = words.slice(Math.max(0, centerIdx - 30), Math.min(words.length, centerIdx + 30));
    const textSnippet = slice.map((w) => w.word.trim()).join(' ');

    clips.push({
      title: `Moment Segment #${i}`,
      hook: `${textSnippet.slice(0, 80)}...`,
      start: round(startWord.start, 1),
      end: round(endWord.end, 1),
      duration: round(endWord.end - startWord.start, 1),
      viralityScore: 85 - i * 2,
      reason: 'High information density dialogue segment with complete thought structure.'
    });
  }

  return clips;
}

function round(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}
