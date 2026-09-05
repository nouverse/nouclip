#!/usr/bin/env node
import { autoCommand } from '@/commands/auto';
import { cropCommand } from '@/commands/crop';
import { cutCommand } from '@/commands/cut';
import { downloadCommand } from '@/commands/download';
import { extractCommand } from '@/commands/extract';
import { highlightCommand } from '@/commands/highlight';
import { infoCommand } from '@/commands/info';
import { listCommand } from '@/commands/list';
import { subtitleCommand } from '@/commands/subtitle';
import { transcriptCommand } from '@/commands/transcript';
import { getErrorMessage, getExitCode } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { VERSION } from '@/version';
import { Command } from 'commander';

/**
 * Wraps a command handler so every failure is reported and exits consistently.
 * Commands themselves throw (usually `CliError`) instead of calling process.exit.
 */
function action<A extends unknown[]>(handler: (...args: A) => unknown | Promise<unknown>) {
  return async (...args: A): Promise<void> => {
    try {
      await handler(...args);
    } catch (err) {
      logger.error(getErrorMessage(err));
      process.exitCode = getExitCode(err);
    }
  };
}

const program = new Command();

program
  .name('nouclip')
  .description('Agentic video clipper, aspect ratio reframer & kinetic subtitle engine')
  .version(VERSION)
  .showHelpAfterError();

// 1. Storage & Context Introspection Commands
program
  .command('info')
  .alias('paths')
  .description('Display workspace paths, stored asset counts, storage size, and service config')
  .option('--json', 'Output results as JSON payload')
  .action(action(infoCommand));

program
  .command('list [type]')
  .alias('ls')
  .description(
    'List stored assets (types: "downloads", "transcripts", "segments", "output", "all")'
  )
  .option('--json', 'Output list as JSON payload')
  .action(action(listCommand));

// 2. End-to-End Pipeline
program
  .command('auto <videoOrUrl>')
  .description(
    'End-to-end automated clipping: download -> cut range -> aspect reframing -> Whisper -> kinetic subtitles'
  )
  .option('-r, --range <range>', 'Time range e.g. "13:25-14:50", "01:20..02:15", "45-75"')
  .option('-s, --start <time>', 'Start timestamp e.g. "13:25", "01:13:25", "85s"')
  .option('--from <time>', 'Alias for --start')
  .option('-e, --end <time>', 'End timestamp e.g. "14:50", "01:15:00"')
  .option('--to <time>', 'Alias for --end')
  .option('-d, --duration <time>', 'Duration e.g. "30s", "1m", "45"')
  .option(
    '-a, --aspect <ratio>',
    'Aspect ratio e.g. "9:16", "1:1", "4:5", "16:9" (default: "9:16")',
    '9:16'
  )
  .option(
    '-m, --mode <mode>',
    'Framing style: "blur" (blurred background), "center" (crop fill), "pad" (letterbox), "stretch" (default: "blur")',
    'blur'
  )
  .option('--blur', 'Shortcut for --mode blur (blurred background letterbox)')
  .option('--center', 'Shortcut for --mode center (crop fill)')
  .option('--no-subtitles', 'Do not generate or burn subtitles (clean reframed video only)')
  .option('--no-subs', 'Alias for --no-subtitles')
  .option('--no-subtitle', 'Alias for --no-subtitles')
  .option('-l, --lang <lang>', "Language for Whisper transcription (default: 'id')", 'id')
  .option(
    '--style <preset>',
    'Subtitle typography style preset: "default", "hormozi", "storyteller", "cinematic" (default: "default")',
    'default'
  )
  .option('--font-size <size>', 'Subtitle font size (overrides the --style preset size)')
  .option('--primary-color <hex>', 'Inactive text color e.g. "&H00FFFFFF&" (overrides the preset)')
  .option(
    '--highlight-color <hex>',
    'Active animated word color e.g. "&H0000FFFF&" (overrides the preset)'
  )
  .option('--silence-trim', 'Auto-trim silent pauses (>0.6s) between words for faster pacing')
  .option(
    '--silence-gap <seconds>',
    'Silence threshold in seconds before trimming (default: 0.6)',
    '0.6'
  )
  .option('--bgm <path>', 'Background music track to mix with sidechain ducking')
  .option('--bgm-volume <volume>', 'BGM audio volume factor (default: 0.10)', '0.10')
  .option('--no-ducking', 'Disable sidechain audio ducking (constant volume BGM mix)')
  .option(
    '--draft',
    'Generate segment, audio, and subtitle files but pause before burning for review'
  )
  .option('--no-burn', 'Alias for --draft')
  .option('-o, --output <path>', 'Output video path')
  .option('--download-dir <dir>', 'Custom directory to store downloaded videos')
  .option('--output-dir <dir>', 'Custom directory to store final videos')
  .option('--keep-temp', 'Keep intermediate wav/temp files')
  .action(action(autoCommand));

