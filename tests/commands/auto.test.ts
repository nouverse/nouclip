import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSource } from '@/commands/auto';
import type { TimeSelection } from '@/core/selection';
import { YouTubeDownloader } from '@/core/youtube';
import { CliError } from '@/utils/errors';

describe('auto command: resolveSource', () => {
  let tmpDir: string;
  let localVideo: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nouclip-auto-test-'));
    localVideo = join(tmpDir, 'sample.mp4');
    writeFileSync(localVideo, 'dummy');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads section-only for YouTube URL when time selection is active', async () => {
    const downloadSpy = spyOn(YouTubeDownloader, 'download').mockResolvedValue(
      '/path/to/downloaded_10s-35s.mp4'
    );

    const selection: TimeSelection = { start: 10, duration: 25, hasSelection: true };
    const res = await resolveSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {}, selection);

    expect(downloadSpy).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      outputDir: expect.any(String),
      section: { start: 10, end: 35 }
    });
    expect(res.isPreClipped).toBe(true);
    expect(res.path).toBe('/path/to/downloaded_10s-35s.mp4');

    downloadSpy.mockRestore();
  });

  it('forwards force flag to YouTubeDownloader', async () => {
    const downloadSpy = spyOn(YouTubeDownloader, 'download').mockResolvedValue(
      '/path/to/downloaded_forced.mp4'
    );

    const selection: TimeSelection = { start: 0, duration: 0, hasSelection: false };
    await resolveSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { force: true }, selection);

    expect(downloadSpy).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      outputDir: expect.any(String),
      force: true
    });

    downloadSpy.mockRestore();
  });

  it('downloads full video for YouTube URL when no selection is present', async () => {
    const downloadSpy = spyOn(YouTubeDownloader, 'download').mockResolvedValue(
      '/path/to/downloaded_full.mp4'
    );

    const selection: TimeSelection = { start: 0, duration: 0, hasSelection: false };
    const res = await resolveSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {}, selection);

    expect(downloadSpy).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      outputDir: expect.any(String)
    });
    expect(res.isPreClipped).toBe(false);
    expect(res.path).toBe('/path/to/downloaded_full.mp4');

    downloadSpy.mockRestore();
  });

  it('resolves existing local file as not pre-clipped', async () => {
    const selection: TimeSelection = { start: 10, duration: 25, hasSelection: true };
    const res = await resolveSource(localVideo, {}, selection);

    expect(res.isPreClipped).toBe(false);
    expect(res.path).toBe(localVideo);
  });

  it('throws CliError when local file does not exist', async () => {
    const selection: TimeSelection = { start: 0, duration: 0, hasSelection: false };
    expect(resolveSource(join(tmpDir, 'missing.mp4'), {}, selection)).rejects.toBeInstanceOf(
      CliError
    );
  });
});
