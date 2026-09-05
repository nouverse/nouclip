import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { findHeuristicMoments, findKeywordMoments } from '@/core/highlights';
import { type ClipHighlight, LLMClient } from '@/core/llm';
import { CliError, getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
import pc from 'picocolors';

export interface HighlightCommandOptions {
  maxClips?: string;
  keyword?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  minDuration?: string;
  maxDuration?: string;
  budget?: string;
  output?: string;
}

/**
 * Keeps clips in ranked order while their total duration fits `budget`.
 * A clip that would overflow is skipped rather than ending the loop, so a
 * shorter lower-ranked moment can still use the remaining seconds. The top
 * clip is always kept: a budget below its length should not return nothing.
 */
export function applyDurationBudget<T extends { duration: number }>(
  clips: T[],
  budget: number
): T[] {
  const kept: T[] = [];
  let total = 0;

  for (const clip of clips) {
    if (kept.length > 0 && total + clip.duration > budget) continue;
    kept.push(clip);
    total += clip.duration;
  }

  return kept;
}

/** Parses a numeric CLI flag, rejecting garbage instead of silently NaN-ing. */
export function parseNumericOption(
  value: string | undefined,
  flag: string,
  fallback: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`Invalid ${flag} "${value}": expected a positive number.`);
  }
  return parsed;
}

/** Resolves the transcript JSON companion for a video path. */
export function resolveTranscriptJson(input: string): string {
  if (input.endsWith('.json')) return input;
  return `${input.replace(/\.[^/.]+$/, '')}.whisper.json`;
}

export async function highlightCommand(
  jsonOrVideoPath: string,
  options: HighlightCommandOptions = {}
) {
  config.ensureDirs();

  const input = resolveMediaInput(jsonOrVideoPath);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${jsonOrVideoPath} (Checked: ${input})`);
  }

  const jsonPath = resolveTranscriptJson(input);
  if (!existsSync(jsonPath)) {
    throw new CliError(`Run 'nouclip extract' first to generate ${jsonPath}`);
  }

  let rawData: { text?: string; words?: WordTimestamp[] };
  try {
    rawData = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    throw new CliError(`Could not read transcript JSON ${jsonPath}: ${getErrorMessage(err)}`);
  }

  const text = rawData.text || '';
  const words = rawData.words ?? [];
  if (words.length === 0) {
    throw new CliError(`No words found in transcript JSON: ${jsonPath}`);
  }

  const maxClips = Math.floor(parseNumericOption(options.maxClips, '--max-clips', 5));
  const minDur = parseNumericOption(options.minDuration, '--min-duration', 25);
  const maxDur = parseNumericOption(options.maxDuration, '--max-duration', 60);
  if (maxDur < minDur) {
    throw new CliError('--max-duration must be greater than or equal to --min-duration.');
  }
  const budget = parseNumericOption(options.budget, '--budget', 180);

  const discovered = await discoverClips(jsonPath, text, words, {
    keyword: options.keyword,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    maxClips,
    minDur,
    maxDur
  });

  const clips = applyDurationBudget(discovered, budget);
  if (clips.length < discovered.length) {
    logger.info(
      `Trimmed ${discovered.length - clips.length} clip(s) to stay within the ${budget}s total budget.`
    );
  }

  if (clips.length === 0) {
    logger.warn('No clips found matching the given parameters.');
    return;
  }

  logger.success(`Found ${clips.length} highlight recommendations:\n`);
  for (const [idx, clip] of clips.entries()) {
    printClip(idx, clip);
  }

  const outJson = options.output || `${jsonPath.replace(/\.json$/, '')}.highlights.json`;
  writeFileSync(outJson, JSON.stringify({ clips }, null, 2), 'utf-8');
  logger.info(`Saved highlight metadata to: ${outJson}`);
}

interface DiscoveryParams {
  keyword?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxClips: number;
  minDur: number;
  maxDur: number;
}

async function discoverClips(
  jsonPath: string,
  text: string,
  words: WordTimestamp[],
  opts: DiscoveryParams
): Promise<ClipHighlight[]> {
  const { maxClips, minDur, maxDur } = opts;

  if (opts.keyword) {
    logger.info(`Searching for moments matching keyword: "${opts.keyword}"...`);
    return findKeywordMoments(words, opts.keyword, minDur, maxDur, maxClips);
  }

  const hasLlm = Boolean(opts.apiKey || opts.baseUrl || config.openAiLlmApiKey);
  if (!hasLlm) {
    logger.info(
      'No LLM API key configured. Using heuristic density clustering for moments discovery.'
    );
    printAgentTip(jsonPath);
    return findHeuristicMoments(words, minDur, maxDur, maxClips);
  }

  try {
    const llm = new LLMClient({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model
    });
    logger.info(
      `Analyzing transcript for viral hooks using LLM (${opts.model || config.openAiLlmModel})...`
    );
    return await llm.findViralHooks(text, words, {
      maxClips,
      targetMinDuration: minDur,
      targetMaxDuration: maxDur
    });
  } catch (err) {
    logger.warn(
      `LLM analysis failed (${getErrorMessage(err)}). Falling back to heuristic clustering...`
    );
    printAgentTip(jsonPath);
    return findHeuristicMoments(words, minDur, maxDur, maxClips);
  }
}

function printAgentTip(jsonPath: string): void {
  logger.info(`📄 Source Transcript File: ${jsonPath}`);
  logger.info(
    '💡 Autonomous Tip: You or an AI Agent can inspect this transcript file directly to choose moments, or export formatted text via: nouclip transcript <videoOrJson> -f txt'
  );
}

function printClip(idx: number, clip: ClipHighlight): void {
  const stamp = (sec: number) => `${Math.floor(sec / 60)}m${Math.floor(sec % 60)}s`;
  const timeStr = `${stamp(clip.start)} -> ${stamp(clip.end)} (${clip.duration.toFixed(1)}s)`;

  console.log(`${pc.bold(pc.cyan(`Clip #${idx + 1}: ${clip.title}`))} [${timeStr}]`);
  console.log(`  🔥 Virality Score : ${pc.green(`${clip.viralityScore}/100`)}`);
  console.log(`  🎯 Hook Quote     : ${pc.italic(`"${clip.hook}"`)}`);
  console.log(`  💡 Reason         : ${pc.dim(clip.reason)}`);
  console.log(
    `  ⚡ Quick Clip Cmd : ${pc.yellow(
      `nouclip auto <video> --start ${Math.round(clip.start)} --duration ${Math.round(clip.duration)}`
    )}\n`
  );
}
