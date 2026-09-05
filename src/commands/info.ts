import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/core/config';
import { logger } from '@/utils/logger';

function getDirStats(dirPath: string): { count: number; totalSizeMB: number } {
  if (!existsSync(dirPath)) return { count: 0, totalSizeMB: 0 };
  try {
    const files = readdirSync(dirPath);
    let totalBytes = 0;
    let fileCount = 0;

    for (const f of files) {
      const full = join(dirPath, f);
      try {
        const s = statSync(full);
        if (s.isFile()) {
          totalBytes += s.size;
          fileCount++;
        }
      } catch {}
    }
    return { count: fileCount, totalSizeMB: Math.round((totalBytes / (1024 * 1024)) * 10) / 10 };
  } catch {
    return { count: 0, totalSizeMB: 0 };
  }
}

export async function infoCommand(options: { json?: boolean }) {
  config.ensureDirs();

  const downloadStats = getDirStats(config.downloadDir);
  const transcriptStats = getDirStats(config.transcriptDir);
  const segmentStats = getDirStats(config.segmentDir);
  const outputStats = getDirStats(config.outputDir);

  const payload = {
    workspace: {
      root: config.workspaceDir,
      downloads: {
        path: config.downloadDir,
        files: downloadStats.count,
        sizeMB: downloadStats.totalSizeMB
      },
      transcripts: {
        path: config.transcriptDir,
        files: transcriptStats.count,
        sizeMB: transcriptStats.totalSizeMB
      },
      segments: {
        path: config.segmentDir,
        files: segmentStats.count,
        sizeMB: segmentStats.totalSizeMB
      },
      output: {
        path: config.outputDir,
        files: outputStats.count,
        sizeMB: outputStats.totalSizeMB
      }
    },
    services: {
      openAiAudioUrl: config.openAiAudioUrl || 'http://localhost:8880 (default)',
      openAiLlmUrl: config.openAiLlmUrl,
      openAiLlmModel: config.openAiLlmModel,
      ffmpegPath: config.ffmpegPath || 'system PATH',
      ytdlpPath: config.ytdlpPath || 'system PATH'
    }
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  logger.banner();
  console.log('📂 Storage & Workspace Paths:');
  console.log(`  • Workspace Root : ${config.workspaceDir}`);
  console.log(
    `  • Downloads Dir  : ${config.downloadDir} (${downloadStats.count} files, ${downloadStats.totalSizeMB} MB)`
  );
  console.log(
    `  • Transcripts Dir: ${config.transcriptDir} (${transcriptStats.count} files, ${transcriptStats.totalSizeMB} MB)`
  );
  console.log(
    `  • Segments Dir   : ${config.segmentDir} (${segmentStats.count} files, ${segmentStats.totalSizeMB} MB)`
  );
  console.log(
    `  • Output Dir     : ${config.outputDir} (${outputStats.count} files, ${outputStats.totalSizeMB} MB)`
  );
  console.log('');

  console.log('🔌 Connected Services:');
  console.log(
    `  • Audio STT / Whisper Endpoint: ${config.openAiAudioUrl || 'http://localhost:8880 (default)'} (Model: ${config.openAiAudioModel})`
  );
  console.log(
    `  • Optional LLM Endpoint       : ${config.openAiLlmUrl} (Model: ${config.openAiLlmModel})`
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
