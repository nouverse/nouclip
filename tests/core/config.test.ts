import { afterEach, describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { DEFAULTS, ENV_KEYS, config } from '@/core/config';

/**
 * `config` reads `process.env` lazily inside each getter, so these tests
 * mutate the environment and restore it afterwards.
 */
const REMOVED_KEYS = [
  'NOUCLIP_OPENAI_VOICE_URL',
  'NOUCLIP_WHISPER_COMPUTE_URL',
  'NOUCLIP_VOICE_COMPUTE_URL',
  'WHISPER_COMPUTE_URL',
  'VOICE_COMPUTE_URL',
  'WHISPER_API_URL',
  'NOUCLIP_OPENAI_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'LLM_BASE_URL',
  'NOUCLIP_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'LLM_API_KEY',
  'NOUCLIP_OPENAI_MODEL',
  'OPENAI_MODEL',
  'LLM_MODEL'
];

const TOUCHED = [
  'NOUCLIP_WORKSPACE_DIR',
  'NOUCLIP_DOWNLOAD_DIR',
  'NOUCLIP_TRANSCRIPT_DIR',
  'NOUCLIP_SEGMENT_DIR',
  'NOUCLIP_OUTPUT_DIR',
  ...ENV_KEYS.audioUrl,
  ...ENV_KEYS.audioApiKey,
  ...ENV_KEYS.audioModel,
  ...ENV_KEYS.llmUrl,
  ...ENV_KEYS.llmApiKey,
  ...ENV_KEYS.llmModel,
  ...ENV_KEYS.ffmpegPath,
  ...ENV_KEYS.ffprobePath,
  ...ENV_KEYS.ytdlpPath,
  ...REMOVED_KEYS
];

const snapshot = new Map(TOUCHED.map((key) => [key, process.env[key]]));

/** Clears every key this suite manages, then applies the given overrides. */
function withEnv(overrides: Record<string, string> = {}): void {
  for (const key of TOUCHED) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('workspace directories', () => {
  it('derives every directory from the workspace root', () => {
    withEnv({ NOUCLIP_WORKSPACE_DIR: '/tmp/nouclip-cfg' });

    expect(config.workspaceDir).toBe('/tmp/nouclip-cfg');
    expect(config.downloadDir).toBe(join('/tmp/nouclip-cfg', 'downloads'));
    expect(config.transcriptDir).toBe(join('/tmp/nouclip-cfg', 'transcripts'));
    expect(config.segmentDir).toBe(join('/tmp/nouclip-cfg', 'segments'));
    expect(config.outputDir).toBe(join('/tmp/nouclip-cfg', 'output'));
  });

  it('lets each directory be pinned independently of the root', () => {
    withEnv({
      NOUCLIP_WORKSPACE_DIR: '/tmp/nouclip-cfg',
      NOUCLIP_OUTPUT_DIR: '/mnt/nas/shorts'
    });

    expect(config.outputDir).toBe('/mnt/nas/shorts');
    expect(config.segmentDir).toBe(join('/tmp/nouclip-cfg', 'segments'));
  });

  it('resolves relative directory overrides to absolute paths', () => {
    withEnv({ NOUCLIP_WORKSPACE_DIR: './my-workspace' });
    expect(config.workspaceDir).toBe(resolve('./my-workspace'));
  });

  it('exposes every managed directory for creation', () => {
    withEnv({ NOUCLIP_WORKSPACE_DIR: '/tmp/nouclip-cfg' });
    expect(config.allDirs).toHaveLength(5);
    expect(config.allDirs[0]).toBe('/tmp/nouclip-cfg');
  });
});

describe('service settings', () => {
  it('falls back to documented defaults when nothing is configured', () => {
    withEnv();

    expect(config.openAiAudioUrl).toBeUndefined();
    expect(config.openAiAudioApiKey).toBeUndefined();
    expect(config.openAiAudioModel).toBe(DEFAULTS.audioModel);
    expect(config.openAiLlmUrl).toBe(DEFAULTS.llmUrl);
    expect(config.openAiLlmApiKey).toBe('');
    expect(config.openAiLlmModel).toBe(DEFAULTS.llmModel);
    expect(config.ffmpegPath).toBeUndefined();
    expect(config.ffprobePath).toBeUndefined();
    expect(config.ytdlpPath).toBeUndefined();
  });

  it('reads the canonical NOUCLIP_ keys', () => {
    withEnv({
      NOUCLIP_OPENAI_AUDIO_URL: 'http://stt.local',
      NOUCLIP_OPENAI_AUDIO_API_KEY: 'audio-key',
      NOUCLIP_OPENAI_AUDIO_MODEL: 'large-v3-turbo',
      NOUCLIP_OPENAI_LLM_URL: 'http://llm.local/v1',
      NOUCLIP_OPENAI_LLM_API_KEY: 'llm-key',
      NOUCLIP_OPENAI_LLM_MODEL: 'llama3.2',
      NOUCLIP_FFMPEG_PATH: '/opt/ffmpeg',
      NOUCLIP_FFPROBE_PATH: '/opt/ffprobe',
      NOUCLIP_YTDLP_PATH: '/opt/yt-dlp'
    });

    expect(config.openAiAudioUrl).toBe('http://stt.local');
    expect(config.openAiAudioApiKey).toBe('audio-key');
    expect(config.openAiAudioModel).toBe('large-v3-turbo');
    expect(config.openAiLlmUrl).toBe('http://llm.local/v1');
    expect(config.openAiLlmApiKey).toBe('llm-key');
    expect(config.openAiLlmModel).toBe('llama3.2');
    expect(config.ffmpegPath).toBe('/opt/ffmpeg');
    expect(config.ffprobePath).toBe('/opt/ffprobe');
    expect(config.ytdlpPath).toBe('/opt/yt-dlp');
  });

  it('accepts the unprefixed OPENAI_ form as a secondary key', () => {
    withEnv({ OPENAI_AUDIO_URL: 'http://plain-stt.local', OPENAI_LLM_URL: 'http://plain-llm/v1' });

    expect(config.openAiAudioUrl).toBe('http://plain-stt.local');
    expect(config.openAiLlmUrl).toBe('http://plain-llm/v1');
  });

  it('prefers the NOUCLIP_ key over the unprefixed one', () => {
    withEnv({
      NOUCLIP_OPENAI_AUDIO_URL: 'http://canonical',
      OPENAI_AUDIO_URL: 'http://secondary'
    });

    expect(config.openAiAudioUrl).toBe('http://canonical');
  });

  it('skips an empty value and falls through to the next key', () => {
    withEnv({ NOUCLIP_OPENAI_AUDIO_URL: '', OPENAI_AUDIO_URL: 'http://secondary' });
    expect(config.openAiAudioUrl).toBe('http://secondary');
  });

  it('no longer reads the removed pre-rename env names', () => {
    // Deliberately dropped: these must not silently configure anything.
    withEnv({
      NOUCLIP_VOICE_COMPUTE_URL: 'http://legacy-stt',
      NOUCLIP_WHISPER_COMPUTE_URL: 'http://legacy-stt-2',
      WHISPER_API_URL: 'http://legacy-stt-3',
      NOUCLIP_OPENAI_BASE_URL: 'http://legacy-llm/v1',
      OPENAI_API_KEY: 'legacy-key',
      LLM_MODEL: 'legacy-model'
    });

    expect(config.openAiAudioUrl).toBeUndefined();
    expect(config.openAiLlmUrl).toBe(DEFAULTS.llmUrl);
    expect(config.openAiLlmApiKey).toBe('');
    expect(config.openAiLlmModel).toBe(DEFAULTS.llmModel);
  });
});

describe('deprecated aliases', () => {
  it('no longer exposes the pre-rename getters', () => {
    // Removed deliberately: use openAiAudio* / openAiLlm* instead.
    for (const removed of [
      'openAiVoiceUrl',
      'openAiVoiceApiKey',
      'openAiVoiceModel',
      'whisperComputeUrl',
      'whisperComputeApiKey',
      'voiceComputeUrl',
      'voiceComputeApiKey',
      'openAiBaseUrl',
      'openAiApiKey',
      'openAiModel'
    ]) {
      expect(config).not.toHaveProperty(removed);
    }
  });
});
