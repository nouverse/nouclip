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

An **agentic-first CLI tool** for video cutting, aspect ratio reframing, Whisper transcription, and animated kinetic subtitles.

Designed for automated workflows, AI agent harnesses, and power users who need deterministic, scriptable video operations with persistent artifact caching.

---

## ⚡ Core Philosophy & Features

- 🤖 **Agentic-First & Context-Rich:** Built-in introspection commands (`nouclip info`, `nouclip list --json`) that allow AI agents and scripts to discover paths, inspect storage, and reuse existing artifacts.
- 📦 **Zero-Waste Artifact Management:** Downloaded raw videos, audio WAVs, word-level Whisper transcripts (`.json`), and styled ASS subtitle files are preserved in dedicated folders rather than deleted silently.
- ⏱️ **Human & Agent Timestamps:** Supports flexible range syntaxes like `--range 13:25-14:50`, `01:13:25`, `85s`, and `13m25s`.
- 📐 **Universal Aspect Reframing:** Converts videos to any aspect ratio (`9:16`, `1:1`, `4:5`, `16:9`, or custom `W:H`) with multiple framing modes (`blur`, `center`, `pad`, `stretch`).
- ✍️ **Draft & Staged Workflow (`--draft` / `--no-burn`):** Cuts and prepares transcript/ASS files for human or agent review before burning subtitles into the final video.
- 🎙️ **GPU STT Integration:** Directly integrates with local GPU endpoints like **[Voice Compute](https://github.com/nouverse/voice-compute)** or any OpenAI-compatible Whisper API.
- ✨ **Animated Kinetic Subtitles:** Dynamic ASS subtitles where active words bounce and change color in sync with speech.

---

## 📁 Workspace & Artifact Structure

NouClip organizes all assets in a structured workspace (defaults to `~/.nouclip` or `./.nouclip`):

```text
~/.nouclip/
├── downloads/        # Cached source/YouTube videos (never re-downloaded twice)
├── transcripts/      # Whisper JSON transcripts (*.whisper.json) and ASS scripts (*.ass)
├── segments/         # Raw cut segments and reframed video files
└── output/           # Final rendered videos with burned subtitles
```

Run `nouclip info` anytime to inspect current paths, file counts, and storage usage.

---

## 📥 Installation

### Method 1: Standalone Binaries (Recommended)

Download the pre-compiled binary for your operating system from the **[GitHub Releases](https://github.com/nouverse/nouclip/releases)** page:

| Platform | Architecture | Binary |
|---|---|---|
| 🐧 Linux | x86_64 | `nouclip-linux-x64` |
| 🍎 macOS | Apple Silicon (M1/M2/M3/M4) | `nouclip-darwin-arm64` |
| 🍏 macOS | Intel (x86_64) | `nouclip-darwin-x64` |
| 🪟 Windows | x86_64 | `nouclip-windows-x64.exe` |

---

### Method 2: One-Line Install Script (Linux / macOS)

Downloads the latest release binary for your architecture and places it into `/usr/local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/nouverse/nouclip/main/install.sh | bash
```

---

### Method 3: From Source (Bun)

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

# STT Whisper Endpoint (Local Voice Compute or Remote OpenAI)
NOUCLIP_VOICE_COMPUTE_URL=http://localhost:8880
NOUCLIP_VOICE_COMPUTE_API_KEY=

# LLM Endpoint (Optional — for automated highlight suggestion)
NOUCLIP_OPENAI_BASE_URL=https://api.openai.com/v1
NOUCLIP_OPENAI_API_KEY=
NOUCLIP_OPENAI_MODEL=gpt-4o-mini
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
# From YouTube URL using timestamp range
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10 --blur

# From local file with square 1:1 aspect ratio
nouclip auto interview.mp4 --range 01:20-02:00 --aspect 1:1 --mode pad -o out/feed.mp4
```

---

### 3. Review & Staged Workflow (Draft Mode)

If you want to review and correct subtitle typos before rendering the final video:

```bash
# Step 1: Generate segment + transcript without burning
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10 --draft

# Output:
# 📹 Video Segment  : ~/.nouclip/segments/video_framed_9x16_center.mp4
# 📝 Subtitle Script: ~/.nouclip/transcripts/video_13m25s-14m10s.ass

# Step 2: Open and edit the .ass file in any text editor

# Step 3: Burn the verified subtitles
nouclip subtitle ~/.nouclip/segments/video_framed_9x16_center.mp4 \
  --sub ~/.nouclip/transcripts/video_13m25s-14m10s.ass \
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

# 1:1 Square with center crop
nouclip crop input.mp4 --aspect 1:1 --mode center

# 4:5 Portrait with black letterbox
nouclip crop input.mp4 --aspect 4:5 --mode pad
```

#### Extract Audio & Generate Whisper Transcript
```bash
nouclip extract input.mp4 --lang id
```

#### Export Transcript (SRT / VTT / TXT)
```bash
nouclip transcript input.mp4 --format srt -o sub.srt
nouclip transcript input.mp4 --format txt -o speech.txt
```

---

## 🏗️ Cross-Compiling Standalone Binaries

Compile binaries for all supported platforms:

```bash
bun run build:all

# Or build platform-specific:
bun run build:linux          # dist/nouclip-linux-x64
bun run build:darwin-arm64   # dist/nouclip-darwin-arm64
bun run build:darwin-x64     # dist/nouclip-darwin-x64
bun run build:win            # dist/nouclip-windows-x64.exe
```

---

## 🔗 Related Repositories

- **[nouverse/voice-compute](https://github.com/nouverse/voice-compute)** — Local GPU STT/TTS compute engine (Whisper Large-v3, F5-TTS, Edge-TTS).

---

## 📄 License

Distributed under the **MIT License**.
