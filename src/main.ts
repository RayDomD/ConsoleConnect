import { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { IPty } from 'node-pty';
import { startHost } from './coordination';
import { prepareWorktree, worktreeChanges } from './execution';
import type { Snapshot, Tool } from './coordination';
import { prepareDecisionFile } from './decisions';
import { privateVpnAddress } from './network';
import { providerLaunch } from './providers';
import { resolveLinkedRepository } from './local-repository';
import { oauthCallbackUrl } from './oauth';
import { receiveOAuthCallback } from './oauth-callback';

let hosted: Awaited<ReturnType<typeof startHost>> | null = null;
type WorkspaceConnection = { url: string; token: string; mode?: 'local' } | {
  mode: 'supabase'; projectUrl: string; publishableKey: string; workspaceId: string; token: string;
};
type LocalSession = { terminal: IPty; url: string; token: string; hosted: boolean; shared: boolean; pending: string; sending: boolean; timer: NodeJS.Timeout; onShareError: () => void };
const sessions = new Map<string, LocalSession>();
const terminalWatches = new Map<string, AbortController>();
let workspaceWatch: AbortController | null = null;
let oauthInProgress = false;
async function terminalRequest(session: LocalSession, taskId: string, operation: 'share' | 'output', body: object) {
  if (session.hosted) throw new Error('Terminal sharing is not available for hosted workspaces yet.');
  const response = await fetch(new URL(`/terminal/${taskId}/${operation}`, session.url), {
    method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Terminal sharing failed.');
}
function workspaceFetch(connection: WorkspaceConnection, path: string, body?: object) {
  const base = new URL(connection.mode === 'supabase' ? connection.projectUrl : connection.url);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Use an HTTP workspace address.');
  const url = connection.mode === 'supabase'
    ? new URL(`/functions/v1/console-connect${path}`, base) : new URL(path, base);
  if (connection.mode === 'supabase') url.searchParams.set('workspaceId', connection.workspaceId);
  return fetch(url, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json',
      ...(connection.mode === 'supabase' ? { apikey: connection.publishableKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function flushTerminal(taskId: string, session: LocalSession) {
  if (!session.shared || !session.pending || session.sending) return;
  session.sending = true;
  const chunk = session.pending.slice(0, 4096);
  session.pending = session.pending.slice(4096);
  try { await terminalRequest(session, taskId, 'output', { chunk }); }
  catch {
    session.shared = false; session.pending = '';
    void terminalRequest(session, taskId, 'share', { enabled: false }).catch(() => {});
    session.onShareError();
  }
  finally { session.sending = false; }
}
if (process.env.CONSOLE_CONNECT_TEST_DATA) app.setPath('userData', process.env.CONSOLE_CONNECT_TEST_DATA);

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1320, height: 860, minWidth: 960, minHeight: 620,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  void window.loadFile(join(__dirname, 'index.html')).catch(error => { console.error('Desktop launch failed:', error); app.exit(1); });
});

ipcMain.handle('host', async (_event, input: { name: string; repository: string; owner: string }) => {
  if (hosted) return hostConnection(hosted);
  hosted = await startHost({ directory: join(app.getPath('userData'), 'workspace'), ...input,
    bind: privateVpnAddress(networkInterfaces()) ?? '127.0.0.1', port: 24680 });
  return hostConnection(hosted);
});

function hostConnection(host: Awaited<ReturnType<typeof startHost>>) {
  const localOnly = host.url.startsWith('http://127.0.0.1:');
  return { url: host.url, token: host.token, shareUrl: localOnly ? undefined : host.url, localOnly };
}

ipcMain.handle('request', async (_event, input: { url: string; token: string; path: string; body?: unknown }) => {
  const base = new URL(input.url);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Use an HTTP workspace address.');
  if (!['/join', '/state', '/invites', '/commands'].includes(input.path) && !/^\/pull-request\/[0-9a-f-]{36}$/i.test(input.path)) throw new Error('Unknown workspace operation.');
  const response = await fetch(new URL(input.path, base), {
    method: input.body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return { status: response.status, data: await response.json() };
});

ipcMain.handle('watch-workspace', (event, input: { url: string; token: string }) => {
  const base = new URL(input.url);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Use an HTTP workspace address.');
  workspaceWatch?.abort();
  const controller = new AbortController();
  workspaceWatch = controller;
  const notify = (channel: string, value?: unknown) => {
    if (!event.sender.isDestroyed() && !controller.signal.aborted) event.sender.send(channel, value);
  };
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(new URL('/events', base), {
          headers: { authorization: `Bearer ${input.token}` }, signal: controller.signal,
        });
        if (response.status === 401) { notify('workspace-connection-error', 'Reconnect with a valid workspace invitation.'); break; }
        if (!response.ok || !response.body) throw new Error('Workspace event stream is unavailable.');
        notify('workspace-connected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6)) as { revision?: number };
            if (typeof event.revision === 'number') notify('workspace-revision', event.revision);
          }
        }
      } catch { /* The periodic snapshot check continues while the event stream reconnects. */ }
      if (!controller.signal.aborted) await new Promise<void>(resolve => {
        const onAbort = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, 2500);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (workspaceWatch === controller) workspaceWatch = null;
  })();
});

ipcMain.on('stop-watch-workspace', () => { workspaceWatch?.abort(); workspaceWatch = null; });

ipcMain.handle('choose-repository', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Choose your local project copy' });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('copy-text', (_event, value: string) => clipboard.writeText(value));

ipcMain.handle('notify-team-chat', (event, input: { title: string; body: string }) => {
  if (!Notification.isSupported()) return false;
  const window = BrowserWindow.fromWebContents(event.sender);
  const notification = new Notification({ title: String(input.title).slice(0, 160),
    body: String(input.body).slice(0, 240) });
  notification.on('click', () => {
    window?.show();
    window?.focus();
    if (!event.sender.isDestroyed()) event.sender.send('open-team-chat-notification');
  });
  notification.show();
  return true;
});

ipcMain.handle('open-oauth', async (_event, input: { projectUrl: string; url: string }) => {
  const project = new URL(input.projectUrl);
  const authorization = new URL(input.url);
  const redirectTo = authorization.searchParams.get('redirect_to');
  let redirect: URL | null = null;
  try { if (redirectTo) redirect = new URL(redirectTo); } catch { /* Reject malformed redirects below. */ }
  const localProject = project.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(project.hostname);
  if ((!localProject && project.protocol !== 'https:') || authorization.origin !== project.origin
    || !redirect || `${redirect.origin}${redirect.pathname}` !== oauthCallbackUrl
    || !['/auth/v1/authorize', '/auth/v1/user/identities/authorize'].includes(authorization.pathname)) {
    throw new Error('The sign-in address does not match this Supabase project.');
  }
  if (oauthInProgress) throw new Error('Finish the current sign-in first.');
  oauthInProgress = true;
  try {
    return await receiveOAuthCallback(() => shell.openExternal(authorization.toString()));
  } finally {
    oauthInProgress = false;
  }
});

ipcMain.handle('validate-repository', (_event, input: { repositoryPath: string; workspaceRepository: string }) =>
  resolveLinkedRepository(input.repositoryPath, input.workspaceRepository));

ipcMain.handle('prepare-decision', async (_event, input: WorkspaceConnection & { decisionId: string; repositoryPath: string }) => {
  if (input.mode !== 'supabase' && (!hosted || input.url !== hosted.url)) throw new Error('Prepare decision files on the host computer.');
  const response = await workspaceFetch(input, '/state');
  if (!response.ok) throw new Error('Reconnect to the hosted workspace.');
  const state = await response.json() as Snapshot;
  if (state.members.find(member => member.id === state.memberId)?.role !== 'owner') throw new Error('Only the host owner can prepare decision files.');
  const decision = state.decisions.find(item => item.id === input.decisionId);
  if (!decision) throw new Error('Decision not found.');
  return prepareDecisionFile(input.repositoryPath, state.workspace.repository, decision);
});

ipcMain.handle('run-task', async (event, input: WorkspaceConnection & { taskId: string; tool: Tool; repositoryPath: string }) => {
  if (sessions.has(input.taskId)) throw new Error('This task already has a local terminal.');
  const stateResponse = await workspaceFetch(input, '/state');
  if (!stateResponse.ok) throw new Error('Reconnect to the workspace before starting work.');
  const state = await stateResponse.json() as Snapshot;
  const task = state.tasks.find(item => item.id === input.taskId);
  if (!task || task.assigneeId !== state.memberId || !['ready', 'running', 'changes_requested'].includes(task.status)) {
    throw new Error('Only the approved recipient can run a tool for this task.');
  }
  const directory = await prepareWorktree(input.repositoryPath, state.workspace.repository, task.id, join(app.getPath('userData'), 'worktrees'));
  const launch = providerLaunch(input.tool, process.env.CONSOLE_CONNECT_TEST_PROVIDER_VERSION === '1');
  const terminal = (require('node-pty') as typeof import('node-pty')).spawn(launch.file, launch.args, { cwd: directory, cols: 100, rows: 30,
    name: 'xterm-256color', env: process.env as Record<string, string> });
  const session: LocalSession = { terminal, url: input.mode === 'supabase' ? input.projectUrl : input.url,
    token: input.token, hosted: input.mode === 'supabase', shared: false, pending: '', sending: false,
    onShareError: () => { if (!event.sender.isDestroyed()) event.sender.send('terminal-sharing-error', { taskId: task.id }); },
    timer: setInterval(() => { void flushTerminal(task.id, session); }, 200) };
  sessions.set(task.id, session);
  terminal.onData(data => {
    if (!event.sender.isDestroyed()) event.sender.send('terminal-data', { taskId: task.id, data });
    if (session.shared) session.pending = (session.pending + data).slice(-16384);
  });
  terminal.onExit(result => {
    clearInterval(session.timer);
    sessions.delete(task.id);
    if (session.shared) void terminalRequest(session, task.id, 'share', { enabled: false }).catch(() => {});
    if (!event.sender.isDestroyed()) event.sender.send('terminal-exit', { taskId: task.id, exitCode: result.exitCode });
  });
  if (task.status === 'ready') {
    const started = await workspaceFetch(input, '/commands',
      { id: crypto.randomUUID(), type: 'start-task', taskId: task.id, revision: task.revision, tool: input.tool });
    if (!started.ok) { terminal.kill(); sessions.delete(task.id); throw new Error('The task changed before the terminal could start. Refresh it.'); }
  }
  return { directory };
});

ipcMain.handle('set-terminal-sharing', async (_event, input: { taskId: string; enabled: boolean }) => {
  const session = sessions.get(input.taskId);
  if (!session) throw new Error('Start this task on this computer before sharing.');
  await terminalRequest(session, input.taskId, 'share', { enabled: input.enabled });
  session.shared = input.enabled;
  if (!input.enabled) session.pending = '';
});

ipcMain.handle('watch-terminal', async (event, input: { url: string; token: string; taskId: string }) => {
  if (terminalWatches.has(input.taskId)) return;
  const base = new URL(input.url);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Use an HTTP workspace address.');
  const controller = new AbortController();
  const response = await fetch(new URL(`/terminal/${input.taskId}/events`, base), {
    headers: { authorization: `Bearer ${input.token}` }, signal: controller.signal,
  });
  if (!response.ok || !response.body) throw new Error((await response.json() as { error?: string }).error ?? 'Terminal stream unavailable.');
  terminalWatches.set(input.taskId, controller);
  void (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6)) as { taskId: string; data: string };
          if (!event.sender.isDestroyed()) event.sender.send('shared-terminal-data', data);
        }
      }
    } catch { /* A closed stream is shown as a stopped watch. */ }
    finally {
      if (terminalWatches.get(input.taskId) === controller) terminalWatches.delete(input.taskId);
      if (!event.sender.isDestroyed()) event.sender.send('shared-terminal-ended', { taskId: input.taskId });
    }
  })();
});

