import { DEFAULTS, config } from '@/core/config';
import { getDirStats } from '@/core/workspace';
import { logger } from '@/utils/logger';

export interface InfoCommandOptions {
  json?: boolean;
}

export function buildInfoPayload() {
  const downloads = getDirStats(config.downloadDir);
  const transcripts = getDirStats(config.transcriptDir);
  const segments = getDirStats(config.segmentDir);
  const output = getDirStats(config.outputDir);

  return {
    workspace: {
      root: config.workspaceDir,
      downloads: {
        path: config.downloadDir,
        files: downloads.count,
        sizeMB: downloads.totalSizeMB
      },
      transcripts: {
        path: config.transcriptDir,
        files: transcripts.count,
        sizeMB: transcripts.totalSizeMB
      },
      segments: { path: config.segmentDir, files: segments.count, sizeMB: segments.totalSizeMB },
      output: { path: config.outputDir, files: output.count, sizeMB: output.totalSizeMB }
    },
    services: {
      openAiAudioUrl: config.openAiAudioUrl ?? `${DEFAULTS.audioUrl} (default)`,
      openAiAudioModel: config.openAiAudioModel,
      openAiLlmUrl: config.openAiLlmUrl,
      openAiLlmModel: config.openAiLlmModel,
      ffmpegPath: config.ffmpegPath ?? 'system PATH',
      ffprobePath: config.ffprobePath ?? 'system PATH',
      ytdlpPath: config.ytdlpPath ?? 'system PATH'
    }
  };
}

export async function infoCommand(options: InfoCommandOptions = {}) {
  config.ensureDirs();
  const payload = buildInfoPayload();

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const { workspace, services } = payload;

  logger.banner();
  console.log('📂 Storage & Workspace Paths:');
  console.log(`  • Workspace Root : ${workspace.root}`);
  for (const [label, key] of [
    ['Downloads Dir  ', 'downloads'],
    ['Transcripts Dir', 'transcripts'],
    ['Segments Dir   ', 'segments'],
    ['Output Dir     ', 'output']
  ] as const) {
    const entry = workspace[key];
    console.log(`  • ${label}: ${entry.path} (${entry.files} files, ${entry.sizeMB} MB)`);
  }
  console.log('');

  console.log('🔌 Connected Services:');
  console.log(
    `  • Audio STT / Whisper Endpoint: ${services.openAiAudioUrl} (Model: ${services.openAiAudioModel})`
  );
  console.log(
    `  • Optional LLM Endpoint       : ${services.openAiLlmUrl} (Model: ${services.openAiLlmModel})`
  );
  console.log('');

  console.log('💡 How to customize storage paths:');
  console.log('  1. In ~/.nouclip/.env or ./.env:');
  console.log('     NOUCLIP_DOWNLOAD_DIR=/path/to/downloads');
  console.log('     NOUCLIP_OUTPUT_DIR=/path/to/output');
  console.log('     NOUCLIP_TRANSCRIPT_DIR=/path/to/transcripts');
  console.log('  2. Or pass flags per command:');
  console.log(
    '     nouclip auto <url> --download-dir /path/to/downloads --output-dir /path/to/out'
  );
}
