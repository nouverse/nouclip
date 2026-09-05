import { describe, expect, it } from 'bun:test';
import { FFmpegRunner, isFramingMode } from '@/core/ffmpeg';

describe('FFmpegRunner.parseAspectRatio', () => {
  it('parses standard presets and their aliases', () => {
    expect(FFmpegRunner.parseAspectRatio('9:16')).toEqual({
      width: 1080,
      height: 1920,
      name: '9:16'
    });
    expect(FFmpegRunner.parseAspectRatio('vertical')).toEqual({
      width: 1080,
      height: 1920,
      name: '9:16'
    });
    expect(FFmpegRunner.parseAspectRatio('tiktok').name).toBe('9:16');
    expect(FFmpegRunner.parseAspectRatio('1:1')).toEqual({
      width: 1080,
      height: 1080,
      name: '1:1'
    });
    expect(FFmpegRunner.parseAspectRatio('16:9')).toEqual({
      width: 1920,
      height: 1080,
      name: '16:9'
    });
    expect(FFmpegRunner.parseAspectRatio('4:5')).toEqual({
      width: 1080,
      height: 1350,
      name: '4:5'
    });
    expect(FFmpegRunner.parseAspectRatio('4:3')).toEqual({
      width: 1440,
      height: 1080,
      name: '4:3'
    });
  });

  it('accepts "x" as a separator and is case insensitive', () => {
    expect(FFmpegRunner.parseAspectRatio('9x16').name).toBe('9:16');
    expect(FFmpegRunner.parseAspectRatio(' VERTICAL ').name).toBe('9:16');
  });

  it('computes custom ratios with even dimensions', () => {
    const portrait = FFmpegRunner.parseAspectRatio('3:4');
    expect(portrait).toEqual({ width: 1080, height: 1440, name: '3:4' });

    const landscape = FFmpegRunner.parseAspectRatio('21:9');
    expect(landscape.height).toBe(1080);
    expect(landscape.width % 2).toBe(0);
  });

  it('falls back to 9:16 for unusable input', () => {
    expect(FFmpegRunner.parseAspectRatio('nonsense').name).toBe('9:16');
    expect(FFmpegRunner.parseAspectRatio('0:0').name).toBe('9:16');
    expect(FFmpegRunner.parseAspectRatio('a:b').name).toBe('9:16');
    expect(FFmpegRunner.parseAspectRatio().name).toBe('9:16');
  });

  it('builds a filesystem-safe slug', () => {
    expect(FFmpegRunner.aspectSlug(FFmpegRunner.parseAspectRatio('9:16'))).toBe('9x16');
  });
});

describe('framing modes', () => {
  it('recognizes only the supported modes', () => {
    expect(isFramingMode('blur')).toBe(true);
    expect(isFramingMode('center')).toBe(true);
    expect(isFramingMode('pad')).toBe(true);
    expect(isFramingMode('stretch')).toBe(true);
    expect(isFramingMode('zoom')).toBe(false);
  });
});

