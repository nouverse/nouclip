import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;

  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();

      // Remove inline comments
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) {
        val = val.slice(0, commentIdx).trim();
      }

      // Strip quotes if present
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      if (key && !process.env[key]) {
        result[key] = val;
      }
    }
  } catch {}

  return result;
}

// 1. Load global ~/.nouclip/.env
const globalNouclipDir = join(homedir(), '.nouclip');
const globalEnvPath = join(globalNouclipDir, '.env');
const globalEnv = parseEnvFile(globalEnvPath);
for (const [k, v] of Object.entries(globalEnv)) {
  if (!process.env[k]) {
    process.env[k] = v;
  }
}

// 2. Load local ./.env if in different cwd
const localEnv = parseEnvFile(join(process.cwd(), '.env'));
for (const [k, v] of Object.entries(localEnv)) {
  if (!process.env[k]) {
    process.env[k] = v;
  }
}

export const config = {
  // Storage & Artifact Directories
  get workspaceDir(): string {
    if (process.env.NOUCLIP_WORKSPACE_DIR) {
      return resolve(process.env.NOUCLIP_WORKSPACE_DIR);
    }
    // Prefer local .nouclip if in a git/dev workspace, otherwise ~/.nouclip
    if (existsSync(join(process.cwd(), '.nouclip'))) {
      return join(process.cwd(), '.nouclip');
    }
    return globalNouclipDir;
  },

  get downloadDir(): string {
    if (process.env.NOUCLIP_DOWNLOAD_DIR) {
      return resolve(process.env.NOUCLIP_DOWNLOAD_DIR);
    }
    return join(this.workspaceDir, 'downloads');
  },

  get transcriptDir(): string {
    if (process.env.NOUCLIP_TRANSCRIPT_DIR) {
      return resolve(process.env.NOUCLIP_TRANSCRIPT_DIR);
    }
    return join(this.workspaceDir, 'transcripts');
  },

  get segmentDir(): string {
    if (process.env.NOUCLIP_SEGMENT_DIR) {
      return resolve(process.env.NOUCLIP_SEGMENT_DIR);
    }
    return join(this.workspaceDir, 'segments');
  },

  get outputDir(): string {
    if (process.env.NOUCLIP_OUTPUT_DIR) {
      return resolve(process.env.NOUCLIP_OUTPUT_DIR);
    }
    return join(this.workspaceDir, 'output');
  },

  ensureDirs(): void {
    const dirs = [
      this.workspaceDir,
      this.downloadDir,
      this.transcriptDir,
      this.segmentDir,
      this.outputDir
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch {}
      }
    }
  },

  // Audio / Speech STT Endpoint (OpenAI-compatible)
  get openAiAudioUrl(): string | undefined {
    return (
      process.env.NOUCLIP_OPENAI_AUDIO_URL ||
      process.env.NOUCLIP_OPENAI_VOICE_URL ||
      process.env.NOUCLIP_WHISPER_COMPUTE_URL ||
      process.env.NOUCLIP_VOICE_COMPUTE_URL ||
      process.env.OPENAI_AUDIO_URL ||
      process.env.OPENAI_VOICE_URL ||
      process.env.WHISPER_COMPUTE_URL ||
      process.env.VOICE_COMPUTE_URL ||
      process.env.WHISPER_API_URL
    );
  },

  get openAiAudioApiKey(): string | undefined {
    return (
      process.env.NOUCLIP_OPENAI_AUDIO_API_KEY ||
      process.env.NOUCLIP_OPENAI_VOICE_API_KEY ||
      process.env.NOUCLIP_WHISPER_COMPUTE_API_KEY ||
      process.env.NOUCLIP_VOICE_COMPUTE_API_KEY ||
      process.env.OPENAI_AUDIO_API_KEY ||
      process.env.OPENAI_VOICE_API_KEY ||
      process.env.WHISPER_COMPUTE_API_KEY ||
      process.env.VOICE_COMPUTE_API_KEY ||
      process.env.WHISPER_API_KEY
    );
  },

  get openAiAudioModel(): string {
    return (
      process.env.NOUCLIP_OPENAI_AUDIO_MODEL ||
      process.env.NOUCLIP_OPENAI_VOICE_MODEL ||
      process.env.OPENAI_AUDIO_MODEL ||
      process.env.OPENAI_VOICE_MODEL ||
      'large-v3'
    );
  },

  // LLM OpenAI-Compatible Endpoint (Optional)
  get openAiLlmUrl(): string {
    return (
      process.env.NOUCLIP_OPENAI_LLM_URL ||
      process.env.NOUCLIP_OPENAI_BASE_URL ||
      process.env.OPENAI_LLM_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.LLM_BASE_URL ||
      process.env.OPENAI_API_BASE ||
      'https://api.openai.com/v1'
    );
  },

  get openAiLlmApiKey(): string {
    return (
      process.env.NOUCLIP_OPENAI_LLM_API_KEY ||
      process.env.NOUCLIP_OPENAI_API_KEY ||
      process.env.OPENAI_LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LLM_API_KEY ||
      ''
    );
  },

  get openAiLlmModel(): string {
    return (
      process.env.NOUCLIP_OPENAI_LLM_MODEL ||
      process.env.NOUCLIP_OPENAI_MODEL ||
      process.env.OPENAI_LLM_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.LLM_MODEL ||
      'gpt-4o-mini'
    );
  },

  // Aliases for backward compatibility
  get openAiVoiceUrl(): string | undefined {
    return this.openAiAudioUrl;
  },
  get openAiVoiceApiKey(): string | undefined {
    return this.openAiAudioApiKey;
  },
  get openAiVoiceModel(): string {
    return this.openAiAudioModel;
  },
  get whisperComputeUrl(): string | undefined {
    return this.openAiAudioUrl;
  },
  get whisperComputeApiKey(): string | undefined {
    return this.openAiAudioApiKey;
  },
  get voiceComputeUrl(): string | undefined {
    return this.openAiAudioUrl;
  },
  get voiceComputeApiKey(): string | undefined {
    return this.openAiAudioApiKey;
  },
  get openAiBaseUrl(): string {
    return this.openAiLlmUrl;
  },
  get openAiApiKey(): string {
    return this.openAiLlmApiKey;
  },
  get openAiModel(): string {
    return this.openAiLlmModel;
  },

  // Binary Tools
  get ffmpegPath(): string | undefined {
    return process.env.NOUCLIP_FFMPEG_PATH || process.env.FFMPEG_PATH;
  },

  get ffprobePath(): string | undefined {
    return process.env.NOUCLIP_FFPROBE_PATH || process.env.FFPROBE_PATH;
  },

  get ytdlpPath(): string | undefined {
    return process.env.NOUCLIP_YTDLP_PATH || process.env.YTDLP_PATH;
  }
};
