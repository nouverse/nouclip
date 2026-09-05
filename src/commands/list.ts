import { config } from '@/core/config';
import {
  ASSET_EXTENSIONS,
  type AssetKind,
  type FileItem,
  listFilesInDir,
  normalizeAssetKind
} from '@/core/workspace';
import { logger } from '@/utils/logger';

export interface ListCommandOptions {
  json?: boolean;
}

const SECTIONS: Record<AssetKind, { icon: string; label: string; dir: () => string }> = {
  downloads: { icon: '📥', label: 'Downloaded Videos', dir: () => config.downloadDir },
  transcripts: { icon: '📝', label: 'Transcripts & Subtitles', dir: () => config.transcriptDir },
  segments: { icon: '✂️', label: 'Cut & Cropped Segments', dir: () => config.segmentDir },
  output: { icon: '🎬', label: 'Rendered Output Shorts', dir: () => config.outputDir }
};

export function collectAssets(): Record<AssetKind, FileItem[]> {
  return {
    downloads: listFilesInDir(SECTIONS.downloads.dir(), ASSET_EXTENSIONS.downloads),
    transcripts: listFilesInDir(SECTIONS.transcripts.dir(), ASSET_EXTENSIONS.transcripts),
    segments: listFilesInDir(SECTIONS.segments.dir(), ASSET_EXTENSIONS.segments),
    output: listFilesInDir(SECTIONS.output.dir(), ASSET_EXTENSIONS.output)
  };
}

export async function listCommand(targetType = 'all', options: ListCommandOptions = {}) {
  config.ensureDirs();

  const kind = normalizeAssetKind(targetType);
  const assets = collectAssets();

  if (options.json) {
    console.log(JSON.stringify(kind === 'all' ? assets : assets[kind], null, 2));
    return;
  }

  logger.banner();

  const kinds: AssetKind[] = kind === 'all' ? (Object.keys(SECTIONS) as AssetKind[]) : [kind];

  for (const current of kinds) {
    const section = SECTIONS[current];
    const items = assets[current];

    console.log(`${section.icon} ${section.label} (${items.length} files in ${section.dir()}):`);
    if (items.length === 0) {
      console.log('  (none found)');
    } else {
      for (const item of items) {
        console.log(`  • ${item.name} (${item.sizeMB} MB)`);
      }
    }
    console.log('');
  }
}
