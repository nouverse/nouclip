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

Workspace resolution order: `NOUCLIP_WORKSPACE_DIR` → a `.nouclip/` directory in the current working directory → `~/.nouclip/`. Running from a project that has its own `.nouclip/` therefore keeps artifacts local, so always confirm the active paths with `nouclip info --json` before assuming `~/.nouclip/`.

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
- `--style hormozi`: High-energy all-caps (Arial Black, 70px), electric neon green highlight (`&H0000FF00`), pop scaling 118%, thick 6px outline.
- `--style storyteller`: Clean natural-case (Arial, 54px), soft cyan highlight (`&H0050E3C2`), refined 3px outline.
- `--style cinematic`: Elegant all-caps wide-tracking (Trebuchet MS, 58px, spacing +4), golden amber highlight (`&H0000A5FF`).
- `--style default`: Classic all-caps (Arial Black, 62px) with yellow highlight (`&H0000FFFF`).

Each preset carries its own font size. `--font-size`, `--primary-color` and `--highlight-color` are overrides: pass them only to deviate from the preset, otherwise leave them out so the preset renders as designed.

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

## ✍️ Staged & Draft Review Workflow (MANDATORY FOR AI AGENTS)

> **⚠️ STRICT DIRECTIVE FOR ALL AI AGENTS:**
> 1. **ALWAYS use `--draft` (or `--no-burn`) on `nouclip auto` and video clipping.** Never run a blind end-to-end burn in one step.
> 2. **ALWAYS inspect and edit the intermediate `.ass` transcript** to fix typos, acronyms, or styling before rendering.
> 3. **MANDATORY USER CONFIRMATION:** Always present the draft cuts, summary, and transcript snippet to the user, and **WAIT for explicit user approval before triggering the final render/burn**.

AI Whisper STT can mishear proper nouns, brand names, or slang. The staging protocol guarantees zero hallucinated/typo subtitles:

### Step 1: Generate Segment & Subtitle Draft
```bash
nouclip auto "https://youtu.be/EXAMPLE_ID" \
  --range 13:25-14:10 \
  --aspect 9:16 \
  --style hormozi \
  --blur \
  --draft
```
Output will return:
- Segment Video: `~/.nouclip/segments/video_framed_9x16_blur.mp4`
- Subtitle Script: `~/.nouclip/transcripts/video_13m25s-14m10s.ass`

### Step 2: Review & Edit Subtitle
Read and correct any typos in the `.ass` file:
```bash
# Agent opens ~/.nouclip/transcripts/<name>.ass and edits words, casing, or styles directly
```

### Step 3: Present Draft & Await User Confirmation
Show the clip proposal and transcript draft to the user in your natural conversational voice/language (the following is an illustrative example):
```text
"Draft clip & subtitles are ready (13:25 - 14:10):
- Hook / Topic: 'Why we migrated to Hono...'
- Style: Hormozi (Neon Green highlight)
- Silence Trim: Enabled (>0.6s excised)
- BGM: lofi_beat.mp3 (Sidechain ducking active)

Ready to proceed with final rendering?"
```
**CRITICAL:** Present the plan in your natural voice, and **STOP to wait for explicit user confirmation**. DO NOT proceed to Step 4 until approved.

### Step 4: Burn Verified Subtitles into Final Video (After Approval)
```bash
nouclip subtitle ~/.nouclip/segments/video_framed_9x16_blur.mp4 \
  --sub ~/.nouclip/transcripts/video_13m25s-14m10s.ass \
  --bgm "lofi_music.mp3" \
  -o ~/.nouclip/output/final_short.mp4
```

---

## 🛠️ CLI Command Reference

### 1. `info` / `paths` — Storage & Service Introspection
```bash
nouclip info [options]
  --json                    Output results as clean JSON payload
```

### 2. `list` / `ls` — Stored Artifacts Discovery
```bash
nouclip list [type] [options]
  [type]                    Asset category: "downloads", "transcripts", "segments", "output", "all"
  --json                    Output asset list as clean JSON payload
```

