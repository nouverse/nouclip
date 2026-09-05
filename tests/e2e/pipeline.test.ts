import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSGenerator } from '@/core/ass';
import { FFmpegRunner } from '@/core/ffmpeg';

/** These tests need a real ffmpeg/ffprobe; they self-skip when it is absent. */
async function hasBinary(bin: string): Promise<boolean> {
  try {
    await FFmpegRunner.exec(bin, ['-version']);
    return true;
  } catch {
    return false;
  }
}

const ffmpegAvailable =
  (await hasBinary(FFmpegRunner.getFFmpegPath())) &&
  (await hasBinary(FFmpegRunner.getFFprobePath()));

let dir: string;
let source: string;

beforeAll(async () => {
  if (!ffmpegAvailable) return;

  dir = mkdtempSync(join(tmpdir(), 'nouclip-pipeline-'));
  source = join(dir, 'source.mp4');

  // 3s of 640x360 colour bars with a tone, so audio and video both exist.
  await FFmpegRunner.exec(FFmpegRunner.getFFmpegPath(), [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=15:duration=3',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    source
  ]);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!ffmpegAvailable)('ffmpeg pipeline', () => {
  it('probes real metadata', async () => {
    const meta = await FFmpegRunner.getMetadata(source);
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(360);
    expect(meta.hasAudio).toBe(true);
    expect(meta.duration).toBeGreaterThan(2.5);
    expect(meta.fps).toBe(15);
  }, 60_000);

  it('cuts a segment', async () => {
    const out = join(dir, 'cut.mp4');
    await FFmpegRunner.cutVideo(source, out, 1, 1, true);

    const meta = await FFmpegRunner.getMetadata(out);
    expect(meta.duration).toBeLessThan(1.6);
    expect(meta.duration).toBeGreaterThan(0.4);
  }, 60_000);

  it('reframes to 9:16 in every framing mode', async () => {
    for (const mode of ['blur', 'center', 'pad', 'stretch'] as const) {
      const out = join(dir, `framed-${mode}.mp4`);
      await FFmpegRunner.reframe(source, out, { aspect: '9:16', mode });

      const meta = await FFmpegRunner.getMetadata(out);
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1920);
    }
  }, 180_000);

  it('extracts 16kHz mono audio', async () => {
    const wav = join(dir, 'audio.wav');
    await FFmpegRunner.extractAudio(source, wav);

    expect(existsSync(wav)).toBe(true);
    expect(statSync(wav).size).toBeGreaterThan(1000);
  }, 60_000);

  it('burns subtitles from a path containing filter metacharacters', async () => {
    // yt-dlp names files after the video title: quotes, commas and brackets
    // are routine, and used to break the ass= filtergraph.
    const trickyDir = join(dir, "Ep 12 - it's 'weird', [really]");
    const trickyAss = join(trickyDir, 'kinetic.ass');
    const out = join(dir, 'burned.mp4');

    Bun.write(join(trickyDir, '.keep'), '');
    await Bun.write(
      trickyAss,
      ASSGenerator.generateKineticASS([
        { word: 'Halo', start: 0, end: 0.6 },
        { word: 'dunia', start: 0.6, end: 1.2 }
      ])
    );
    expect(existsSync(trickyAss)).toBe(true);

    await FFmpegRunner.burnSubtitles(source, trickyAss, out);

    const meta = await FFmpegRunner.getMetadata(out);
    expect(meta.width).toBe(640);
    expect(existsSync(out)).toBe(true);
  }, 120_000);

  it('reports a readable error for a corrupt input', async () => {
    const broken = join(dir, 'broken.mp4');
    writeFileSync(broken, 'this is not a video');
    await expect(FFmpegRunner.getMetadata(broken)).rejects.toThrow();
  }, 60_000);
});
