# RFC: Section-Aware YouTube Download & Coordinate Synchronization in NouClip Auto Pipeline

- **Author:** Nero (@nero-ai) & Gading Nasution (@gadingnst)
- **Status:** Proposed / Draft
- **Date:** 2026-10-01
- **Target Release:** NouClip v1.1.0 / v1.0.3
- **Target Modules:** `src/commands/auto.ts`, `src/core/youtube.ts`, `src/core/selection.ts`, `src/core/words.ts`

---

## 1. Problem Statement & Motivation

### 1.1 The Full-Download Overhead in Short-Form Clipping
`nouclip auto` is NouClip's end-to-end automated command designed to transform long-form media into short vertical clips (TikTok, YouTube Shorts, Instagram Reels) through an integrated pipeline:
`Download -> Cut -> Reframe (9:16) -> Transcribe/Caption -> Burn Kinetic Typography`.

However, when passed a remote YouTube URL with timestamp constraints (e.g. `--start 78:35 --end 80:11` or `--range 13:25-14:50`), the current pipeline executes an unconstrained download of the **entire source video**:
```bash
nouclip auto "https://youtube.com/live/G8WCNGqPERE" --start 78:35 --end 80:11
```

#### Real-World Operational Impact:
1. **Massive Bandwidth & Time Inefficiency:** In a typical podcast or livestream (e.g. 1h 24m / 5,033s), the full video stream in 1080p is ~730 MB to 1.8 GB. Downloading the entire asset just to extract a 95-second clip (~11 MB) introduces a 10x–20x download latency penalty. On cellular WAN connections (e.g. Netgear Nighthawk M1 cellular homelab uplink), downloading 730 MB takes 3–5 minutes instead of 10–15 seconds.
2. **Excessive Disk & I/O Waste:** Homelab or edge compute hosts must write hundreds of megabytes of temporary video data to disk, only to discard 98% of it after the local `ffmpeg` cut step.
3. **Inconsistent CLI Capabilities:** The modular subcommand `nouclip download <url> -s <ts> -e <ts>` **already supports** section-specific downloading via `yt-dlp --download-sections`. However, this capability is bypassed in the flagship `nouclip auto` command.

---

## 2. Root Cause Analysis in Current Architecture

### 2.1 Execution Order Inversion in `src/commands/auto.ts`
In `src/commands/auto.ts`, source media resolution happens before the time selection options are resolved:

```typescript
// Current implementation in src/commands/auto.ts:
export async function autoCommand(videoOrUrl: string, options: AutoCommandOptions = {}) {
  config.ensureDirs();
  logger.banner();

  // Step 1: Downloads FULL video from YouTube!
  const input = await resolveSource(videoOrUrl, options);
  const baseName = basename(input, extname(input));

  // Step 2: Selection options are only evaluated AFTER the full download completes!
  const selection = resolveTimeSelection(options);
  ...
}

async function resolveSource(videoOrUrl: string, options: AutoCommandOptions): Promise<string> {
  if (YouTubeDownloader.isYouTubeUrl(videoOrUrl)) {
    logger.info(`Detected YouTube URL: ${videoOrUrl}`);
    // No section parameter is passed to YouTubeDownloader.download()
    return YouTubeDownloader.download(videoOrUrl, {
      outputDir: options.downloadDir ? resolve(options.downloadDir) : config.downloadDir
    });
  }
  ...
}
```

### 2.2 Coordinate Incompatibility Between Downloaded Sections & Local Cuts
Simply passing `selection` to `YouTubeDownloader.download()` inside `resolveSource()` would cause a secondary failure downstream:

When `yt-dlp` downloads a segment using `--download-sections "*start-end"`:
- The resulting `.mp4` file is **already trimmed**. Its presentation timestamp (PTS) and duration start at `0.0s`, spanning only `duration` seconds.
- In step 2 of `autoCommand`, the code unconditionally attempts to cut the segment again:
  ```typescript
  if (selection.hasSelection) {
    const { start, duration } = selection;
    ...
    // BUG: If input is already cut, seeking to `start` (e.g. 4715s) in a 95s file will FAIL!
    await FFmpegRunner.cutVideo(input, cutOut, start, duration, true);
  }
  ```