// 3. Modular Operations
program
  .command('download <url>')
  .description('Download video or section from YouTube via yt-dlp with caching support')
  .option('-s, --start <time>', 'Start timestamp e.g. "13:25", "85s"')
  .option('-e, --end <time>', 'End timestamp e.g. "14:50"')
  .option('-o, --output <filename>', 'Output filename template')
  .option('--dir <directory>', 'Output download directory')
  .option('--force', 'Force re-download even if already cached')
  .action(action(downloadCommand));

program
  .command('cut <video>')
  .description('Cut video segment by timestamp range without re-encoding (or with re-encode)')
  .option('-r, --range <range>', 'Time range e.g. "13:25-14:50", "80-110"')
  .option('-s, --start <time>', 'Start time e.g. "13:25", "85s"')
  .option('--from <time>', 'Alias for --start')
  .option('-e, --end <time>', 'End time e.g. "14:50"')
  .option('--to <time>', 'Alias for --end')
  .option('-d, --duration <time>', 'Duration e.g. "30s", "45"')
  .option('-o, --output <path>', 'Output MP4 path')
  .option('--reencode', 'Re-encode video with libx264 (default: false fast copy)')
  .action(action(cutCommand));

program
  .command('crop <video>')
  .alias('reframe')
  .description('Reframe video aspect ratio (9:16, 1:1, 4:5, 16:9) with blur, center, or pad modes')
  .option(
    '-a, --aspect <ratio>',
    'Target aspect ratio e.g. "9:16", "1:1", "4:5", "16:9" (default: "9:16")',
    '9:16'
  )
  .option(
    '-m, --mode <mode>',
    'Framing style: "blur" (blurred background), "center" (crop), "pad" (letterbox), "stretch" (default: "blur")',
    'blur'
  )
  .option('--blur', 'Shortcut for --mode blur')
  .option('--center', 'Shortcut for --mode center (crop fill)')
  .option('-o, --output <path>', 'Output MP4 path')
  .action(action(cropCommand));

program
  .command('extract <video>')
  .description('Extract audio from video and run Whisper to generate word timestamps JSON')
  .option('-r, --range <range>', 'Limit extraction to a range e.g. "13:25-14:50"')
  .option('-s, --start <time>', 'Start time e.g. "13:25", "85s"')
  .option('--from <time>', 'Alias for --start')
  .option('-e, --end <time>', 'End time e.g. "14:50"')
  .option('--to <time>', 'Alias for --end')
  .option('-d, --duration <time>', 'Duration e.g. "30s", "45"')
  .option('-l, --lang <lang>', "Transcription language (default: 'id')", 'id')
  .option('-m, --model <model>', "Whisper model name (default: 'large-v3')", 'large-v3')
  .option('--keep-wav', 'Keep the intermediate WAV file')
  .option('-o, --output <path>', 'Output JSON path')
  .action(action(extractCommand));

program
  .command('transcript <videoOrJson>')
  .description('Export clean formatted transcript to TXT, SRT, VTT, or JSON')
  .option(
    '-f, --format <format>',
    "Export format: 'txt', 'srt', 'vtt', 'json' (default: 'txt')",
    'txt'
  )
  .option('-l, --lang <lang>', "Transcription language (default: 'id')", 'id')
  .option('-o, --output <path>', 'Output file path')
  .action(action(transcriptCommand));

program
  .command('subtitle <video>')
  .description('Burn animated kinetic subtitles into video from .ass file or .json word timestamps')
  .option('-s, --sub <path>', 'Path to .ass subtitle file or .json word timestamps')
  .option('-t, --timestamps <json>', 'Path to Whisper word timestamps JSON (alias for --sub)')
  .option(
    '--style <preset>',
    'Subtitle typography style preset: "default", "hormozi", "storyteller", "cinematic" (default: "default")',
    'default'
  )
  .option('--font-size <size>', 'Font size (overrides the --style preset size)')
  .option('--primary-color <hex>', 'Inactive text color (overrides the preset)')
  .option('--highlight-color <hex>', 'Active animated word color (overrides the preset)')
  .option('--bgm <path>', 'Background music track to mix with sidechain ducking')
  .option('--bgm-volume <volume>', 'BGM audio volume factor (default: 0.10)', '0.10')
  .option('--no-ducking', 'Disable sidechain audio ducking (constant volume BGM mix)')
  .option('-o, --output <path>', 'Output MP4 path')
  .action(action(subtitleCommand));

program
  .command('highlight <videoOrJson>')
  .description(
    'Optional: Analyze transcript to suggest clip timestamps using any OpenAI-compatible LLM'
  )
  .option('-k, --keyword <keyword>', 'Focus highlight search on specific keyword / topic')
  .option(
    '-m, --max-clips <count>',
    'Maximum number of highlight clips to generate (default: 5)',
    '5'
  )
  .option('--min-duration <seconds>', 'Minimum clip duration in seconds (default: 25)', '25')
  .option('--max-duration <seconds>', 'Maximum clip duration in seconds (default: 60)', '60')
  .option(
    '--budget <seconds>',
    'Total duration target across all suggested clips (default: 180)',
    '180'
  )
  .option('-o, --output <path>', 'Output JSON file to save suggested highlight clips')
  .action(action(highlightCommand));

program.parse(process.argv);
