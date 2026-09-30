import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { type VideoCaptionInfo, YouTubeCaptions } from '@/core/captions';
import { captionWords } from '@/core/words';
import { CliError } from '@/utils/errors';

const track = (ext: string) => ({ ext, url: `https://yt.invalid/${ext}` });

describe('YouTubeCaptions.pickTrack', () => {
  it('takes uploaded captions before speech recognition', () => {
    const info: VideoCaptionInfo = {
      language: 'id',
      subtitles: { id: [track('vtt'), track('json3')] },
      automatic_captions: { 'id-orig': [track('json3')] }
    };
    expect(YouTubeCaptions.pickTrack(info, 'id')).toEqual({
      kind: 'uploaded',
      track: 'id',
      url: 'https://yt.invalid/json3',
      ext: 'json3'
    });
  });

  it('takes YouTube recognition from the -orig track', () => {
    const info: VideoCaptionInfo = {
      automatic_captions: { 'en-orig': [track('json3')], en: [track('json3')] }
    };
    expect(YouTubeCaptions.pickTrack(info, 'en')?.track).toBe('en-orig');
  });

  it('never takes an automatic translation', () => {
    // An English talk: YouTube offers an automatic "id" track, which is a machine translation.
    const info: VideoCaptionInfo = {
      language: 'en',
      automatic_captions: { 'en-orig': [track('json3')], id: [track('json3')] }
    };
    expect(YouTubeCaptions.pickTrack(info, 'id')).toBeNull();
  });

  it('takes a bare automatic track only when the video is spoken in that language', () => {
    const info: VideoCaptionInfo = { language: 'id', automatic_captions: { id: [track('vtt')] } };
    expect(YouTubeCaptions.pickTrack(info, 'id')).toMatchObject({
      kind: 'recognized',
      track: 'id',
      ext: 'vtt'
    });
  });

  it('matches a region variant, and ignores live chat', () => {
    const info: VideoCaptionInfo = {
      subtitles: { live_chat: [track('json3')], 'en-US': [track('json3')] }
    };
    expect(YouTubeCaptions.pickTrack(info, 'en')?.track).toBe('en-US');
  });
});

describe('YouTubeCaptions.parse', () => {
  it('keeps per-word times from speech recognition', () => {
    const json3 = JSON.stringify({
      events: [
        {
          tStartMs: 14360,
          dDurationMs: 5280,
          segs: [
            { utf8: 'college' },
            { utf8: ' I', tOffsetMs: 1000 },
            { utf8: ' was', tOffsetMs: 1080 }
          ]
        },
        { tStartMs: 17029, dDurationMs: 2611, aAppend: 1, segs: [{ utf8: '\n' }] }
      ]
    });
    expect(YouTubeCaptions.parse(json3, 'json3')).toEqual({
      timing: 'word',
      words: [
        { word: 'college', start: 14.36, end: 15.36 },
        { word: 'I', start: 15.36, end: 15.44 },
        { word: 'was', start: 15.44, end: 19.64 }
      ]
    });
  });

  it('spreads an uploaded line across its duration and says it is estimated', () => {
    const json3 = JSON.stringify({
      events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'aa bb' }] }]
    });
    const { words, timing } = YouTubeCaptions.parse(json3, 'json3');
    expect(timing).toBe('estimated');
    expect(words.map((w) => w.word)).toEqual(['aa', 'bb']);
    expect(words[1].end).toBeCloseTo(3, 5);
  });

  it('reads vtt, without the repeated lines of rolling captions', () => {
    const vtt =
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello there\n\n00:00:01.000 --> 00:00:02.000\nhello there\n';
    expect(YouTubeCaptions.parse(vtt, 'vtt').words.map((w) => w.word)).toEqual(['hello', 'there']);
  });
});

describe('YouTubeCaptions.slice', () => {
  it('keeps the range and starts it at zero — the clock of a clip cut from it', () => {
    const words = [
      { word: 'a', start: 9, end: 10 },
      { word: 'b', start: 10.5, end: 11 },
      { word: 'c', start: 19.8, end: 21 },
      { word: 'd', start: 21, end: 22 }
    ];
    expect(YouTubeCaptions.slice(words, 10, 10)).toEqual([
      { word: 'b', start: 0.5, end: 1 },
      { word: 'c', start: 9.8, end: 10 }
    ]);
  });
});

describe('captionWords', () => {
  afterEach(() => {
    spyOn(YouTubeCaptions, 'fromYouTube').mockRestore();
  });

  const found = {
    kind: 'recognized' as const,
    timing: 'word' as const,
    track: 'id-orig',
    translated: false,
    name: 'Talk [abcdefghijk]',
    words: [
      { word: 'halo', start: 100, end: 100.5 },
      { word: 'semua', start: 100.5, end: 101 }
    ]
  };
  const url = 'https://youtu.be/abcdefghijk';

  it('uses the captions of a YouTube link, for the range asked', async () => {
    spyOn(YouTubeCaptions, 'fromYouTube').mockResolvedValue(found);
    const got = await captionWords(url, 'id', 'auto', {
      start: 100,
      duration: 30,
      hasSelection: true
    });
    expect(got?.via).toBe('captions');
    expect(got?.words[0]).toEqual({ word: 'halo', start: 0, end: 0.5 });
  });

  it('falls back to Whisper (null) when there are none, or when told to', async () => {
    spyOn(YouTubeCaptions, 'fromYouTube').mockResolvedValue(null);
    expect(await captionWords(url, 'id', 'auto')).toBeNull();
    expect(await captionWords(url, 'id', 'off')).toBeNull();
    expect(await captionWords('/local/video.mp4', 'id', 'auto')).toBeNull();
  });

  it('with --captions only, no captions is an error, not a transcription', async () => {
    spyOn(YouTubeCaptions, 'fromYouTube').mockResolvedValue(null);
    await expect(captionWords(url, 'id', 'only')).rejects.toBeInstanceOf(CliError);
    await expect(captionWords('/local/video.mp4', 'id', 'only')).rejects.toBeInstanceOf(CliError);
  });

  it('a caption lookup that fails does not stop the clip: Whisper is asked instead', async () => {
    spyOn(YouTubeCaptions, 'fromYouTube').mockRejectedValue(new Error('yt-dlp exited 1'));
    expect(await captionWords(url, 'id', 'auto')).toBeNull();
  });
});
