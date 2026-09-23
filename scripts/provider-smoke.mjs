import pty from 'node-pty';

const providers = [
  { name: 'Codex', file: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'codex',
    args: process.platform === 'win32' ? ['/d', '/c', 'codex.cmd', '--version'] : ['--version'] },
  { name: 'Claude Code', file: process.platform === 'win32' ? 'claude.exe' : 'claude', args: ['--version'] },
  { name: 'Antigravity', file: process.platform === 'win32' ? 'agy.exe' : 'agy', args: ['--version'] },
];

for (const provider of providers) {
  const output = await new Promise((resolve, reject) => {
    let text = '';
    let finished = false;
    const terminal = pty.spawn(provider.file, provider.args, { cwd: process.cwd(), cols: 100, rows: 30,
      name: 'xterm-256color', env: process.env });
    const timer = setTimeout(() => { if (!finished) { terminal.kill(); reject(new Error(`${provider.name} version check timed out.`)); } }, 10_000);
    terminal.onData(data => { text += data; });
    terminal.onExit(({ exitCode }) => {
      finished = true;
      clearTimeout(timer);
      if (exitCode === 0 && text.trim()) resolve(text.trim());
      else reject(new Error(`${provider.name} version check exited ${exitCode}: ${text.trim()}`));
    });
  });
  console.log(`${provider.name}: ${output.match(/\d+(?:\.\d+){1,3}/)?.[0] ?? 'version response received'}`);
}
process.exit(0);
