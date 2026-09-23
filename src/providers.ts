import type { Tool } from './coordination';

export function providerLaunch(tool: Tool, versionOnly = false) {
  const windows = process.platform === 'win32';
  const version = versionOnly ? ['--version'] : [];
  if (tool === 'codex') return windows
    ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', 'codex.cmd', ...version] }
    : { file: 'codex', args: version };
  if (tool === 'claude') return { file: windows ? 'claude.exe' : 'claude', args: version };
  return { file: windows ? 'agy.exe' : 'agy', args: version };
}
