import { FRAMING_MODES, type FramingMode, isFramingMode } from '@/core/ffmpeg';
import { CliError } from '@/utils/errors';

export interface FramingOptions {
  mode?: string;
  blur?: boolean;
  center?: boolean;
}

/**
 * Resolves the framing mode from `--mode` plus the `--blur` / `--center`
 * shortcuts. Shortcuts win over `--mode` so `--mode pad --center` is explicit.
 */
export function resolveFramingMode(options: FramingOptions = {}): FramingMode {
  if (options.center) return 'center';
  if (options.blur) return 'blur';
  if (!options.mode) return 'blur';

  const mode = options.mode.trim().toLowerCase();
  if (!isFramingMode(mode)) {
    throw new CliError(
      `Unknown framing mode "${options.mode}". Expected one of: ${FRAMING_MODES.join(', ')}.`
    );
  }
  return mode;
}
