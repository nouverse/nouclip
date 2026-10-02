import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YouTubeDownloader } from '@/core/youtube';

describe('YouTubeDownloader.isYouTubeUrl', () => {
  it('accepts the common URL shapes', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'http://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'youtube.com/watch?v=dQw4w9WgXcQ'
    ]) {
      expect(YouTubeDownloader.isYouTubeUrl(url)).toBe(true);
    }
  });

  it('rejects non-YouTube inputs', () => {
    for (const url of [
      'https://vimeo.com/123',
      '/local/path/video.mp4',
      'https://youtube.com',
      'notaurl'
    ]) {
      expect(YouTubeDownloader.isYouTubeUrl(url)).toBe(false);
    }
  });
});

describe('YouTubeDownloader.extractVideoId', () => {
  it('extracts the id from every supported shape', () => {
    const cases = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ'
    ];
    for (const url of cases) {
      expect(YouTubeDownloader.extractVideoId(url)).toBe('dQw4w9WgXcQ');
    }
  });

  it('ignores trailing query parameters', () => {
    expect(YouTubeDownloader.extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe(
      'dQw4w9WgXcQ'
    );
  });

  it('returns null when there is no id', () => {
    expect(YouTubeDownloader.extractVideoId('https://vimeo.com/123')).toBeNull();
    expect(YouTubeDownloader.extractVideoId('https://youtu.be/short')).toBeNull();
  });
});

describe('YouTubeDownloader.buildDownloadArgs', () => {
  it('requests a merged mp4 and prints the final path', () => {
    const args = YouTubeDownloader.buildDownloadArgs('URL', { outTemplate: '/out/%(id)s.%(ext)s' });

    expect(args[0]).toBe('URL');
    expect(args).toContain('--merge-output-format');
    expect(args).toContain('--no-playlist');
    expect(args[args.indexOf('-o') + 1]).toBe('/out/%(id)s.%(ext)s');
    expect(args[args.indexOf('--print') + 1]).toBe('after_move:filepath');
    expect(args).not.toContain('--ffmpeg-location');
    expect(args).not.toContain('--download-sections');
  });

  it('passes the ffmpeg location when one is configured', () => {
    const args = YouTubeDownloader.buildDownloadArgs('URL', {
      outTemplate: 'o',
      ffmpegDir: '/opt/ffmpeg/bin'
    });
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('/opt/ffmpeg/bin');
  });

  it('formats a section download', () => {
    const args = YouTubeDownloader.buildDownloadArgs('URL', {
      outTemplate: 'o',
      section: { start: 30, end: 75 }
    });
    expect(args[args.indexOf('--download-sections') + 1]).toBe('*30-75');
    expect(args).toContain('--force-keyframes-at-cuts');
  });
});

describe('YouTubeDownloader.parsePrintedPath', () => {
  const exists = (p: string) => p === '/out/video.mp4';

  it('returns the last printed mp4 that exists on disk', () => {
    const stdout = '[download] 50%\n/out/missing.mp4\n/out/video.mp4\n';
    expect(YouTubeDownloader.parsePrintedPath(stdout, exists)).toBe('/out/video.mp4');
  });

  it('ignores progress noise and non-mp4 lines', () => {
    expect(YouTubeDownloader.parsePrintedPath('[download] 100% of 5MiB\n', exists)).toBeNull();
  });

  it('returns null for empty output', () => {
    expect(YouTubeDownloader.parsePrintedPath('   \n\n', exists)).toBeNull();
  });
});

describe('YouTubeDownloader.findExistingDownload', () => {
  let tmpDir: string;
  const videoId = 'dQw4w9WgXcQ';
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nouclip-ytdl-test-'));
    const dummyPayload = Buffer.alloc(2048, 'a');
    writeFileSync(join(tmpDir, `Rick Astley [${videoId}].mp4`), dummyPayload);
    writeFileSync(join(tmpDir, `Rick Astley [${videoId}]_30s-75s.mp4`), dummyPayload);
    writeFileSync(join(tmpDir, 'Tiny [SmallOnlyXX].mp4'), Buffer.alloc(100, 'x'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches full download when no section is requested', () => {
    const hit = YouTubeDownloader.findExistingDownload(url, tmpDir);
    expect(hit).toBe(join(tmpDir, `Rick Astley [${videoId}].mp4`));
  });

  it('matches section download with exact start and end seconds', () => {
    const hit = YouTubeDownloader.findExistingDownload(url, tmpDir, { start: 30, end: 75 });
    expect(hit).toBe(join(tmpDir, `Rick Astley [${videoId}]_30s-75s.mp4`));
  });

  it('returns null when requested section is not cached', () => {
    const hit = YouTubeDownloader.findExistingDownload(url, tmpDir, { start: 0, end: 20 });
    expect(hit).toBeNull();
  });

  it('returns null when cached file is below MIN_CACHED_BYTES', () => {
    const hit = YouTubeDownloader.findExistingDownload(
      'https://www.youtube.com/watch?v=SmallOnlyXX',
      tmpDir
    );
    expect(hit).toBeNull();
  });
});
