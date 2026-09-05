---
name: nouclip
description: CLI video clipping, universal aspect reframing (9:16, 1:1, 4:5), Whisper transcription, kinetic subtitle burning, typography presets, silence trimming, BGM ducking, dependency checks, and installation workflows using NouClip CLI.
---

# NouClip — Agentic Video Clipper & Shorts Engine Skill

Operational instructions and procedures for checking prerequisites, installing dependencies, clipping videos, reframing aspect ratios, transcribing with Whisper, applying typography presets, trimming silence, mixing ducked BGM, and burning kinetic subtitles using the `nouclip` CLI.

---

## 🛠️ Step 0: Verification & Self-Installation (For Agents)

Before running clipping commands, verify that required host binaries are present on the system.

### 1. Check if `nouclip` is Installed
```bash
nouclip --version
```

If `nouclip` is **not found** (`command not found` or `ENOENT`), install it using one of the following methods:

- **Option A (Package Managers — Recommended & Fastest):**
  Check if `bun`, `npm`, or `pnpm` is available on the machine:
  ```bash
  # Using Bun (Fastest)
  bun add -g nouclip

  # Using npm
  npm install -g nouclip

  # Using pnpm
  pnpm add -g nouclip
  ```

- **Option B (One-Line Standalone Script for Linux & macOS):**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/nouverse/nouclip/main/install.sh | bash
  ```

- **Option C (Direct GitHub Releases Binary Download):**
  ```bash
  # Linux (x86_64)
  curl -fsSL https://github.com/nouverse/nouclip/releases/latest/download/nouclip-linux-x64 -o /usr/local/bin/nouclip && chmod +x /usr/local/bin/nouclip

  # macOS Apple Silicon (arm64)
  curl -fsSL https://github.com/nouverse/nouclip/releases/latest/download/nouclip-darwin-arm64 -o /usr/local/bin/nouclip && chmod +x /usr/local/bin/nouclip

  # macOS Intel (x86_64)
  curl -fsSL https://github.com/nouverse/nouclip/releases/latest/download/nouclip-darwin-x64 -o /usr/local/bin/nouclip && chmod +x /usr/local/bin/nouclip

  # Windows (PowerShell)
  Invoke-WebRequest -Uri "https://github.com/nouverse/nouclip/releases/latest/download/nouclip-windows-x64.exe" -OutFile "$env:LOCALAPPDATA\Microsoft\WindowsApps\nouclip.exe"
  ```

### 2. Check & Install System Dependencies (`ffmpeg` & `yt-dlp`)
Check if installed:
```bash
ffmpeg -version
yt-dlp --version
```

If missing, install per host OS:
- **macOS:** `brew install ffmpeg yt-dlp`
- **Ubuntu/Debian:** `sudo apt update && sudo apt install -y ffmpeg && pip install yt-dlp`
- **Arch Linux:** `sudo pacman -S ffmpeg yt-dlp`
- **Windows:** `winget install Gyan.FFmpeg yt-dlp`

---

## 🔍 Introspection & Storage Discovery

NouClip is agent-friendly. Before re-downloading or re-processing, always inspect the workspace:

```bash
# Discover storage paths and existing assets in JSON
nouclip info --json

# List specific asset collections
nouclip list downloads --json
nouclip list transcripts --json
nouclip list segments --json
nouclip list output --json
```

Default workspace is `~/.nouclip/`:
- `~/.nouclip/downloads/` — Cached raw source/YouTube videos (never re-downloaded if present).
- `~/.nouclip/transcripts/` — Whisper JSONs (`*.whisper.json`) and ASS scripts (`*.ass`).
- `~/.nouclip/segments/` — Cut raw segments, trimmed videos, and reframed MP4s.
- `~/.nouclip/output/` — Final rendered videos with burned subtitles & mixed BGM.

---

## ⏱️ Timestamp & Range Syntax

NouClip accepts human, timestamp, and second ranges:
- **Ranges:** `--range 13:25-14:50` or `--range 01:20..02:15` or `--range 45-75`
- **Explicit From/To:** `--from 13:25 --to 14:50` (or `--start 13:25 --end 14:50`)
- **Duration:** `--from 13:25 --duration 45s` (or `--start 805 --duration 45`)
- **Formats accepted:** `MM:SS` (`13:25`), `HH:MM:SS` (`01:13:25`), human units (`1h30m`, `13m25s`, `45s`), and raw seconds (`85.5`).

---

## 🎨 Typography Presets (`--style`)

NouClip includes 4 built-in animated ASS kinetic typography presets:
- `--style hormozi`: High-energy all-caps (Arial Black), electric neon green highlight (`&H0000FF00`), pop scaling 118%, thick 6px outline.
- `--style storyteller`: Clean natural-case (Inter/Arial), soft cyan highlight (`&H0050E3C2`), refined 3px outline.
- `--style cinematic`: Elegant wide-tracking (+4), golden amber highlight (`&H0000A5FF`).
- `--style default`: Classic yellow highlight.

---

## ✂️ Silence & Pause Trimming (`--silence-trim`)

- Automatically detects silent pauses between spoken words using Whisper word timestamps (`--silence-gap 0.6` by default).
- Excises silent gaps and concatenates video seamlessly with FFmpeg.
- Automatically recalculates and frame-shifts subtitle `.ass` timestamps so captions stay 100% aligned with the trimmed video.

---

## 🎵 Background Music & Sidechain Ducking (`--bgm`)

- `--bgm <path>`: Background music track to loop and mix with video audio.
- Auto sidechain ducking: BGM volume automatically attenuates when speech is detected and gently rises back up during silence.
- `--bgm-volume <volume>`: BGM volume factor (default: `0.10`).
- `--no-ducking`: Disables sidechain compression for constant volume mixing.

---

## 📐 Aspect Ratios & Framing Modes

| Preset | Target Resolution | Description |
|---|---|---|
| `9:16` *(default)* | 1080x1920 | TikTok, YouTube Shorts, Instagram Reels |
| `1:1` | 1080x1080 | Instagram Feed, Square Video |
| `4:5` | 1080x1350 | Instagram Portrait Feed |
| `16:9` | 1920x1080 | YouTube Horizontal, Widescreen |
| `4:3` | 1440x1080 | Classic standard definition |

### Framing Styles (`--mode`)
- `--mode blur` *(default, or `--blur`)*: Scales and heavily blurs background video, overlays clean centered foreground. Ideal for podcasts and screen-shares.
- `--mode center` *(or `--center`)*: Full-bleed zoom and center crop to fill the entire target canvas.
- `--mode pad`: Letterbox / pillarbox with black padding bars.
- `--mode stretch`: Scales directly without maintaining source aspect ratio.

---

## ✍️ Staged & Draft Review Workflow (Recommended for Agents)

AI Whisper STT can mishear proper nouns, brand names, or slang. Use `--draft` to review transcripts before burning:

### Step 1: Generate Segment & Subtitle Draft
```bash
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10 --aspect 9:16 --style hormozi --blur --draft
```
Output will return:
- Segment Video: `~/.nouclip/segments/video_framed_9x16_blur.mp4`
- Subtitle Script: `~/.nouclip/transcripts/video_13m25s-14m10s.ass`

### Step 2: Review & Edit Subtitle
Read and correct any typos in the `.ass` file:
```bash
# Agent can read and edit the .ass text file directly
```

### Step 3: Burn Verified Subtitles into Final Video
```bash
nouclip subtitle ~/.nouclip/segments/video_framed_9x16_blur.mp4 \
  --sub ~/.nouclip/transcripts/video_13m25s-14m10s.ass \
  --bgm "lofi_music.mp3" \
  -o ~/.nouclip/output/final_short.mp4
