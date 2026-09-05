import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/core/config';
import { logger } from '@/utils/logger';

interface FileItem {
  name: string;
  path: string;
  sizeMB: number;
  modified: string;
  mtimeMs: number;
}

function listFilesInDir(dirPath: string, filterExt?: string[]): FileItem[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath)
      .filter((f) => {
        if (!filterExt) return true;
        return filterExt.some((ext) => f.endsWith(ext));
      })
      .map((f) => {
        const full = join(dirPath, f);
        const s = statSync(full);
        return {
          name: f,
          path: full,
          sizeMB: Math.round((s.size / (1024 * 1024)) * 100) / 100,
          modified: new Date(s.mtimeMs).toISOString(),
          mtimeMs: s.mtimeMs
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

export async function listCommand(targetType = 'all', options: { json?: boolean } = {}) {
  config.ensureDirs();

  const type = targetType.toLowerCase();

  const downloads = listFilesInDir(config.downloadDir, ['.mp4', '.mkv', '.webm']);
  const transcripts = listFilesInDir(config.transcriptDir, ['.json', '.ass', '.srt', '.txt']);
  const segments = listFilesInDir(config.segmentDir, ['.mp4']);
  const output = listFilesInDir(config.outputDir, ['.mp4']);

  if (options.json) {
    let result: any = {};
    if (type === 'downloads' || type === 'download') result = downloads;
    else if (type === 'transcripts' || type === 'transcript') result = transcripts;
    else if (type === 'segments' || type === 'segment') result = segments;
    else if (type === 'output' || type === 'outputs') result = output;
    else {
      result = { downloads, transcripts, segments, output };
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  logger.banner();

  if (type === 'downloads' || type === 'download' || type === 'all') {
    console.log(`📥 Downloaded Videos (${downloads.length} files in ${config.downloadDir}):`);
    if (downloads.length === 0) {
      console.log('  (no downloads found)');
    } else {
      for (const item of downloads) {
        console.log(`  • ${item.name} (${item.sizeMB} MB)`);
      }
    }
    console.log('');
  }

  if (type === 'transcripts' || type === 'transcript' || type === 'all') {
    console.log(
      `📝 Transcripts & Subtitles (${transcripts.length} files in ${config.transcriptDir}):`
    );
    if (transcripts.length === 0) {
      console.log('  (no transcripts found)');
    } else {
      for (const item of transcripts) {
        console.log(`  • ${item.name} (${item.sizeMB} MB)`);
      }
    }
    console.log('');
  }

  if (type === 'segments' || type === 'segment' || type === 'all') {
    console.log(`✂️ Cut & Cropped Segments (${segments.length} files in ${config.segmentDir}):`);
    if (segments.length === 0) {
      console.log('  (no segments found)');
    } else {
      for (const item of segments) {
        console.log(`  • ${item.name} (${item.sizeMB} MB)`);
      }
    }
    console.log('');
  }

  if (type === 'output' || type === 'outputs' || type === 'all') {
    console.log(`🎬 Rendered Output Shorts (${output.length} files in ${config.outputDir}):`);
    if (output.length === 0) {
      console.log('  (no output videos found)');
    } else {
      for (const item of output) {
        console.log(`  • ${item.name} (${item.sizeMB} MB)`);
      }
    }
    console.log('');
  }
}
