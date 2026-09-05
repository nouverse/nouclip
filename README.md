# 🎬 NouClip — Agentic Video Clipper & Shorts Engine

[![Bun](https://img.shields.io/badge/Bun-1.1+-fbf0df.svg?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-6.0+-007808.svg?logo=ffmpeg&logoColor=white)](https://ffmpeg.org)
[![OpenAI Whisper](https://img.shields.io/badge/OpenAI_Whisper-Large--v3-blue.svg)](https://github.com/openai/whisper)
[![Release](https://img.shields.io/github/v/release/nouverse/nouclip?color=purple&label=Download%20CLI)](https://github.com/nouverse/nouclip/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa.svg?logo=github-sponsors)](https://github.com/sponsors/gadingnst)
[![Trakteer](https://img.shields.io/badge/Trakteer-Dukung%20Kreator-red.svg)](https://trakteer.id/gadingnst)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Buy%20a%20Coffee-29abe0.svg?logo=ko-fi)](https://ko-fi.com/gadingnst)

An **agentic-first CLI tool** for video cutting, aspect ratio reframing, Whisper transcription, animated kinetic subtitles, smart audio ducking, and auto silence trimming.

Designed for automated workflows, AI agent harnesses, and power users who need deterministic, scriptable video operations with persistent artifact caching.

---

## ⚡ Core Philosophy & Features

- 🤖 **Agentic-First & Context-Rich:** Built-in introspection commands (`nouclip info`, `nouclip list --json`) that allow AI agents and scripts to discover paths, inspect storage, and reuse existing artifacts.
- 📦 **Zero-Waste Artifact Management:** Downloaded raw videos, audio WAVs, word-level Whisper transcripts (`.json`), and styled ASS subtitle files are preserved in dedicated folders rather than deleted silently.
- ⏱️ **Human & Agent Timestamps:** Supports flexible range syntaxes like `--range 13:25-14:50`, `01:13:25`, `85s`, and `13m25s`.
- 📐 **Universal Aspect Reframing:** Converts videos to any aspect ratio (`9:16`, `1:1`, `4:5`, `16:9`, or custom `W:H`) with multiple framing modes (`blur`, `center`, `pad`, `stretch`).
- 🎨 **Typography Presets (`--style`):** Instant subtitle styling presets:
  - `hormozi`: Bold all-caps, neon green active-word highlight (`&H0000FF00`), pop zoom scaling (118%), thick outline.
  - `storyteller`: Clean natural-case, soft cyan active-word highlight (`&H0050E3C2`), thin outline.
  - `cinematic`: Wide tracking, golden amber highlight (`&H0000A5FF`).
  - `default`: Classic yellow highlight.
- ✂️ **Silence & Pause Trimming (`--silence-trim`):** Reads Whisper word timestamps to automatically cut silent pauses (`>0.6s`), concatenating speech seamlessly and auto-shifting subtitle timestamps.
- 🎵 **Smart BGM & Sidechain Ducking (`--bgm`):** Auto-loops background music and dynamically ducks/lowers BGM volume when speech is active (`sidechaincompress` + `amix`).
- ✍️ **Draft & Staged Workflow (`--draft` / `--no-burn`):** Cuts and prepares transcript/ASS files for human or agent review before burning subtitles into the final video.
- 🎙️ **GPU STT Integration:** Directly integrates with local GPU endpoints like **[Voice Compute](https://github.com/nouverse/voice-compute)** or any OpenAI-compatible Whisper API.

---

## 📁 Workspace & Artifact Structure

NouClip organizes all assets in a structured workspace (defaults to `~/.nouclip` or `./.nouclip`):

```text
~/.nouclip/
├── downloads/        # Cached source/YouTube videos (never re-downloaded twice)
├── transcripts/      # Whisper JSON transcripts (*.whisper.json) and ASS scripts (*.ass)
├── segments/         # Raw cut segments, trimmed audio/video, and reframed files
└── output/           # Final rendered videos with burned subtitles & mixed BGM
```

Run `nouclip info` anytime to inspect current paths, file counts, and storage usage.

---

## 📥 Installation

### Method 1: Standalone Binaries (Pre-compiled)

Download the pre-compiled standalone binary (zero runtime dependencies required) for your operating system from the **[GitHub Releases](https://github.com/nouverse/nouclip/releases)** page:

| Platform | Architecture | Binary |
|---|---|---|
| 🐧 Linux | x86_64 | `nouclip-linux-x64` |
| 🍎 macOS | Apple Silicon (M1/M2/M3/M4) | `nouclip-darwin-arm64` |
| 🍏 macOS | Intel (x86_64) | `nouclip-darwin-x64` |
| 🪟 Windows | x86_64 | `nouclip-windows-x64.exe` |

---

### Method 2: Package Managers (Bun / npm / pnpm)

> **💡 Recommended if you already have Bun or Node.js installed on your machine.** You can install NouClip globally or run it instantly without manual downloads:

```bash
# Using Bun (Fastest)
bun add -g nouclip

# Using npm
npm install -g nouclip

# Using pnpm
pnpm add -g nouclip

# Or run instantly without installing:
bunx nouclip --help
# or
npx nouclip --help
```

---

### Method 3: One-Line Install Script (Linux / macOS)

Downloads the latest release binary for your architecture and places it into `/usr/local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/nouverse/nouclip/main/install.sh | bash
```

---

### Method 4: From Source (Development)

```bash
git clone https://github.com/nouverse/nouclip.git
cd nouclip
bun install

# Run via Bun
bun run src/cli.ts --help

# Or build standalone executable
bun run build
./dist/nouclip --help
```

---

## 📋 Prerequisites

1. **[FFmpeg](https://ffmpeg.org)** & **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** installed on system PATH:
   - **macOS:** `brew install ffmpeg yt-dlp`
   - **Ubuntu/Debian:** `sudo apt install ffmpeg && pip install yt-dlp`
   - **Windows:** `winget install Gyan.FFmpeg yt-dlp`
2. *(Optional)* **[Voice Compute](https://github.com/nouverse/voice-compute)** or an OpenAI Whisper API endpoint for generating word-level subtitle timings.

---

## ⚙️ Configuration & Environment Variables

NouClip checks for environment variables in the following order:
1. `~/.nouclip/.env` (Global user config)
2. `./.env` (Current working directory)
3. Shell environment variables

### Example `.env`

```bash
# Storage & Workspace Paths (Optional)
NOUCLIP_WORKSPACE_DIR=~/.nouclip
NOUCLIP_DOWNLOAD_DIR=~/.nouclip/downloads
NOUCLIP_TRANSCRIPT_DIR=~/.nouclip/transcripts
NOUCLIP_OUTPUT_DIR=~/.nouclip/output

# STT Whisper / Audio Endpoint (Local voice-compute or Cloud OpenAI/Groq)
NOUCLIP_OPENAI_AUDIO_URL=http://localhost:8880
NOUCLIP_OPENAI_AUDIO_API_KEY=
NOUCLIP_OPENAI_AUDIO_MODEL=large-v3

# LLM Endpoint (Optional — for automated highlight suggestion)
NOUCLIP_OPENAI_LLM_URL=https://api.openai.com/v1
NOUCLIP_OPENAI_LLM_API_KEY=
NOUCLIP_OPENAI_LLM_MODEL=gpt-4o-mini
```

---

## 🚀 Usage Guide & Workflows

### 1. Inspecting Storage & Cached Assets (Introspection)

```bash
# Display storage paths, file counts, and service status
nouclip info

# JSON output for AI agents
nouclip info --json

# List cached downloaded videos
nouclip list downloads

# List generated transcripts
nouclip list transcripts

# List final rendered outputs
nouclip list output
```

---

### 2. End-to-End Automated Pipeline (`nouclip auto`)

Downloads (or reuses cache), cuts segment, reframes to vertical, transcribes with Whisper, and burns kinetic subtitles:

```bash
# Standard automated short (9:16 blurred background with kinetic subtitles)
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10

# Power Creator Setup: Hormozi Typography + Silence Trimming + Background Music
nouclip auto podcast.mp4 \
  --range 01:20-02:00 \
  --style hormozi \
  --silence-trim \
  --bgm "lofi_track.mp3" \
  --bgm-volume 0.10 \
  -o out/viral_short.mp4

# Clean Framing Only (0 subtitles — for video editors & post-production)
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10 --no-subtitles -o clean_short.mp4

# From local file with square 1:1 aspect ratio
nouclip auto interview.mp4 --range 01:20-02:00 --aspect 1:1 --mode pad -o out/feed.mp4
```

---

### 3. Review & Staged Workflow (Draft Mode)

If you want to review and correct subtitle typos before rendering the final video:

```bash
# Step 1: Generate segment + transcript without burning
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10 --style hormozi --draft

# Output:
# 📹 Video Segment  : ~/.nouclip/segments/video_framed_9x16_blur.mp4
# 📝 Subtitle Script: ~/.nouclip/transcripts/video_13m25s-14m10s.ass

# Step 2: Open and edit the .ass file in any text editor

# Step 3: Burn the verified subtitles & mix BGM
nouclip subtitle ~/.nouclip/segments/video_framed_9x16_blur.mp4 \
  --sub ~/.nouclip/transcripts/video_13m25s-14m10s.ass \
  --bgm "lofi_track.mp3" \
  -o ~/.nouclip/output/final_short.mp4
```

---

### 4. Modular Commands

#### Cut Video Segment
```bash
nouclip cut input.mp4 --range 13:25-14:10
```

#### Reframe Aspect Ratio & Mode
```bash
# 9:16 Vertical with blurred background fill
nouclip crop input.mp4 --aspect 9:16 --mode blur

# 1:1 Square with center crop fill
nouclip crop input.mp4 --aspect 1:1 --mode center
```

#### Extract Audio & Whisper Transcribe
```bash
nouclip extract input.mp4 --lang id --format json
```

#### Burn Subtitles & Mix Audio
```bash
nouclip subtitle input.mp4 --sub captions.ass --bgm music.mp3 --bgm-volume 0.10 -o final.mp4
```

---

## 🧪 Testing & CI

NouClip comes with an extensive unit and E2E test suite running across macOS, Linux, and Windows:

```bash
# Run all tests
bun test

# Typecheck & Lint
bun run typecheck
bun run lint
```

---

## 📄 License

MIT © [Nouverse Technologies](https://nouverse.tech) & [Gading Nasution](https://gading.dev)