```

---

## 🛠️ CLI Command Reference

### 1. `auto` — End-to-End Pipeline
```bash
nouclip auto <videoOrUrl> [options]
  -r, --range <range>       Time range e.g. "13:25-14:50"
  -s, --start, --from <t>   Start timestamp
  -e, --end, --to <t>       End timestamp
  -d, --duration <t>        Duration
  -a, --aspect <ratio>      Target aspect ratio (default: "9:16")
  -m, --mode <mode>         Framing mode: blur, center, pad, stretch
  --blur                    Shortcut for --mode blur
  --no-subtitles            Do not generate or burn subtitles (clean reframed video only)
  -l, --lang <lang>         Whisper language (default: "id")
  --style <preset>          Subtitle style preset: "default", "hormozi", "storyteller", "cinematic"
  --font-size <size>        Subtitle font size (default: 60)
  --silence-trim            Auto-trim silent pauses (>0.6s) between words
  --silence-gap <seconds>   Silence threshold in seconds before trimming (default: 0.6)
  --bgm <path>              Background music track to mix with sidechain ducking
  --bgm-volume <volume>     BGM audio volume factor (default: 0.10)
  --no-ducking              Disable sidechain audio ducking
  --draft, --no-burn        Pause before burning for subtitle review
  -o, --output <path>       Output video path
```

### 2. `subtitle` — Burn Subtitles & Audio Mixing
```bash
nouclip subtitle <video> [options]
  --sub <assPath>           ASS subtitle file to burn
  --style <preset>          Subtitle typography style preset
  --font-size <size>        Subtitle font size (default: 60)
  --bgm <path>              Background music track
  --bgm-volume <volume>     BGM audio volume factor (default: 0.10)
  --no-ducking              Disable sidechain audio ducking
  -o, --output <path>       Output MP4 path
```

### 3. `download` — YouTube Downloader & Caching
```bash
nouclip download <url> [options]
  -s, --start <time>        Start timestamp
  -e, --end <time>          End timestamp
  -o, --output <filename>   Output filename template
  --dir <directory>         Download destination directory
  --force                   Force re-download even if already cached
```

### 4. `cut` — Fast Video Segment Clipping
```bash
nouclip cut <video> [options]
  -r, --range <range>       Time range e.g. "13:25-14:50"
  -s, --start, --from <t>   Start timestamp
  -e, --end, --to <t>       End timestamp
  -d, --duration <t>        Duration
  -o, --output <path>       Output MP4 path
  --reencode                Re-encode video with libx264 (default: false)
```

### 5. `crop` / `reframe` — Aspect Ratio Converter
```bash
nouclip crop <video> [options]
  -a, --aspect <ratio>      Target aspect ratio (9:16, 1:1, 4:5, 16:9)
  -m, --mode <mode>         Framing style: blur, center, pad, stretch
  --blur                    Shortcut for --mode blur
  -o, --output <path>       Output MP4 path
```

### 6. `extract` — Audio & Whisper Transcription
```bash
nouclip extract <video> [options]
  -l, --lang <lang>         Language (default: "id")
  -m, --model <model>       Model name (default: "large-v3")
  -o, --output <path>       Output JSON path (default: ~/.nouclip/transcripts/)
```

### 7. `transcript` — Format Converter
```bash
nouclip transcript <videoOrJson> [options]
  -f, --format <format>     Export format: txt, srt, vtt, json (default: txt)
  -l, --lang <lang>         Language (default: "id")
```