describe('FFmpegRunner.buildCutArgs', () => {
  it('seeks before the input and stream-copies by default', () => {
    const args = FFmpegRunner.buildCutArgs('in.mp4', 'out.mp4', 12, 30);
    expect(args.slice(0, 7)).toEqual(['-y', '-ss', '12', '-i', 'in.mp4', '-t', '30']);
    expect(args).toContain('copy');
    expect(args).not.toContain('libx264');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('re-encodes when asked', () => {
    const args = FFmpegRunner.buildCutArgs('in.mp4', 'out.mp4', 0, 5, true);
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
  });
});

describe('FFmpegRunner.buildExtractAudioArgs', () => {
  it('produces 16kHz mono PCM by default', () => {
    const args = FFmpegRunner.buildExtractAudioArgs('in.mp4', 'out.wav');
    expect(args).toEqual([
      '-y',
      '-i',
      'in.mp4',
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      'out.wav'
    ]);
  });

  it('applies a range and custom sample rate', () => {
    const args = FFmpegRunner.buildExtractAudioArgs('in.mp4', 'out.wav', {
      start: 10,
      duration: 20,
      sampleRate: 48000
    });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toContain('20');
    expect(args).toContain('48000');
  });
});

describe('FFmpegRunner.buildReframeArgs', () => {
  it('uses a blurred-background filtergraph by default', () => {
    const args = FFmpegRunner.buildReframeArgs('in.mp4', 'out.mp4');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('gblur=sigma=30');
    expect(filter).toContain('scale=1080:1920');
    expect(filter).toContain('overlay=(W-w)/2:(H-h)/2');
  });

  it('crops for center mode', () => {
    const args = FFmpegRunner.buildReframeArgs('in.mp4', 'out.mp4', { mode: 'center' });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('force_original_aspect_ratio=increase');
    expect(vf).toContain('crop=1080:1920');
  });

  it('letterboxes for pad mode', () => {
    const vf = (() => {
      const args = FFmpegRunner.buildReframeArgs('in.mp4', 'out.mp4', { mode: 'pad' });
      return args[args.indexOf('-vf') + 1];
    })();
    expect(vf).toContain('pad=1080:1920');
    expect(vf).toContain('color=black');
  });

  it('scales without preserving aspect for stretch mode', () => {
    const args = FFmpegRunner.buildReframeArgs('in.mp4', 'out.mp4', { mode: 'stretch' });
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=1080:1920,setsar=1');
  });

  it('honours explicit target dimensions', () => {
    const args = FFmpegRunner.buildReframeArgs('in.mp4', 'out.mp4', {
      mode: 'stretch',
      targetWidth: 720,
      targetHeight: 1280
    });
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=720:1280,setsar=1');
  });
});

describe('FFmpegRunner.escapeFilterPath', () => {
  it('escapes filtergraph metacharacters', () => {
    expect(FFmpegRunner.escapeFilterPath('C:\\clips\\a.ass')).toBe('C\\:/clips/a.ass');
    expect(FFmpegRunner.escapeFilterPath("/tmp/it's [x], y.ass")).toBe(
      "/tmp/it\\'s \\[x\\]\\, y.ass"
    );
  });

  it('wraps the escaped path in the ass filter', () => {
    const args = FFmpegRunner.buildBurnSubtitlesArgs('in.mp4', '/tmp/x/subtitles.ass', 'out.mp4');
    expect(args[args.indexOf('-vf') + 1]).toBe("ass='/tmp/x/subtitles.ass'");
    expect(args).toContain('libx264');
  });
});

describe('FFmpegRunner.buildMixBgmArgs', () => {
  it('builds sidechain ducking filtergraph for video with audio', () => {
    const args = FFmpegRunner.buildMixBgmArgs('video.mp4', 'bgm.mp3', 'out.mp4', {
      bgmVolume: 0.15,
      ducking: true
    });
    expect(args).toContain('-filter_complex');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('sidechaincompress');
    expect(filter).toContain('volume=0.15');
    expect(args).toContain('-shortest');
  });

  it('builds constant volume mix when ducking is false', () => {
    const args = FFmpegRunner.buildMixBgmArgs('video.mp4', 'bgm.mp3', 'out.mp4', {
      bgmVolume: 0.25,
      ducking: false
    });
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).not.toContain('sidechaincompress');
    expect(filter).toContain('amix');
  });
});

describe('FFmpegRunner.buildTrimSilenceArgs', () => {
  it('builds concat filtergraph for multiple speech intervals', () => {
    const args = FFmpegRunner.buildTrimSilenceArgs('in.mp4', 'out.mp4', [
      { start: 0, end: 4 },
      { start: 6, end: 10 }
    ]);
    expect(args).toContain('-filter_complex');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('trim=start=0:end=4');
    expect(filter).toContain('trim=start=6:end=10');
    expect(filter).toContain('concat=n=2:v=1:a=1');
  });
});

describe('FFmpegRunner.parseProbeOutput', () => {
  it('reads dimensions, duration and fps from the video stream', () => {
    const meta = FFmpegRunner.parseProbeOutput(
      JSON.stringify({
        streams: [
          { codec_type: 'audio', duration: '61.0' },
          { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '30000/1001' }
        ],
        format: { duration: '60.5' }
      })
    );

    expect(meta).toEqual({
      duration: 60.5,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true
    });
  });

  it('reports hasAudio false when no audio stream is present', () => {
    const meta = FFmpegRunner.parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: 'video', width: 640, height: 480, duration: '10' }]
      })
    );
    expect(meta.hasAudio).toBe(false);
    expect(meta.duration).toBe(10);
    expect(meta.fps).toBe(30);
  });

  it('degrades gracefully on an empty probe result', () => {
    expect(FFmpegRunner.parseProbeOutput('{}')).toEqual({
      duration: 0,
      width: 0,
      height: 0,
      fps: 30,
      hasAudio: false
    });
  });
});

describe('FFmpegRunner.exec', () => {
  it('rejects with an actionable message when the binary is missing', async () => {
    await expect(FFmpegRunner.exec('nouclip-nonexistent-binary', ['-version'])).rejects.toThrow(
      /not found/
    );
  });

  it('rejects on a non-zero exit code', async () => {
    await expect(
      FFmpegRunner.exec(process.execPath, ['-e', 'console.error("bad"); process.exit(3)'])
    ).rejects.toThrow(/exit 3/);
  });

  it('resolves with captured stdout', async () => {
    const { stdout } = await FFmpegRunner.exec(process.execPath, ['-e', 'console.log("hello")']);
    expect(stdout.trim()).toBe('hello');
  });
});
