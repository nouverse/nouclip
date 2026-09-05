/**
 * Time and timestamp parsing utilities for NouClip.
 * Supports:
 * - Seconds: "85", "85.5", 85
 * - MM:SS: "13:25"
 * - HH:MM:SS: "01:13:25"
 * - Human units: "1h30m", "13m25s", "45s"
 * - Ranges: "13:25-14:50", "13:25..14:50", "13:25 to 14:50"
 */

export interface ParsedTimeRange {
  start: number;
  end?: number;
  duration: number;
  raw: string;
}

const SECONDS_RE = /^\d+(?:\.\d+)?$/;
const HUMAN_UNITS_RE = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/;

export function parseTimestamp(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === '') return 0;

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error(`Invalid timestamp: "${val}"`);
    }
    return Math.max(0, val);
  }

  const str = val.trim().toLowerCase();
  if (str === '') return 0;

  // 1. Pure float / integer string ("85", "85.5")
  if (SECONDS_RE.test(str)) {
    return Number.parseFloat(str);
  }

  // 2. Colon separated: "HH:MM:SS" or "MM:SS" or "MM:SS.mmm"
  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length !== 2 && parts.length !== 3) {
      throw new Error(`Invalid timestamp format: "${val}" (expected MM:SS or HH:MM:SS)`);
    }

    const nums = parts.map((p) => {
      if (!SECONDS_RE.test(p.trim())) {
        throw new Error(`Invalid timestamp format: "${val}"`);
      }
      return Number.parseFloat(p);
    });

    const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
    return h * 3600 + m * 60 + s;
  }

  // 3. Human units: e.g. "1h30m20s", "13m25s", "45s"
  const match = HUMAN_UNITS_RE.exec(str);
  if (match && (match[1] || match[2] || match[3])) {
    const h = match[1] ? Number.parseFloat(match[1]) : 0;
    const m = match[2] ? Number.parseFloat(match[2]) : 0;
    const s = match[3] ? Number.parseFloat(match[3]) : 0;
    return h * 3600 + m * 60 + s;
  }

  throw new Error(`Could not parse timestamp: "${val}"`);
}

export function parseRange(rangeStr: string, defaultDuration = 30): ParsedTimeRange {
  if (typeof rangeStr !== 'string' || rangeStr.trim() === '') {
    throw new Error('Range is empty. Expected e.g. "13:25-14:50".');
  }

  const trimmed = rangeStr.trim();

  // Delimiters: "..", " to ", ",", "-"
  let startStr = '';
  let endStr = '';

  if (trimmed.includes('..')) {
    [startStr, endStr] = trimmed.split('..').map((s) => s.trim());
  } else if (trimmed.includes(' to ')) {
    [startStr, endStr] = trimmed.split(' to ').map((s) => s.trim());
  } else if (trimmed.includes(',')) {
    [startStr, endStr] = trimmed.split(',').map((s) => s.trim());
  } else if (trimmed.includes('-')) {
    // Note: could be 13:25-14:50 or 10-40
    const dashIdx = trimmed.indexOf('-');
    startStr = trimmed.slice(0, dashIdx).trim();
    endStr = trimmed.slice(dashIdx + 1).trim();
  } else {
    startStr = trimmed;
  }

  const start = parseTimestamp(startStr);
  let end: number | undefined;
  let duration: number;

  if (endStr) {
    end = parseTimestamp(endStr);
    if (end <= start) {
      throw new Error(
        `Invalid range "${rangeStr}": end (${endStr}) must be after start (${startStr})`
      );
    }
    duration = end - start;
  } else {
    duration = defaultDuration;
  }

  return {
    start,
    end,
    duration,
    raw: rangeStr
  };
}

export function formatSecondsToTimestamp(sec: number, includeHours = false): string {
  const s = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (includeHours || hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Zero-padded `HH:MM:SS<sep>mmm` used by SRT (",") and WebVTT (".") cues. */
export function formatCueTime(seconds: number, msSeparator: ',' | '.'): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  // Round to milliseconds before splitting: `s % 1` is lossy in binary floats.
  const totalMs = Math.round(s * 1000);
  const ms = totalMs % 1000;
  const totalSecs = (totalMs - ms) / 1000;

  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  return `${pad(Math.floor(totalSecs / 3600))}:${pad(Math.floor((totalSecs % 3600) / 60))}:${pad(totalSecs % 60)}${msSeparator}${pad(ms, 3)}`;
}
