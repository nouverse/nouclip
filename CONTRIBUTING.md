# Contributing to NouClip 🎬

Thank you for your interest in contributing to **NouClip**! NouClip is an open-source, high-performance AI video clipper and shorts generator built by Nouverse Technologies, powered by Bun, FFmpeg, and Whisper.

We welcome contributions of all levels: bug fixes, performance optimizations, new framing algorithms, documentation polish, and agentic integrations.

---

## 📋 Prerequisites

Before starting, ensure you have the required runtime and media tools installed:

1. **[Bun](https://bun.sh)** (v1.1 or later):
   ```bash
   # macOS / Linux
   curl -fsSL https://bun.sh/install | bash

   # Windows
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

2. **[FFmpeg](https://ffmpeg.org)** & **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** (must be on system `$PATH`):
   - **macOS:** `brew install ffmpeg yt-dlp`
   - **Ubuntu/Debian:** `sudo apt install ffmpeg && pip install yt-dlp`
   - **Windows:** `winget install Gyan.FFmpeg yt-dlp`

3. *(Optional for STT transcription)*:
   - Self-hosted **[Voice Compute](https://github.com/nouverse/voice-compute)** running locally on `http://localhost:8880`, OR
   - Any OpenAI-compatible cloud STT provider (e.g. **Groq**, **OpenAI**) by setting `NOUCLIP_OPENAI_AUDIO_URL` and `NOUCLIP_OPENAI_AUDIO_API_KEY`.

---

## 🛠️ Setup & Development Workflow

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/nouverse/nouclip.git
cd nouclip
bun install
```

### 2. Run CLI in Development Mode
You can execute commands directly against TypeScript source files using `bun dev`:
```bash
# Display help and commands
bun dev --help

# Test inspection command
bun dev info

# Test automated clipping pipeline on a local video
bun dev auto sample.mp4 --range 00:10-00:35 --aspect 9:16 --no-subtitles -o output_clean.mp4

# Test with draft mode (outputs .ass and audio without burning)
bun dev auto sample.mp4 --range 00:10-00:35 --draft
```

### 3. Global Symlink for Local Testing (`bun link`)
To use the local development build globally across your system shell:
```bash
bun link
nouclip --help
```

---

## 🧪 Testing

We use Bun's built-in test runner. Tests live in `tests/`, mirroring the `src/` layout:

```
tests/
├── utils/      # time parsing, error helpers, path resolution
├── core/       # ass, ffmpeg, config/env, selection, transcript, highlights, llm, whisper, youtube, workspace
├── commands/   # CLI flag semantics (negatable flags, framing, numeric options)
├── e2e/        # CLI smoke tests + real ffmpeg pipeline
└── version.test.ts
```

```bash
# Run everything
bun test

# Watch mode during active development
bun test --watch

# Coverage report
bun run test:coverage

# One command for the full gate (typecheck + lint + tests)
bun run check
```

### Testing guidelines

- **Keep logic pure and testable.** Argument construction, parsing and formatting live in
  pure functions (`FFmpegRunner.buildReframeArgs`, `WhisperClient.normalizeResponse`,
  `renderTranscript`, ...) so they can be asserted without spawning a process or hitting a network.
- **Commands throw, they do not exit.** Commands raise `CliError`; `src/cli.ts` is the only place
  that maps an error to an exit code. This keeps command logic unit-testable.
- **Isolate the workspace.** Tests that touch the filesystem must use `mkdtempSync` and override
  *all* `NOUCLIP_*_DIR` variables — a contributor's global `~/.nouclip/.env` may pin each directory
  individually.
- **ffmpeg tests self-skip.** `tests/e2e/pipeline.test.ts` runs against a generated `lavfi` clip and
  skips when ffmpeg is missing locally. CI asserts ffmpeg is present, so the suite cannot silently
  stop running there.

When you add a feature, parser, or filter, add a matching test file under the directory that mirrors
its source module.

---

## 🧑‍💻 Code Quality Standards & Quality Gates

We use **Biome** for lightning-fast linting/formatting and **TypeScript** for strict type checking.

Before submitting a Pull Request, run the full validation suite:

```bash
# Everything the CI gate runs, in one command
bun run check

# ...or step by step:
bun run typecheck   # 1. Typecheck (0 errors required, covers src/ and tests/)
bun run lint        # 2. Lint + format check
bun run format      # 3. Auto-format code
bun test            # 4. Unit + integration tests
bun run build:all   # 5. Verify cross-platform binary compilation
```

### Code Style Rules:
- Use TypeScript path alias `@/*` (e.g., `import { config } from '@/core/config'`).
- Use **single quotes** for strings and 2-space indentation.
- Never hardcode personal paths or platform-specific directory separators. Always use `config.*` getters and standard `node:path` utilities (`join`, `resolve`).
- Prefer clean, modular code with zero unnecessary dependencies.

---

## 📂 Project Architecture

```
nouclip/
├── src/
│   ├── cli.ts              # Command-line entry point (Commander CLI)
│   ├── commands/           # Modular CLI commands
│   │   ├── auto.ts         # End-to-end automated clipping pipeline
│   │   ├── crop.ts         # Aspect ratio reframing & padding filters
│   │   ├── cut.ts          # Video trimming & fast stream copy
│   │   ├── download.ts     # YouTube yt-dlp downloader with caching
│   │   ├── extract.ts      # Audio extraction & Whisper transcription
│   │   ├── framing.ts      # Shared --mode/--blur/--center resolution
│   │   ├── highlight.ts    # Heuristic & LLM virality moment finder
│   │   ├── info.ts         # Workspace & service introspection
│   │   ├── list.ts         # Asset cataloging (downloads, segments, transcripts)
│   │   ├── subtitle.ts     # ASS subtitle burner
│   │   └── transcript.ts   # Transcript exporter (TXT, SRT, VTT, JSON)
│   ├── core/               # Core engine modules
│   │   ├── ass.ts          # Kinetic animated ASS subtitle generator
│   │   ├── config.ts       # Config getters & managed workspace directories
│   │   ├── env.ts          # Dependency-free .env parser
│   │   ├── ffmpeg.ts       # FFmpeg arg builders & process runner
│   │   ├── highlights.ts   # Keyword & heuristic moment finders
│   │   ├── llm.ts          # OpenAI-compatible LLM client
│   │   ├── selection.ts    # Shared --range/--start/--end/--duration resolution
│   │   ├── transcript.ts   # TXT/SRT/VTT renderers
│   │   ├── whisper.ts      # OpenAI-compatible Whisper STT client
│   │   ├── workspace.ts    # Asset listing & directory statistics
│   │   └── youtube.ts      # yt-dlp wrapper & cache manager
│   ├── utils/              # Shared helpers (logger, errors, path, time parsers)
│   └── version.ts          # Runtime version (kept in sync by a test)
├── tests/                  # Test suite (bun:test), mirroring src/
├── skills/                 # AI Agent operational skill definitions
└── .github/workflows/      # GitHub Actions CI/CD workflows
```

---

## 🌿 Submitting Pull Requests

1. **Fork the repository** on GitHub.
2. **Create a branch** for your feature or bugfix:
   ```bash
   git checkout -b feat/smart-face-tracking
   ```
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: ...` for new features or capabilities
   - `fix: ...` for bug fixes
   - `refactor: ...` for code improvements without behaviour changes
   - `docs: ...` for documentation updates
   - `test: ...` for adding or updating tests
4. Push your branch to GitHub and submit a Pull Request targeting `main`.
5. Ensure that the automated **CI Quality Gate** passes on your PR.

---

## 💖 Community

- Issues & Feature Requests: [GitHub Issues](https://github.com/nouverse/nouclip/issues)
- Discussions: [GitHub Discussions](https://github.com/nouverse/nouclip/discussions)
- Website: [nouverse.com](https://nouverse.com)
