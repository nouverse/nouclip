import { describe, expect, it } from 'bun:test';
import { ASSGenerator } from '@/core/ass';
import { FFmpegRunner } from '@/core/ffmpeg';
import {
  formatSecondsToTimestamp,
  parseRange,
  parseTimestamp,
} from '@/utils/time';

describe('Time Utilities', () => {
  it('parses timestamps in various formats correctly', () => {
    expect(parseTimestamp('10')).toBe(10);
    expect(parseTimestamp('10s')).toBe(10);
    expect(parseTimestamp('01:30')).toBe(90);
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('01:02:03')).toBe(3723);
    expect(parseTimestamp('1m30s')).toBe(90);
    expect(parseTimestamp('2m')).toBe(120);
    expect(parseTimestamp('1h')).toBe(3600);
    expect(parseTimestamp('1h30m10s')).toBe(5410);
  });

  it('formats seconds to timestamp string', () => {
    expect(formatSecondsToTimestamp(90)).toBe('01:30');
    expect(formatSecondsToTimestamp(90, true)).toBe('00:01:30');
    expect(formatSecondsToTimestamp(3723)).toBe('01:02:03');
    expect(formatSecondsToTimestamp(0)).toBe('00:00');
  });

  it('parses time range strings correctly', () => {
    expect(parseRange('01:00-02:00')).toEqual({
      start: 60,
      end: 120,
      duration: 60,
      raw: '01:00-02:00',
    });
    expect(parseRange('10s-40s')).toEqual({
      start: 10,
      end: 40,
      duration: 30,
      raw: '10s-40s',
    });
    expect(parseRange('00:00..00:30')).toEqual({
      start: 0,
      end: 30,
      duration: 30,
      raw: '00:00..00:30',
    });
    expect(parseRange('01:00 to 01:45')).toEqual({
      start: 60,
      end: 105,
      duration: 45,
      raw: '01:00 to 01:45',
    });
  });
});

describe('Aspect Ratio Parser', () => {
  it('parses standard presets', () => {
    expect(FFmpegRunner.parseAspectRatio('9:16')).toEqual({
      width: 1080,
      height: 1920,
      name: '9:16',
    });
    expect(FFmpegRunner.parseAspectRatio('vertical')).toEqual({
      width: 1080,
      height: 1920,
      name: '9:16',
    });
    expect(FFmpegRunner.parseAspectRatio('1:1')).toEqual({
      width: 1080,
      height: 1080,
      name: '1:1',
    });
    expect(FFmpegRunner.parseAspectRatio('16:9')).toEqual({
      width: 1920,
      height: 1080,
      name: '16:9',
    });
    expect(FFmpegRunner.parseAspectRatio('4:5')).toEqual({
      width: 1080,
      height: 1350,
      name: '4:5',
    });
  });

  it('parses custom aspect ratios', () => {
    const custom = FFmpegRunner.parseAspectRatio('3:4');
    expect(custom.name).toBe('3:4');
    expect(custom.width).toBe(1080);
    expect(custom.height).toBe(1440);
  });
});

describe('ASS Subtitle Generator', () => {
  it('formats ASS timestamps properly', () => {
    expect(ASSGenerator.formatTime(0)).toBe('0:00:00.00');
    expect(ASSGenerator.formatTime(65.432)).toBe('0:01:05.43');
    expect(ASSGenerator.formatTime(3661.05)).toBe('1:01:01.05');
  });

  it('generates valid ASS script structure', () => {
    const words = [
      { word: 'Halo', start: 0.0, end: 0.4, probability: 0.99 },
      { word: 'ini', start: 0.45, end: 0.8, probability: 0.98 },
      { word: 'test', start: 0.85, end: 1.4, probability: 0.99 },
    ];

    const ass = ASSGenerator.generateKineticASS(words, {
      fontSize: 64,
    });

    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('Dialogue:');
  });
});