ipcMain.on('stop-watch-terminal', (_event, input: { taskId: string }) => {
  terminalWatches.get(input.taskId)?.abort();
  terminalWatches.delete(input.taskId);
});
ipcMain.on('terminal-write', (_event, input: { taskId: string; data: string }) => sessions.get(input.taskId)?.terminal.write(input.data));
ipcMain.handle('worktree-changes', (_event, input: { taskId: string }) => {
  if (!/^[0-9a-f-]{36}$/i.test(input.taskId)) throw new Error('Choose a valid task.');
  return worktreeChanges(join(app.getPath('userData'), 'worktrees', input.taskId));
});
// The session's onExit cleans up and tells the renderer.
ipcMain.on('terminal-kill', (_event, input: { taskId: string }) => sessions.get(input.taskId)?.terminal.kill());
ipcMain.on('terminal-resize', (_event, input: { taskId: string; cols: number; rows: number }) => {
  if (input.cols > 0 && input.rows > 0) sessions.get(input.taskId)?.terminal.resize(input.cols, input.rows);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  workspaceWatch?.abort();
  for (const watch of terminalWatches.values()) watch.abort();
  for (const session of sessions.values()) { clearInterval(session.timer); session.terminal.kill(); }
  sessions.clear();
  if (hosted) void hosted.close();
});