- If `input` is already trimmed, seeking to `start` (e.g. `4715.8s`) inside a 95-second video results in an empty cut or FFmpeg error.

### 2.3 Transcript & Caption Timestamp Alignment
In `src/core/words.ts`, caption parsing already handles selection slicing:
```typescript
const words = range
  ? YouTubeCaptions.slice(caption.words, range.start, range.duration)
  : caption.words;
```
`YouTubeCaptions.slice` normalizes the word timestamps to `0.0`-indexed coordinates relative to `range.start`. Similarly, Whisper transcription on an audio segment extracted from an already-trimmed video produces `0.0`-indexed timestamps.

Therefore, the only missing architectural link is coordinating the download step with the cutting step.

---

## 3. Proposed Design & Specification

### 3.1 Pre-Resolution of Time Selection
Evaluate `selection = resolveTimeSelection(options)` before initiating any network download.

### 3.2 Section-Aware Remote Ingestion
In `resolveSource()`, if `videoOrUrl` is a YouTube URL and `selection.hasSelection` is true:
1. Pass `section: { start: selection.start, end: selection.start + selection.duration }` to `YouTubeDownloader.download()`.
2. Add `--force-keyframes-at-cuts` to `yt-dlp` arguments to ensure sample-accurate cut boundaries.
3. Mark the resolved source as `preClipped: true`.

### 3.3 Dynamic Cut Skip
In `autoCommand()`:
- If the source was already downloaded as a section (`preClipped === true`):
  - Skip the `FFmpegRunner.cutVideo()` step entirely.
  - Set `workingVideo = input`.
- If the source is a local video file or a full download:
  - Retain `FFmpegRunner.cutVideo()` as before.

### 3.4 Deterministic Cache Naming for Downloaded Sections
Currently, `YouTubeDownloader.findExistingDownload()` only matches `[<videoId>].mp4`.
For section downloads, cache hits should recognize the range:
- Format: `%(title).60s [%(id)s]_${start}s-${end}s.%(ext)s`
- If a section matching `[<id>]_${start}s-${end}s.mp4` exists in `downloadDir` and is non-empty, reuse it directly without contacting YouTube.

---

## 4. Proposed Code Changes

### 4.1 Changes to `src/core/youtube.ts`

```typescript
export interface DownloadSection {
  start: number;
  end: number;
}

export interface DownloadOptions {
  outputDir?: string;
  outputFileName?: string;
  force?: boolean;
  section?: DownloadSection;
}

export class YouTubeDownloader {
  ...
  static buildDownloadArgs(
    url: string,
    options: { outTemplate: string; ffmpegDir?: string; section?: DownloadSection }
  ): string[] {
    const args = [
      url,
      '-f',
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format',
      'mp4'
    ];

    if (options.ffmpegDir) {
      args.push('--ffmpeg-location', options.ffmpegDir);
    }

    args.push('-o', options.outTemplate, '--no-playlist', '--print', 'after_move:filepath');

    if (options.section) {
      args.push('--download-sections', `*${options.section.start}-${options.section.end}`);
      // Ensure precise frame boundary cutting
      args.push('--force-keyframes-at-cuts');
    }

    return args;
  }
}
```

### 4.2 Changes to `src/commands/auto.ts`