### 3. `auto` — End-to-End Automated Pipeline
```bash
nouclip auto <videoOrUrl> [options]
  -r, --range <range>       Time range e.g. "13:25-14:50", "01:20..02:15", "45-75"
  -s, --start, --from <t>   Start timestamp e.g. "13:25", "01:13:25", "85s"
  -e, --end, --to <t>       End timestamp e.g. "14:50", "01:15:00"
  -d, --duration <time>     Duration e.g. "30s", "1m", "45"
  -a, --aspect <ratio>      Target aspect: "9:16", "1:1", "4:5", "16:9", "4:3", custom "W:H" (default: "9:16")
  -m, --mode <mode>         Framing style: "blur", "center", "pad", "stretch" (default: "blur")
  --blur                    Shortcut for --mode blur (blurred background letterbox)
  --center                  Shortcut for --mode center (crop fill)
  --no-subtitles            Do not generate or burn subtitles (clean reframed video only)
  --no-subs, --no-subtitle  Aliases for --no-subtitles
  -l, --lang <lang>         Whisper language (default: "id")
  --style <preset>          Typography style: "default", "hormozi", "storyteller", "cinematic"
  --font-size <size>        Font size override (default: the --style preset size)
  --primary-color <hex>     Inactive text color override e.g. "&H00FFFFFF&"
  --highlight-color <hex>   Active animated word color override e.g. "&H0000FFFF&"
  --silence-trim            Auto-trim silent pauses (>0.6s) between words for rapid pacing
  --silence-gap <seconds>   Silence threshold in seconds before trimming (default: 0.6)
  --bgm <path>              Background music track to mix with sidechain ducking
  --bgm-volume <volume>     BGM volume factor (default: 0.10)
  --no-ducking              Disable sidechain audio ducking (constant volume BGM)
  --draft, --no-burn        Pause before burning for subtitle review (MANDATORY FOR AGENTS)
  -o, --output <path>       Output video path
  --download-dir <dir>      Custom directory to store downloaded videos
  --output-dir <dir>        Custom directory to store final videos
  --keep-temp               Keep intermediate WAV and temporary files

Default output: <workspace>/output/<name><range>_short.mp4
                (or <name><range>_<aspect>_clean.mp4 with --no-subtitles)
```

### 4. `download` — YouTube Downloader & Caching
```bash
nouclip download <url> [options]
  -s, --start <time>        Start timestamp e.g. "13:25", "85s"
  -e, --end <time>          End timestamp e.g. "14:50"
  -o, --output <filename>   Output filename template
  --dir <directory>         Output download directory
  --force                   Force re-download even if already cached
```

### 5. `cut` — Fast Video Segment Clipping
```bash
nouclip cut <video> [options]
  -r, --range <range>       Time range e.g. "13:25-14:50", "80-110"
  -s, --start, --from <t>   Start timestamp
  -e, --end, --to <t>       End timestamp
  -d, --duration <time>     Duration e.g. "30s", "45"
  -o, --output <path>       Output MP4 path
  --reencode                Re-encode video with libx264 (default: false fast stream copy)
```

### 6. `crop` / `reframe` — Aspect Ratio Converter
```bash
nouclip crop <video> [options]
  -a, --aspect <ratio>      Target aspect: "9:16", "1:1", "4:5", "16:9", "4:3", custom "W:H" (default: "9:16")
  -m, --mode <mode>         Framing style: "blur", "center", "pad", "stretch" (default: "blur")
  --blur                    Shortcut for --mode blur
  --center                  Shortcut for --mode center (crop fill)
  -o, --output <path>       Output MP4 path
```

### 7. `extract` — Audio & Whisper Transcription
```bash
nouclip extract <video> [options]
  -r, --range <range>       Limit extraction to range e.g. "13:25-14:50"
  -s, --start, --from <t>   Start timestamp
  -e, --end, --to <t>       End timestamp
  -d, --duration <time>     Duration
  -l, --lang <lang>         Language for Whisper transcription (default: "id")
  -m, --model <model>       Whisper model name (default: "large-v3")
  --keep-wav                Keep the intermediate 16kHz mono WAV file
  -o, --output <path>       Output JSON (default: <workspace>/transcripts/<name><range>.whisper.json)
```

### 8. `transcript` — Format Converter
```bash
nouclip transcript <videoOrJson> [options]
  -f, --format <format>     Export format: "txt", "srt", "vtt", "json" (default: "txt")
  -l, --lang <lang>         Transcription language (default: "id")
  -o, --output <path>       Output file (default: <workspace>/transcripts/<name>_transcript.<format>)
```

### 9. `subtitle` — Animated Subtitle Burner & Audio Mixing
```bash
nouclip subtitle <video> [options]
  -s, --sub <path>          Path to .ass subtitle file or .json word timestamps
  -t, --timestamps <json>   Path to Whisper word timestamps JSON (alias for --sub)
  --style <preset>          Subtitle style: "default", "hormozi", "storyteller", "cinematic"
                            (only applied when --sub points at a .json, not a ready .ass)
  --font-size <size>        Font size override (default: the --style preset size)
  --primary-color <hex>     Inactive text color override (preset default: &H00FFFFFF&)
  --highlight-color <hex>   Active animated word color override (preset default: &H0000FFFF&)
  --bgm <path>              Background music track to mix with sidechain ducking
  --bgm-volume <volume>     BGM audio volume factor (default: 0.10)
  --no-ducking              Disable sidechain audio ducking (constant volume BGM)
  -o, --output <path>       Output MP4 path (default: <workspace>/output/<name>_subtitled.mp4)
```

