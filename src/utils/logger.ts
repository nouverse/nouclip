import pc from 'picocolors';

export const logger = {
  banner() {
    console.log(pc.bold(pc.cyan('\n🎬 NouClip — AI Video Clipper & Shorts Engine')));
    console.log(pc.dim('   Built by Nouverse Technologies · Powered by Bun & FFmpeg\n'));
  },
  info(msg: string) {
    console.log(`${pc.cyan('ℹ')} ${msg}`);
  },
  success(msg: string) {
    console.log(`${pc.green('✔')} ${pc.bold(msg)}`);
  },
  warn(msg: string) {
    console.log(`${pc.yellow('⚠')} ${msg}`);
  },
  error(msg: string) {
    console.error(`${pc.red('✖')} ${pc.red(msg)}`);
  },
  step(num: number, total: number, msg: string) {
    console.log(`\n${pc.magenta(`[${num}/${total}]`)} ${pc.bold(msg)}`);
  }
};
