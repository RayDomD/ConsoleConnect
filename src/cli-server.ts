import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join, relative, sep } from 'node:path';
import type { WebContents } from 'electron';
import { cliProtocolVersion, pipePath, type CliReply } from './cli';

const maxRequestBytes = 1_000_000;
const maxArguments = 64;
const replyTimeoutMs = 60_000;

export interface CliForward { id: string; argv: string[]; cwd: string; tool?: string; console?: string; taskId: string | null }

// A command run inside a task worktree (<userData>/worktrees/<taskId>/...) defaults to that task.
export function taskIdForCwd(worktrees: string, cwd: string) {
  const path = relative(worktrees, cwd);
  if (!path || path.startsWith('..')) return null;
  const first = path.split(sep)[0]!;
  return /^[0-9a-f-]{36}$/i.test(first) ? first.toLowerCase() : null;
}

// The pipe only relays: the renderer holds the workspace session, so it runs the command and answers.
export function startCliServer(options: { worktrees: string; target: () => WebContents | null;
  onReply: (listener: (reply: { id: string; reply: CliReply }) => void) => void }): Server {
  const pending = new Map<string, (reply: CliReply) => void>();
  options.onReply(({ id, reply }) => pending.get(id)?.(reply));
  const path = pipePath();
  if (process.platform !== 'win32') rmSync(path, { force: true });
  const server = createServer(socket => {
    let body = '';
    let handled = false;
    const answer = (reply: CliReply) => { if (!socket.destroyed) socket.end(JSON.stringify(reply)); };
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (handled) return;
      body += chunk;
      if (body.length > maxRequestBytes) { handled = true; answer({ ok: false, error: 'The request is too large.' }); return; }
      const end = body.indexOf('\n');
      if (end < 0) return;
      handled = true;
      let request: { version?: unknown; argv?: unknown; cwd?: unknown; tool?: unknown; console?: unknown };
      try { request = JSON.parse(body.slice(0, end)); } catch { answer({ ok: false, error: 'The request was not valid JSON.' }); return; }
      if (request.version !== cliProtocolVersion) { answer({ ok: false, error: 'Update console-connect to match this app.' }); return; }
      if (!Array.isArray(request.argv) || request.argv.length > maxArguments || !request.argv.every(item => typeof item === 'string')
        || typeof request.cwd !== 'string' || (request.tool !== undefined && typeof request.tool !== 'string')
        || (request.console !== undefined && typeof request.console !== 'string')) {
        answer({ ok: false, error: 'The request was malformed.' }); return;
      }
      const target = options.target();
      if (!target || target.isDestroyed()) { answer({ ok: false, error: 'Console Connect has no open window.' }); return; }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); answer({ ok: false, error: 'Console Connect did not answer.' }); }, replyTimeoutMs);
      pending.set(id, reply => { clearTimeout(timer); pending.delete(id); answer(reply); });
      const forward: CliForward = { id, argv: request.argv as string[], cwd: request.cwd, tool: request.tool as string | undefined,
        console: request.console as string | undefined,
        taskId: taskIdForCwd(options.worktrees, request.cwd) };
      target.send('cli-request', forward);
    });
  });
  server.on('error', error => console.error('console-connect pipe unavailable:', error.message));
  server.listen(path);
  return server;
}

// Shims run the bundled CLI with this app's own runtime, so teammates need no separate Node install.
export function writeCliShims(binDirectory: string, executable: string, cliScript: string) {
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(join(binDirectory, 'console-connect.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${executable}" "${cliScript}" %*\r\n`);
  const posix = join(binDirectory, 'console-connect');
  writeFileSync(posix, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${executable}" "${cliScript}" "$@"\n`);
  chmodSync(posix, 0o755);
  return binDirectory;
}

// Puts the shims first on PATH for a console, respecting Windows' case-insensitive "Path" key.
export function consoleEnvironment(base: NodeJS.ProcessEnv, binDirectory: string, extra: Record<string, string>) {
  const env = { ...base } as Record<string, string>;
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [binDirectory, env[pathKey]].filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
  return { ...env, ...extra };
}
