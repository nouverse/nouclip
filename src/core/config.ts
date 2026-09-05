import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyEnv, firstEnv, parseEnvFile } from '@/core/env';

const globalNouclipDir = join(homedir(), '.nouclip');

/**
 * Loads `~/.nouclip/.env` then `./.env`. Existing process env always wins,
 * and the global file is read first so a project-local file can't silently
 * shadow an explicit shell variable.
 */
export function loadEnvFiles(): void {
  applyEnv(parseEnvFile(join(globalNouclipDir, '.env')));
  applyEnv(parseEnvFile(join(process.cwd(), '.env')));
}

loadEnvFiles();

/** Env keys accepted for each setting, in precedence order. */
export const ENV_KEYS = {
  audioUrl: ['NOUCLIP_OPENAI_AUDIO_URL', 'OPENAI_AUDIO_URL'],
  audioApiKey: ['NOUCLIP_OPENAI_AUDIO_API_KEY', 'OPENAI_AUDIO_API_KEY'],
  audioModel: ['NOUCLIP_OPENAI_AUDIO_MODEL', 'OPENAI_AUDIO_MODEL'],
  llmUrl: ['NOUCLIP_OPENAI_LLM_URL', 'OPENAI_LLM_URL'],
  llmApiKey: ['NOUCLIP_OPENAI_LLM_API_KEY', 'OPENAI_LLM_API_KEY'],
  llmModel: ['NOUCLIP_OPENAI_LLM_MODEL', 'OPENAI_LLM_MODEL'],
  ffmpegPath: ['NOUCLIP_FFMPEG_PATH', 'FFMPEG_PATH'],
  ffprobePath: ['NOUCLIP_FFPROBE_PATH', 'FFPROBE_PATH'],
  ytdlpPath: ['NOUCLIP_YTDLP_PATH', 'YTDLP_PATH']
} as const;

export const DEFAULTS = {
  audioUrl: 'http://localhost:8880',
  audioModel: 'large-v3',
  llmUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini'
} as const;

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

  /** All managed directories, in creation order. */
  get allDirs(): string[] {
    return [
      this.workspaceDir,
      this.downloadDir,
      this.transcriptDir,
      this.segmentDir,
      this.outputDir
    ];
  },

  ensureDirs(): void {
    for (const dir of this.allDirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  },

  // Audio / Speech STT Endpoint (OpenAI-compatible)
  get openAiAudioUrl(): string | undefined {
    return firstEnv([...ENV_KEYS.audioUrl]);
  },

  get openAiAudioApiKey(): string | undefined {
    return firstEnv([...ENV_KEYS.audioApiKey]);
  },

  get openAiAudioModel(): string {
    return firstEnv([...ENV_KEYS.audioModel]) ?? DEFAULTS.audioModel;
  },

  // LLM OpenAI-Compatible Endpoint (Optional)
  get openAiLlmUrl(): string {
    return firstEnv([...ENV_KEYS.llmUrl]) ?? DEFAULTS.llmUrl;
  },

  get openAiLlmApiKey(): string {
    return firstEnv([...ENV_KEYS.llmApiKey]) ?? '';
  },

  get openAiLlmModel(): string {
    return firstEnv([...ENV_KEYS.llmModel]) ?? DEFAULTS.llmModel;
  },

  // Binary Tools
  get ffmpegPath(): string | undefined {
    return firstEnv([...ENV_KEYS.ffmpegPath]);
  },

  get ffprobePath(): string | undefined {
    return firstEnv([...ENV_KEYS.ffprobePath]);
  },

  get ytdlpPath(): string | undefined {
    return firstEnv([...ENV_KEYS.ytdlpPath]);
  }
};
