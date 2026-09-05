import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from '@/version';

const CLI = join(import.meta.dir, '..', '..', 'src', 'cli.ts');

/** Runs the CLI in an isolated workspace so tests never touch ~/.nouclip. */
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const workspace = mkdtempSync(join(tmpdir(), 'nouclip-e2e-'));
  try {
    const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
      // Every directory is overridden explicitly: a developer's global
      // ~/.nouclip/.env may pin each one individually, and those would
      // otherwise leak real assets into these assertions.
      env: {
        ...process.env,
        NO_COLOR: '1',
        NOUCLIP_WORKSPACE_DIR: workspace,
        NOUCLIP_DOWNLOAD_DIR: join(workspace, 'downloads'),
        NOUCLIP_TRANSCRIPT_DIR: join(workspace, 'transcripts'),
        NOUCLIP_SEGMENT_DIR: join(workspace, 'segments'),
        NOUCLIP_OUTPUT_DIR: join(workspace, 'output')
      },
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);

    return { code, stdout, stderr };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe('nouclip CLI', () => {
  it('prints the version from a single source of truth', async () => {
    const { code, stdout } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(VERSION);
  });

  it('lists every command in --help', async () => {
    const { code, stdout } = await runCli(['--help']);
    expect(code).toBe(0);
    for (const cmd of [
      'info',
      'list',
      'auto',
      'download',
      'cut',
      'crop',
      'extract',
      'transcript',
      'subtitle',
      'highlight'
    ]) {
      expect(stdout).toContain(cmd);
    }
  });

  it('exposes every styling override documented for auto', async () => {
    const { code, stdout } = await runCli(['auto', '--help']);
    expect(code).toBe(0);
    // These reach ASSGenerator through autoCommand; leaving them unregistered
    // made the code path unreachable from the CLI.
    for (const flag of ['--style', '--font-size', '--primary-color', '--highlight-color']) {
      expect(stdout).toContain(flag);
    }
  });

  it('fails on an unknown command', async () => {
    const { code, stderr } = await runCli(['nope']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('unknown command');
  });

  it('reports info as JSON scoped to the configured workspace', async () => {
    const { code, stdout } = await runCli(['info', '--json']);
    expect(code).toBe(0);

    const payload = JSON.parse(stdout);
    expect(payload.workspace.root).toContain('nouclip-e2e-');
    expect(payload.workspace.downloads.files).toBe(0);
    expect(payload.services.openAiLlmModel).toBeTruthy();
  });

  it('lists an empty workspace as empty JSON collections', async () => {
    const { code, stdout } = await runCli(['list', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      downloads: [],
      transcripts: [],
      segments: [],
      output: []
    });
  });

  it('exits non-zero with a readable message for a missing input file', async () => {
    const { code, stderr } = await runCli(['cut', 'missing.mp4', '--range', '0-10']);
    expect(code).toBe(1);
    expect(stderr).toContain('Input file not found');
  });

  it('rejects a bad time range before touching ffmpeg', async () => {
    const { code, stderr } = await runCli(['cut', 'missing.mp4', '--range', '10-5']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/must be after start|not found/);
  });

  it('rejects an invalid YouTube URL', async () => {
    const { code, stderr } = await runCli(['download', 'https://vimeo.com/1']);
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid YouTube URL');
  });

  it('rejects an unknown transcript format', async () => {
    const { code, stderr } = await runCli(['transcript', 'missing.json', '-f', 'pdf']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/not found|Unknown transcript format/);
  });
});
