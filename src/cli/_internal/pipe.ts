import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export const cliProtocolVersion = 1;

// `console` is set by the app's own consoles ("orchestrator"), so automatic runs can hold hand-outs.
export interface CliRequest { version: typeof cliProtocolVersion; argv: string[]; cwd: string; tool?: string; console?: string }
export type CliReply = { ok: true; text: string; data: unknown } | { ok: false; error: string };

// One endpoint per signed-in user. CONSOLE_CONNECT_PIPE overrides it so tests and smoke runs
// never talk to a real running app.
export function pipePath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  if (env.CONSOLE_CONNECT_PIPE) return env.CONSOLE_CONNECT_PIPE;
  const user = userInfo().username.replace(/[^A-Za-z0-9_.-]/g, '_');
  return platform === 'win32'
    ? `\\\\.\\pipe\\console-connect-${user}`
    : join(env.XDG_RUNTIME_DIR || tmpdir(), `console-connect-${user}.sock`);
}