### 10. `highlight` — AI Moments Discovery (Optional LLM Heuristics)
```bash
nouclip highlight <videoOrJson> [options]
  -k, --keyword <keyword>   Focus highlight search on a specific topic / keyword
  -m, --max-clips <count>   Maximum number of highlight clips to generate (default: 5)
  --min-duration <sec>      Minimum clip duration in seconds (default: 25)
  --max-duration <sec>      Maximum clip duration in seconds (default: 60)
  --budget <seconds>        Total duration cap across all returned clips (default: 180)
  -o, --output <path>       Output JSON (default: <transcript>.highlights.json)
```
Requires a Whisper JSON produced by `nouclip extract` first. Without an LLM API key it falls back to local heuristic density clustering, so it still works fully offline; `--keyword` always uses keyword matching instead of the LLM.

---

## ⚙️ Environment Variables & Agent E2E Setup

NouClip automatically loads configuration from `~/.nouclip/.env` (global) and `./.env` (local directory). Existing shell environment variables take precedence.

### Minimal vs Optional Configuration
- **THE ONLY ONE TO SET:** `NOUCLIP_OPENAI_AUDIO_URL` — your Whisper STT endpoint. It falls back to `http://localhost:8880`, so it can be omitted **only** when a local Whisper server already listens there; any other setup (Groq, OpenAI, a different port) must set it or every transcription step fails.
- **OPTIONAL:** Everything else works out-of-the-box using sensible defaults!
  - `NOUCLIP_OPENAI_AUDIO_API_KEY` is **optional** (leave blank for local Whisper compute).
  - All storage paths default cleanly to `~/.nouclip/`.
  - LLM variables are **optional** (only used when extracting viral moments via LLM heuristics).
  - Binaries (`ffmpeg`, `ffprobe`, `yt-dlp`) are auto-detected from system `$PATH`.

### Quick Minimal Setup (Local Voice Compute)
```bash
mkdir -p ~/.nouclip
cat << 'EOF' > ~/.nouclip/.env
# Required: Endpoint for Whisper STT
NOUCLIP_OPENAI_AUDIO_URL=http://localhost:8880
EOF
```

### Complete Environment Variables Reference Table

| Variable Name | Fallback Key | Requirement | Default Value | Description |
|---|---|---|---|---|
| `NOUCLIP_OPENAI_AUDIO_URL` | `OPENAI_AUDIO_URL` | **Set in practice** | `http://localhost:8880` | Whisper STT endpoint (local or remote OpenAI/Groq) |
| `NOUCLIP_OPENAI_AUDIO_API_KEY` | `OPENAI_AUDIO_API_KEY` | **Optional** | *(empty)* | API Key for audio endpoint (not required for local compute) |
| `NOUCLIP_OPENAI_AUDIO_MODEL` | `OPENAI_AUDIO_MODEL` | **Optional** | `large-v3` | Whisper model identifier |
| `NOUCLIP_WORKSPACE_DIR` | - | **Optional** | `./.nouclip` if present, else `~/.nouclip` | Root workspace directory for all artifacts & caches |
| `NOUCLIP_DOWNLOAD_DIR` | - | **Optional** | `~/.nouclip/downloads` | Storage directory for cached downloaded videos |
| `NOUCLIP_TRANSCRIPT_DIR` | - | **Optional** | `~/.nouclip/transcripts` | Storage for Whisper JSON & ASS subtitle scripts |
| `NOUCLIP_SEGMENT_DIR` | - | **Optional** | `~/.nouclip/segments` | Storage for cropped segments & reframed MP4s |
| `NOUCLIP_OUTPUT_DIR` | - | **Optional** | `~/.nouclip/output` | Destination for final rendered videos |
| `NOUCLIP_OPENAI_LLM_URL` | `OPENAI_LLM_URL` | **Optional** | `https://api.openai.com/v1` | OpenAI-compatible endpoint for moment analysis |
| `NOUCLIP_OPENAI_LLM_API_KEY` | `OPENAI_LLM_API_KEY` | **Optional** | *(empty)* | API key for LLM analysis |
| `NOUCLIP_OPENAI_LLM_MODEL` | `OPENAI_LLM_MODEL` | **Optional** | `gpt-4o-mini` | LLM model name for moment heuristics |
| `NOUCLIP_FFMPEG_PATH` | `FFMPEG_PATH` | **Optional** | `ffmpeg` on PATH | Custom path to FFmpeg binary |
| `NOUCLIP_FFPROBE_PATH` | `FFPROBE_PATH` | **Optional** | `ffprobe` on PATH | Custom path to FFprobe binary |
| `NOUCLIP_YTDLP_PATH` | `YTDLP_PATH` | **Optional** | `yt-dlp` on PATH | Custom path to yt-dlp binary |

