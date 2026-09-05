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

export function parseTimestamp(val: string | number | undefined): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Math.max(0, val);

  const str = val.trim().toLowerCase();

  // 1. Pure float / integer string ("85", "85.5")
  if (/^\d+(\.\d+)?$/.test(str)) {
    return Number.parseFloat(str);
  }

  // 2. Colon separated: "HH:MM:SS" or "MM:SS" or "MM:SS.mmm"
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => Number.parseFloat(p));
    if (parts.some((p) => Number.isNaN(p))) {
      throw new Error(`Invalid timestamp format: "${val}"`);
    }

    if (parts.length === 2) {
      // MM:SS
      const [m, s] = parts;
      return m * 60 + s;
    }
    if (parts.length === 3) {
      // HH:MM:SS
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    }
  }

  // 3. Human units: e.g. "1h30m20s", "13m25s", "45s"
  const unitRegex = /(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?/;
  const match = str.match(unitRegex);
  if (match && (match[1] || match[2] || match[3])) {
    const h = match[1] ? Number.parseFloat(match[1]) : 0;
    const m = match[2] ? Number.parseFloat(match[2]) : 0;
    const s = match[3] ? Number.parseFloat(match[3]) : 0;
    return h * 3600 + m * 60 + s;
  }

  const parsed = Number.parseFloat(str);
  if (!Number.isNaN(parsed)) return parsed;

  throw new Error(`Could not parse timestamp: "${val}"`);
}

export function parseRange(rangeStr: string, defaultDuration = 30): ParsedTimeRange {
  const trimmed = rangeStr.trim();

  // Delimiters: "-", "..", " to ", ","
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
    if (end < start) {
      throw new Error(
        `Invalid range: end timestamp (${endStr}) is before start timestamp (${startStr})`
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
  const s = Math.max(0, sec);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (includeHours || hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
