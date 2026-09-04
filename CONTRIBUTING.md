# Contributing to NouClip 🎬

Thank you for your interest in contributing to **NouClip**! We welcome contributions of all kinds: bug reports, documentation improvements, feature ideas, and pull requests.

---

## 🛠️ Development Setup

1. **Prerequisites:**
   - [Bun](https://bun.sh) (v1.1+)
   - [FFmpeg](https://ffmpeg.org) & [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed and on `$PATH`.

2. **Clone & Install:**
   ```bash
   git clone https://github.com/nouverse/nouclip.git
   cd nouclip
   bun install
   ```

3. **Run in Development:**
   ```bash
   bun dev --help
   bun dev auto "https://youtu.be/EXAMPLE_ID" --start 60 --duration 15
   ```

---

## 🧑‍💻 Code Style & Quality Standards

We use **Biome** for fast formatting and linting, and **TypeScript** for strict type safety.

Before submitting a Pull Request, ensure all quality gates pass:

```bash
# 1. Typecheck (Zero errors required)
bun run typecheck

# 2. Linting
bun run lint

# 3. Format codebase (Single quotes, 2-space indentation)
bun run format

# 4. Verify compilation of standalone binaries
bun run build:all
```

### Guidelines:
- Use TypeScript path alias `@/*` for imports inside `src/`.
- Use **single quotes** for strings.
- Never hardcode personal paths or platform-specific assumptions. Prefer `config` helpers and standard environment variables (`NOUCLIP_`).

---

## 🌿 Pull Request Process

1. **Fork the repository** and create a feature branch (`git checkout -b feat/my-cool-feature`).
2. Make your changes and ensure `bun run typecheck && bun run lint` passes cleanly.
3. Write conventional commit messages (e.g. `feat(crop): add smart multi-speaker face tracking`).
4. Push to your branch and open a Pull Request against `main`.

---

## 💖 Community & Support

If you have questions, feel free to open an Issue or start a Discussion on GitHub!