```typescript
interface ResolvedMedia {
  path: string;
  isPreClipped: boolean;
}

export async function autoCommand(videoOrUrl: string, options: AutoCommandOptions = {}) {
  config.ensureDirs();
  logger.banner();

  // 1. Resolve selection FIRST
  const selection = resolveTimeSelection(options);
  const skipSubtitles = shouldSkipSubtitles(options);

  // 2. Resolve source with section awareness
  const resolved = await resolveSource(videoOrUrl, options, selection);
  const input = resolved.path;
  const baseName = basename(input, extname(input));

  const totalSteps =
    (selection.hasSelection && !resolved.isPreClipped ? 1 : 0) +
    (skipSubtitles ? 1 : 3) +
    (options.bgm ? 1 : 0);
  let currentStep = 1;

  // 3. Cut segment ONLY if not already pre-clipped by section download
  let workingVideo = input;
  if (selection.hasSelection && !resolved.isPreClipped) {
    const { start, duration } = selection;
    logger.step(
      currentStep++,
      totalSteps,
      `Cutting segment: ${formatSecondsToTimestamp(start)} -> ${formatSecondsToTimestamp(start + duration)} (${Math.round(duration)}s)...`
    );
    const cutOut = join(config.segmentDir, `${baseName}_cut${selectionSuffix(selection)}.mp4`);
    await FFmpegRunner.cutVideo(input, cutOut, start, duration, true);
    workingVideo = cutOut;
    logger.success(`Clipped to: ${cutOut}`);
  }

  // 4. Reframe directly
  ...
}

async function resolveSource(
  videoOrUrl: string,
  options: AutoCommandOptions,
  selection: TimeSelection
): Promise<ResolvedMedia> {
  if (YouTubeDownloader.isYouTubeUrl(videoOrUrl)) {
    logger.info(`Detected YouTube URL: ${videoOrUrl}`);
    const outDir = options.downloadDir ? resolve(options.downloadDir) : config.downloadDir;

    if (selection.hasSelection) {
      const start = selection.start;
      const end = selection.start + selection.duration;
      logger.info(`Downloading section only: ${formatSecondsToTimestamp(start)} -> ${formatSecondsToTimestamp(end)}...`);
      
      const downloadedPath = await YouTubeDownloader.download(videoOrUrl, {
        outputDir: outDir,
        section: { start, end }
      });
      return { path: downloadedPath, isPreClipped: true };
    }

    const downloadedPath = await YouTubeDownloader.download(videoOrUrl, { outputDir: outDir });
    return { path: downloadedPath, isPreClipped: false };
  }

  const input = resolveMediaInput(videoOrUrl);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${videoOrUrl} (Checked: ${input})`);
  }
  return { path: input, isPreClipped: false };
}
```

---

## 5. Benefits & Benchmarks

| Metric | Current Behavior (Full DL) | Proposed Behavior (Section DL) | Improvement |
|---|---|---|---|
| **Network Payload (84 min video)** | ~732 MB | ~11 MB | **~98.5% reduction** |
| **Download Time (15 Mbps WAN)** | ~6.5 minutes | ~8 – 12 seconds | **~30x faster** |
| **Disk Write Cycle** | 732 MB + 11 MB cut | 11 MB direct | **Zero intermediate full-file write** |
| **FFmpeg Cut Step** | Required (re-encode / copy) | Skipped (pre-clipped at download) | **Saves 5 – 10s CPU time** |

---

## 6. Edge Cases & Considerations

1. **YouTube Live / Active Streams:**
   Livestreams that are currently live cannot use arbitrary range section downloading until VOD processing completes. `yt-dlp` returns a clear error in this state, which NouClip should catch and report gracefully.
2. **Missing Keyframe Snapping:**
   Using `--force-keyframes-at-cuts` guarantees that `yt-dlp`'s invocation of FFmpeg recodes the keyframes at the exact split point, preventing frozen frames or audio-video desync at the start of the clip.
3. **Local File Invariance:**
   For local files (`video.mp4`), `selection.hasSelection` continues to execute the standard local cut via `FFmpegRunner.cutVideo()`. No breaking changes to existing local workflows.

---

## 7. Migration & Rollout Plan

1. **PR & Review:** Open PR against `main` in `nouverse/nouclip`.
2. **Nox Audit Gate:** Submit for security and regression audit.
3. **Automated Unit Tests:** Add test cases in `tests/commands/auto.test.ts` mocking `YouTubeDownloader.download` with and without `section`.
4. **Release:** Tag `v1.0.3` / `v1.1.0` and deploy to distribution channels.
