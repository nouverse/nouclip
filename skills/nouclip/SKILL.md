---
name: nouclip
description: CLI video clipping, universal aspect reframing (9:16, 1:1, 4:5), Whisper transcription, kinetic subtitle burning, and draft review workflows using NouClip CLI.
---

# NouClip — Agentic Video Clipper & Shorts Engine Skill

NouClip is an agentic-first CLI tool for deterministic video cutting, aspect ratio reframing, Whisper transcription, and animated kinetic subtitles.

---

## 🔍 Introspection & Storage Discovery

Before running operations, check workspace paths and existing artifacts:

```bash
# Get storage paths, file counts, and service status as JSON
nouclip info --json

# List existing cached downloads
nouclip list downloads --json

# List existing transcripts and ASS subtitles
nouclip list transcripts --json

# List rendered final outputs
nouclip list output --json
```

---

## ⏱️ Timestamp & Range Syntax

NouClip supports flexible time formats across all clipping commands:
- **Ranges:** `--range 13:25-14:50` or `--range 01:20..02:15` or `--range 45-75`
- **Explicit From/To:** `--from 13:25 --to 14:50` (or `--start 13:25 --end 14:50`)
- **Duration:** `--from 13:25 --duration 45s` (or `--start 805 --duration 45`)
- **Formats accepted:** `MM:SS` (`13:25`), `HH:MM:SS` (`01:13:25`), human units (`1h30m`, `13m25s`, `45s`), and raw seconds (`85.5`).

---

## 📐 Aspect Ratios & Framing Modes

| Aspect Ratio (`--aspect`) | Target Resolution | Best Used For |
|---|---|---|
| `9:16` *(default)* | 1080x1920 | YouTube Shorts, TikTok, Instagram Reels |
| `1:1` | 1080x1080 | Instagram Feed, LinkedIn, Twitter/X video |
| `4:5` | 1080x1350 | Instagram Portrait Post |
| `16:9` | 1920x1080 | Landscape / YouTube standard |
| `4:3` | 1440x1080 | Classic standard definition |

### Framing Styles (`--mode`)
- `--mode blur` *(or `--blur`)*: Scales and heavily blurs background video, overlays clean centered foreground. Ideal for podcasts and screen-shares.
- `--mode center`: Full-bleed zoom and center crop to fill the entire target canvas.
- `--mode pad`: Letterbox / pillarbox with black padding bars.
- `--mode stretch`: Scales directly without maintaining source aspect ratio.

---

## ✍️ Staged & Draft Review Workflow (Recommended for Agents)

AI Whisper STT can mishear proper nouns, brand names, or slang. Use `--draft` to review transcripts before burning:

### Step 1: Generate Segment & Subtitle Draft
```bash
nouclip auto "https://youtu.be/EXAMPLE_ID" --range 13:25-14:10 --aspect 9:16 --blur --draft
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
  -l, --lang <lang>         Whisper language (default: "id")
  --font-size <size>        Subtitle font size (default: 60)
  --draft, --no-burn        Pause before burning for subtitle review
  -o, --output <path>       Output video path
  --download-dir <dir>      Custom directory for raw downloads
  --output-dir <dir>        Custom directory for rendered outputs
```

### 2. `download` — YouTube Downloader & Caching
```bash
nouclip download <url> [options]
  -s, --start <time>        Start timestamp
  -e, --end <time>          End timestamp
  -o, --output <filename>   Output filename template
  --dir <directory>         Download destination directory
  --force                   Force re-download even if already cached
```

### 3. `cut` — Fast Video Segment Clipping
```bash
nouclip cut <video> [options]
  -r, --range <range>       Time range e.g. "13:25-14:50"
  -s, --start, --from <t>   Start timestamp
  -e, --end, --to <t>       End timestamp
  -d, --duration <t>        Duration
  -o, --output <path>       Output MP4 path
  --reencode                Re-encode video with libx264 (default: false)
```

### 4. `crop` / `reframe` — Aspect Ratio Converter
```bash
nouclip crop <video> [options]
  -a, --aspect <ratio>      Target aspect ratio (9:16, 1:1, 4:5, 16:9)
  -m, --mode <mode>         Framing style: blur, center, pad, stretch
  --blur                    Shortcut for --mode blur
  -o, --output <path>       Output MP4 path
```

### 5. `extract` — Audio & Whisper Transcription
```bash
nouclip extract <video> [options]
  -l, --lang <lang>         Language (default: "id")
  -m, --model <model>       Model name (default: "large-v3")
  -o, --output <path>       Output JSON path (default: ~/.nouclip/transcripts/)
```

### 6. `transcript` — Format Converter
```bash
nouclip transcript <videoOrJson> [options]
  -f, --format <format>     Export format: txt, srt, vtt, json (default: txt)
  -l, --lang <lang>         Language (default: "id")
  -o, --output <path>       Output file path
```

### 7. `subtitle` — Animated Subtitle Burner
```bash
nouclip subtitle <video> [options]
  -s, --sub <path>          Path to .ass script or .json word timestamps
  --font-size <size>        Font size (default: 60)
  --primary-color <hex>     Inactive text color
  --highlight-color <hex>   Active animated word color
  -o, --output <path>       Output MP4 path
```

---

## ⚙️ Environment Variables

Set in `~/.nouclip/.env` or working directory `.env`:

```bash
# Storage Paths
NOUCLIP_WORKSPACE_DIR=~/.nouclip
NOUCLIP_DOWNLOAD_DIR=~/.nouclip/downloads
NOUCLIP_TRANSCRIPT_DIR=~/.nouclip/transcripts
NOUCLIP_OUTPUT_DIR=~/.nouclip/output

# STT Whisper API Endpoint (Voice Compute or OpenAI)
NOUCLIP_VOICE_COMPUTE_URL=http://localhost:8880
NOUCLIP_VOICE_COMPUTE_API_KEY=

# Optional LLM API Endpoint
NOUCLIP_OPENAI_BASE_URL=https://api.openai.com/v1
NOUCLIP_OPENAI_API_KEY=
NOUCLIP_OPENAI_MODEL=gpt-4o-mini
```
