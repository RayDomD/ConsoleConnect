import { loadTheme, selectTheme, themes, type ThemeId } from './themes';
import type { Snapshot, Task } from './coordination';
import { commandSchema } from './coordination/_internal/protocol';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { flushPending, loadPending, savePending } from './offline';
import { hostedAccessToken, hostedRequest, watchHostedWorkspace, type SupabaseConnection } from './supabase-client';

type Result = { status: number; data: any };
type WorkspaceInput = LocalConnection | (SupabaseConnection & { token: string });
declare global {
  interface Window {
    consoleConnect: {
      host(input: { name: string; repository: string; owner: string }): Promise<{ url: string; token: string; shareUrl?: string; localOnly: boolean }>;
      request(input: { url: string; token: string; path: string; body?: unknown }): Promise<Result>;
      watchWorkspace(input: { url: string; token: string }): Promise<void>;
      stopWatchingWorkspace(): void;
      onWorkspaceConnected(callback: () => void): void;
      onWorkspaceRevision(callback: (revision: number) => void): void;
      onWorkspaceConnectionError(callback: (message: string) => void): void;
      chooseRepository(): Promise<string | null>;
      prepareDecision(input: WorkspaceInput & { decisionId: string; repositoryPath: string }): Promise<string>;
      runTask(input: WorkspaceInput & { taskId: string; tool: string; repositoryPath: string }): Promise<{ directory: string }>;
      setTerminalSharing(input: { taskId: string; enabled: boolean }): Promise<void>;
      watchTerminal(input: { url: string; token: string; taskId: string }): Promise<void>;
      stopWatchingTerminal(input: { taskId: string }): void;
      onSharedTerminalData(callback: (event: { taskId: string; data: string }) => void): void;
      onSharedTerminalEnded(callback: (event: { taskId: string }) => void): void;
      onTerminalSharingError(callback: (event: { taskId: string }) => void): void;
      terminalWrite(input: { taskId: string; data: string }): void;
      terminalResize(input: { taskId: string; cols: number; rows: number }): void;
      onTerminalData(callback: (event: { taskId: string; data: string }) => void): void;
      onTerminalExit(callback: (event: { taskId: string; exitCode: number }) => void): void;
    };
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
type LocalConnection = { mode?: 'local'; url: string; token: string; shareUrl?: string; localOnly?: boolean };
let connection: LocalConnection | SupabaseConnection | null = null;
let snapshot: Snapshot | null = null;
let selectedTaskId: string | null = null;
let showWorkspaceChat = false;
let notice = '';
let terminalTaskId: string | null = null;
let terminalOutput = '';
let terminalSessionActive = false;
let watchedTaskId: string | null = null;
let watchedOutput = '';
let terminal: Terminal | null = null;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

async function request(path: string, body?: unknown, target = connection) {
  if (!target) throw new Error('Connect to a workspace first.');
  const result = target.mode === 'supabase'
    ? await hostedRequest({ ...target, path, body })
    : await window.consoleConnect.request({ ...target, path, body });
  if (result.status >= 400) {
    const error = new Error(result.data.error || 'The workspace rejected this update.') as Error & { status: number };
    error.status = result.status;
    throw error;
  }
  return result.data;
}

async function refreshOnce() {
  if (!connection) return;
  const active = connection;
  try {
    let next: Snapshot = await request('/state', undefined, active);
    if (connection !== active) return;
    let changed = false;
    try {
      await flushPending(localStorage, next.workspace.id, next.memberId, async item => {
        await request('/commands', item, active);
        changed = true;
      });
      if (changed) { next = await request('/state', undefined, active); notice = ''; }
    } catch (error) {
      notice = `A saved update could not sync: ${(error as Error).message}`;
      changed = true;
    }
    if (connection !== active) return;
    if (!snapshot || next.revision >= snapshot.revision) {
      const shouldRender = changed || next.revision !== snapshot?.revision || !snapshot;
      snapshot = next;
      if (shouldRender) render();
    } else if (changed) render();
  }
  catch (error) { if (connection === active) { notice = (error as Error).message; render(); } }
}

let refreshPromise: Promise<void> | null = null;
let refreshAgain = false;
function refresh(): Promise<void> {
  if (refreshPromise) { refreshAgain = true; return refreshPromise; }
  refreshPromise = (async () => {
    do {
      refreshAgain = false;
      await refreshOnce();
    } while (refreshAgain);
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

let stopHostedWatch: (() => void) | null = null;
function startWorkspaceWatch() {
  stopHostedWatch?.();
  stopHostedWatch = null;
  window.consoleConnect.stopWatchingWorkspace();
  if (!connection) return;
  const active = connection;
  if (active.mode === 'supabase') {
    void watchHostedWorkspace(active, revision => { if (!snapshot || revision > snapshot.revision) void refresh(); },
      () => { void refresh(); }, message => { notice = message; render(); })
      .then(stop => { if (connection === active) stopHostedWatch = stop; else stop(); })
      .catch(error => { if (connection === active) { notice = (error as Error).message; render(); } });
  } else void window.consoleConnect.watchWorkspace(active).catch(error => { if (connection === active) { notice = (error as Error).message; render(); } });
}

async function command(task: Task | null, fields: object) {
  const payload = commandSchema.parse({ id: crypto.randomUUID(), ...(task ? { taskId: task.id, revision: task.revision } : {}), ...fields });
  const current = snapshot;
  if (!current) throw new Error('Connect to a workspace first.');
  const pending = loadPending(localStorage);
  const earlier = pending.some(item => item.workspaceId === current.workspace.id && item.memberId === current.memberId);
  if (!earlier) {
    try { await request('/commands', payload); await refresh(); return; }
    catch (error) { if ((error as Error & { status?: number }).status) throw error; }
  }
  pending.push({ workspaceId: current.workspace.id, memberId: current.memberId, command: payload });
  savePending(localStorage, pending);
  notice = 'Update saved on this computer. It will sync when the workspace reconnects.';
  render();
}

function taskActions(task: Task) {
  const mine = task.assigneeId === snapshot?.memberId;
  const reviewer = !mine && snapshot?.members.find(member => member.id === snapshot?.memberId)?.role !== 'contributor';
  if (task.status === 'unassigned') return `<div class="actions"><button data-action="claim">Claim task</button><select id="assignee"><option value="">Assign to…</option>${snapshot!.members.map(member => `<option value="${member.id}">${escape(member.name)}</option>`).join('')}</select><button class="secondary" data-action="assign">Assign</button></div>`;
  if (mine && task.status === 'awaiting_approval') return '<button data-action="approve">Approve assignment</button>';
  if (mine && task.status === 'ready') return '<button data-action="start">Launch local tool</button><select id="tool"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="antigravity">Antigravity</option></select>';
  if (mine && (task.status === 'running' || task.status === 'changes_requested')) {
    const draft = task.draftPackage ?? task.package;
    return `<form id="package"><label>Summary<input name="summary" required value="${escape(draft?.summary)}"></label><label>Branch, commit, or document<input name="sourceRef" required value="${escape(draft?.sourceRef ?? `console-connect/${task.id}`)}"></label><label>Pull request URL, if available<input name="pullRequestUrl" type="url" value="${escape(draft?.pullRequestUrl)}"></label><label>Deliverables, one per line<textarea name="deliverables">${escape(draft?.deliverables.join('\n'))}</textarea></label><label>Verification<textarea name="verification">${escape(draft?.verification)}</textarea></label><label>Open questions<textarea name="questions">${escape(draft?.questions)}</textarea></label><div class="actions"><button type="submit">Save draft</button>${task.draftPackage ? '<button type="button" data-action="submit">Submit for review</button>' : ''}</div></form>`;
  }
  if (reviewer && task.status === 'submitted') return '<div class="actions"><button data-action="accept">Accept package</button><button class="secondary" data-action="request-changes">Request changes</button></div>';
  return '';
}

function render() {
  terminal?.dispose();
  terminal = null;
  const theme = loadTheme();
  if (!snapshot) {
    app.innerHTML = `<main class="welcome"><header><span class="eyebrow">CONSOLE CONNECT</span><select id="theme">${themes.map(item => `<option value="${item.id}" ${item.id === theme.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></header><section class="intro"><span class="eyebrow">A SHARED WORKSPACE</span><h1>Good work travels together.</h1><p>Assign work, approve it on your own machine, and hand back a package your team can review.</p></section><div class="setup"><form id="host"><h2>Host a workspace</h2><label>Your name<input name="owner" required></label><label>Workspace name<input name="name" required></label><label>Repository URL<input name="repository" required></label><button type="submit">Start hosting</button></form><form id="join"><h2>Join a workspace</h2><label>Host address<input name="url" placeholder="http://host-ip:24680" required></label><label>Your name<input name="name" required></label><label>Invitation code<input name="code" required></label><button type="submit">Join workspace</button></form></div>${notice ? `<p class="notice">${escape(notice)}</p>` : ''}</main>`;
    document.querySelector('.setup')!.insertAdjacentHTML('beforeend', `<form id="hosted-host"><h2>Host with Supabase</h2><label>Project URL<input name="projectUrl" type="url" required></label><label>Publishable key<input name="publishableKey" required></label><label>Your name<input name="owner" required></label><label>Workspace name<input name="name" required></label><label>Repository URL<input name="repository" required></label><button type="submit">Start hosted workspace</button></form><form id="hosted-join"><h2>Join with Supabase</h2><label>Project URL<input name="projectUrl" type="url" required></label><label>Publishable key<input name="publishableKey" required></label><label>Your name<input name="name" required></label><label>Invitation code<input name="code" required></label><button type="submit">Join hosted workspace</button></form>`);
    return;
  }
  const selected = snapshot.tasks.find(task => task.id === selectedTaskId) ?? snapshot.tasks[0];
  const me = snapshot.members.find(member => member.id === snapshot!.memberId);
  app.innerHTML = `<div class="workspace"><aside><div class="brand">CONSOLE <b>CONNECT</b></div><div class="workspace-name">${escape(snapshot.workspace.name)}<small>${escape(snapshot.workspace.repository)}</small></div><div class="aside-label">TASKS <span>${snapshot.tasks.length}</span></div><div class="task-list">${snapshot.tasks.map(task => `<button class="task-link ${task.id === selected?.id ? 'active' : ''}" data-task="${task.id}"><strong>${escape(task.title)}</strong><small>${escape(task.status.replaceAll('_', ' '))}</small></button>`).join('')}</div><button class="new-task" data-action="new-task">+ New task</button><div class="sidebar-bottom"><span>${escape(me?.name)}</span><small>${escape(me?.role)}</small></div></aside><main class="desk"><header class="topbar"><span class="eyebrow">REVIEW DESK</span><div><select id="theme">${themes.map(item => `<option value="${item.id}" ${item.id === theme.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select><button class="text-button" data-action="disconnect">Disconnect</button></div></header><div class="desk-content">${selected ? `<div class="eyebrow">TASK / ${escape(selected.status.replaceAll('_', ' '))}</div><h1>${escape(selected.title)}</h1><p class="description">${escape(selected.description)}</p><div class="meta"><span>Assigned to ${escape(snapshot.members.find(member => member.id === selected.assigneeId)?.name ?? 'No one')}</span><span>Revision ${selected.revision}</span></div>${selected.package ? `<section class="package-summary"><span class="eyebrow">WORK PACKAGE</span><h2>${escape(selected.package.summary)}</h2><p>${escape(selected.package.deliverables.join(', '))}</p><p><strong>Verification:</strong> ${escape(selected.package.verification)}</p>${selected.package.reviewNote ? `<p><strong>Review:</strong> ${escape(selected.package.reviewNote)}</p>` : ''}</section>` : ''}<section class="action-panel">${taskActions(selected)}</section>` : '<h1>Choose a task to begin.</h1>'}${notice ? `<p class="notice">${escape(notice)}</p>` : ''}</div></main><aside class="right-rail"><span class="eyebrow">TEAM</span>${snapshot.members.map(member => `<div class="member"><span class="avatar">${escape(member.name.slice(0, 1).toUpperCase())}</span><div>${escape(member.name)}<small>${escape(member.role)}</small></div></div>`).join('')}${connection?.shareUrl ? `<p class="rail-note">Host address<br><strong>${escape(connection.shareUrl)}</strong></p>` : ''}<button class="secondary invite" data-action="invite">Invite member</button><p class="rail-note">Updates appear as teammates work. Approval stays with the person assigned.</p></aside></div>`;
  if (connection?.localOnly) {
    const invite = document.querySelector<HTMLButtonElement>('.invite')!;
    invite.disabled = true;
    invite.textContent = 'Connect VPN to invite';
    invite.insertAdjacentHTML('beforebegin', '<p class="rail-note">Hosting on this computer only. Connect a private VPN and restart Console Connect to invite teammates.</p>');
  }
  document.querySelector('.new-task')!.insertAdjacentHTML('afterend', `<button class="chat-link ${showWorkspaceChat ? 'active' : ''}" data-action="workspace-chat">Workspace chat</button>`);
  if (showWorkspaceChat) {
    document.querySelectorAll('.task-link.active').forEach(item => item.classList.remove('active'));
    const messages = snapshot.messages.filter(message => !message.taskId);
    document.querySelector('.desk-content')!.innerHTML = `<span class="eyebrow">WORKSPACE</span><h1>Team conversation</h1><p class="description">Questions and updates for everyone in this workspace.</p><section class="discussion">${messages.map(message => `<div class="message"><strong>${escape(snapshot!.members.find(member => member.id === message.authorId)?.name)}</strong><p>${escape(message.body)}</p></div>`).join('') || '<p>No messages yet.</p>'}<form id="workspace-message"><label>Message<textarea name="body" required></textarea></label><button type="submit">Post message</button></form></section>${notice ? `<p class="notice">${escape(notice)}</p>` : ''}`;
  } else if (selected) {
    if (selected.pendingDecisionIds?.length) {
      const mine = selected.assigneeId === snapshot.memberId;
      document.querySelector('.action-panel')!.insertAdjacentHTML('afterbegin', `<div class="decision-alert"><strong>Decision changed</strong><p>${mine ? 'Review and acknowledge the official update before submitting work.' : 'The task owner must acknowledge this update before review.'}</p>${selected.pendingDecisionIds.map(id => `<div>${escape(snapshot!.decisions.find(item => item.id === id)?.title ?? id)} ${mine ? `<button class="secondary" data-action="ack-decision" data-decision="${id}">Acknowledge</button>` : ''}</div>`).join('')}</div>`);
    }
    if (selected.package) {
      const status = selected.pullRequestStatus;
      document.querySelector('.package-summary')?.insertAdjacentHTML('beforeend', `<p><strong>Source:</strong> ${escape(selected.package.sourceRef)}</p>${selected.package.pullRequestUrl ? `<p><strong>Pull request:</strong> ${escape(selected.package.pullRequestUrl)}</p><p><strong>GitHub status:</strong> ${status ? `${escape(status.state.toLowerCase())}, review ${escape((status.reviewDecision || 'PENDING').toLowerCase().replaceAll('_', ' '))}` : 'Not checked yet'}</p><button class="secondary" data-action="check-pr">Check GitHub status</button>` : ''}`);
    }
    const localTerminal = selected.id === terminalTaskId;
    const sharedTerminal = snapshot.sharedTerminalTaskIds?.includes(selected.id) ?? false;
    if (localTerminal || selected.id === watchedTaskId) {
      const controls = localTerminal && terminalSessionActive && connection?.mode !== 'supabase'
        ? `<button class="secondary" data-action="toggle-terminal-sharing">${sharedTerminal ? 'Stop sharing' : 'Share view only'}</button>`
        : selected.id === watchedTaskId ? '<button class="secondary" data-action="stop-watching">Stop watching</button>' : '';
      document.querySelector('.action-panel')!.insertAdjacentHTML('afterend', `<section class="terminal-panel"><span class="eyebrow">${localTerminal ? 'LOCAL TERMINAL' : 'SHARED TERMINAL · VIEW ONLY'}</span>${controls}<div id="terminal"></div></section>`);
      terminal = new Terminal({ theme: theme.terminal, fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: localTerminal });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(document.querySelector('#terminal')!);
      fit.fit();
      terminal.write(localTerminal ? terminalOutput : watchedOutput);
      if (localTerminal && terminalSessionActive) {
        terminal.onData(data => window.consoleConnect.terminalWrite({ taskId: selected.id, data }));
        window.consoleConnect.terminalResize({ taskId: selected.id, cols: terminal.cols, rows: terminal.rows });
      }
    } else if (sharedTerminal) {
      document.querySelector('.action-panel')!.insertAdjacentHTML('afterend', '<section class="terminal-panel"><span class="eyebrow">SHARED TERMINAL · VIEW ONLY</span><button class="secondary" data-action="watch-terminal">Watch terminal</button></section>');
    }
    const messages = snapshot.messages.filter(message => message.taskId === selected.id);
    document.querySelector('.desk-content')!.insertAdjacentHTML('beforeend', `<section class="discussion"><span class="eyebrow">DISCUSSION</span>${messages.map(message => `<div class="message"><strong>${escape(snapshot!.members.find(member => member.id === message.authorId)?.name)}</strong><p>${escape(message.body)}</p></div>`).join('') || '<p>No messages yet.</p>'}<form id="message"><label>Message<textarea name="body" required></textarea></label><button type="submit">Post message</button></form></section>`);
  }
  if (notice && loadPending(localStorage).some(item => item.workspaceId === snapshot!.workspace.id && item.memberId === snapshot!.memberId)) {
    document.querySelector('.notice')?.insertAdjacentHTML('beforeend', '<button class="secondary" data-action="discard-pending">Discard oldest saved update</button>');
  }
  document.querySelector('.right-rail')!.insertAdjacentHTML('beforeend', `<section class="decisions"><span class="eyebrow">DECISIONS</span>${snapshot.decisions.map(decision => `<div class="decision"><strong>${escape(decision.title)}</strong><small>${escape(decision.status)}</small><p>${escape(decision.body)}</p>${decision.documentCommit ? `<small>Commit ${escape(decision.documentCommit.slice(0, 12))}</small>` : ''}${decision.status === 'proposed' && me?.role !== 'contributor' ? `${me?.role === 'owner' ? `<button class="secondary" data-action="prepare-decision" data-decision="${decision.id}">Prepare Markdown</button>` : ''}<input data-commit-for="${decision.id}" placeholder="Pushed commit SHA"><button class="secondary" data-action="approve-decision" data-decision="${decision.id}">Verify and approve</button>` : ''}</div>`).join('')}<button class="secondary" data-action="propose-decision">Propose decision</button></section>`);
}

app.addEventListener('change', event => {
  const target = event.target as HTMLSelectElement;
  if (target.id === 'theme') { selectTheme(target.value as ThemeId); render(); }
});

app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const value = (key: string) => String(data.get(key) ?? '').trim();
  try {
    if (form.id === 'host') {
      connection = await window.consoleConnect.host({ name: value('name'), repository: value('repository'), owner: value('owner') });
    } else if (form.id === 'hosted-host') {
      const projectUrl = value('projectUrl').replace(/\/$/, '');
      const publishableKey = value('publishableKey');
      const result = await hostedRequest({ projectUrl, publishableKey, path: '/create',
        body: { name: value('name'), repository: value('repository'), owner: value('owner') } });
      if (result.status >= 400) throw new Error(result.data.error);
      connection = { mode: 'supabase', projectUrl, publishableKey, workspaceId: result.data.workspaceId };
    } else if (form.id === 'join') {
      const url = value('url').replace(/\/$/, '');
      const result = await window.consoleConnect.request({ url, token: '', path: '/join', body: { code: value('code'), name: value('name') } });
      if (result.status >= 400) throw new Error(result.data.error);
      connection = { url, token: result.data.token };
    } else if (form.id === 'hosted-join') {
      const projectUrl = value('projectUrl').replace(/\/$/, '');
      const publishableKey = value('publishableKey');
      const result = await hostedRequest({ projectUrl, publishableKey, path: '/join',
        body: { code: value('code'), name: value('name') } });
      if (result.status >= 400) throw new Error(result.data.error);
      connection = { mode: 'supabase', projectUrl, publishableKey, workspaceId: result.data.workspaceId };
    } else if (form.id === 'new-task') {
      await command(null, { type: 'create-task', taskId: crypto.randomUUID(), title: value('title'), description: value('description'), assigneeId: value('assigneeId') || null });
    } else if (form.id === 'package') {
      const task = snapshot!.tasks.find(item => item.id === selectedTaskId) ?? snapshot!.tasks[0];
      if (!task) throw new Error('Choose a task first.');
      await command(task, { type: 'save-package', summary: value('summary'), sourceRef: value('sourceRef'),
        pullRequestUrl: value('pullRequestUrl') || undefined,
        deliverables: value('deliverables').split('\n').map(item => item.trim()).filter(Boolean), verification: value('verification'), questions: value('questions') });
    } else if (form.id === 'message') {
      const task = snapshot!.tasks.find(item => item.id === selectedTaskId) ?? snapshot!.tasks[0];
      if (!task) throw new Error('Choose a task first.');
      await command(null, { type: 'post-message', taskId: task.id, body: value('body') });
    } else if (form.id === 'workspace-message') {
      await command(null, { type: 'post-message', body: value('body') });
    } else if (form.id === 'decision') {
      await command(null, { type: 'propose-decision', decisionId: crypto.randomUUID(), title: value('title'), body: value('body'),
        supersedesId: value('supersedesId') || undefined,
        affectedTaskIds: data.getAll('affectedTaskIds').map(String) });
    }
    if (connection) { localStorage.setItem('console-connect.connection', JSON.stringify(connection)); startWorkspaceWatch(); await refresh(); }
  } catch (error) { notice = (error as Error).message; render(); }
});

app.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.task) {
    if (watchedTaskId && watchedTaskId !== button.dataset.task) { window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId }); watchedTaskId = null; watchedOutput = ''; }
    selectedTaskId = button.dataset.task; showWorkspaceChat = false; render(); return;
  }
  const action = button.dataset.action;
  const task = snapshot?.tasks.find(item => item.id === selectedTaskId) ?? snapshot?.tasks[0];
  try {
    if (action === 'workspace-chat') {
      if (watchedTaskId) { window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId }); watchedTaskId = null; watchedOutput = ''; }
      showWorkspaceChat = true; render(); return;
    }
    if (action === 'disconnect') {
      if (watchedTaskId) window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId });
      watchedTaskId = null; watchedOutput = '';
      stopHostedWatch?.(); stopHostedWatch = null;
      window.consoleConnect.stopWatchingWorkspace();
      connection = null; snapshot = null; localStorage.removeItem('console-connect.connection'); render(); return;
    }
    if (action === 'discard-pending' && snapshot) {
      const pending = loadPending(localStorage);
      const index = pending.findIndex(item => item.workspaceId === snapshot!.workspace.id && item.memberId === snapshot!.memberId);
      if (index >= 0) pending.splice(index, 1);
      savePending(localStorage, pending);
      notice = 'Saved update discarded.';
      render();
      return;
    }
    if (action === 'new-task') { showWorkspaceChat = false; document.querySelector('.desk-content')!.innerHTML = `<h1>New task</h1><form id="new-task"><label>Title<input name="title" required></label><label>Description<textarea name="description"></textarea></label><label>Assign to<select name="assigneeId"><option value="">Unassigned</option>${snapshot!.members.map(member => `<option value="${member.id}">${escape(member.name)}</option>`).join('')}</select></label><button type="submit">Create task</button></form>`; return; }
    if (action === 'propose-decision') {
      document.querySelector('.desk-content')!.innerHTML = `<h1>Propose decision</h1><form id="decision"><label>Title<input name="title" required></label><label>Decision<textarea name="body" required></textarea></label><label>Replaces<select name="supersedesId"><option value="">No previous decision</option>${snapshot!.decisions.filter(item => item.status === 'official').map(item => `<option value="${item.id}">${escape(item.title)}</option>`).join('')}</select></label><fieldset><legend>Affected tasks</legend>${snapshot!.tasks.map(item => `<label><input type="checkbox" name="affectedTaskIds" value="${item.id}">${escape(item.title)}</label>`).join('')}</fieldset><button type="submit">Share proposal</button></form>`;
      return;
    }
    if (action === 'prepare-decision') {
      const repositoryPath = await window.consoleConnect.chooseRepository();
      if (!repositoryPath) return;
      const active = connection!;
      const access = active.mode === 'supabase' ? { ...active, token: await hostedAccessToken(active) } : active;
      const path = await window.consoleConnect.prepareDecision({ ...access, decisionId: button.dataset.decision!, repositoryPath });
      notice = `Prepared ${path}. Commit and push it, then enter the commit SHA to make this decision official.`;
      render();
      return;
    }
    if (action === 'approve-decision') {
      const decisionId = button.dataset.decision!;
      const commitSha = (document.querySelector(`[data-commit-for="${decisionId}"]`) as HTMLInputElement).value.trim();
      await command(null, { type: 'approve-decision', decisionId, commitSha });
      return;
    }
    if (action === 'invite') { const role = 'reviewer'; const result = await request('/invites', { role }); notice = `Invitation code: ${result.code}. Share it with the host address shown here.`; render(); return; }
    if (!task) return;
    if (action === 'toggle-terminal-sharing') {
      await window.consoleConnect.setTerminalSharing({ taskId: task.id, enabled: !snapshot!.sharedTerminalTaskIds?.includes(task.id) });
      await refresh();
      return;
    }
    if (action === 'watch-terminal') {
      if (connection?.mode === 'supabase') throw new Error('Hosted terminal viewing is not available yet.');
      await window.consoleConnect.watchTerminal({ ...connection!, taskId: task.id });
      watchedTaskId = task.id; watchedOutput = '';
      render();
      return;
    }
    if (action === 'stop-watching') {
      window.consoleConnect.stopWatchingTerminal({ taskId: task.id });
      watchedTaskId = null; watchedOutput = '';
      render();
      return;
    }
    if (action === 'ack-decision') await command(task, { type: 'acknowledge-decision', decisionId: button.dataset.decision });
    if (action === 'check-pr') { await request(`/pull-request/${task.id}`); await refresh(); }
    if (action === 'claim') await command(task, { type: 'claim-task' });
    if (action === 'assign') {
      const assigneeId = (document.querySelector('#assignee') as HTMLSelectElement).value;
      if (!assigneeId) throw new Error('Choose a teammate to assign.');
      await command(task, { type: 'assign-task', assigneeId });
    }
    if (action === 'approve') await command(task, { type: 'approve-task' });
    if (action === 'start') {
      const repositoryPath = await window.consoleConnect.chooseRepository();
      if (!repositoryPath) return;
      const tool = (document.querySelector('#tool') as HTMLSelectElement).value;
      terminalTaskId = task.id;
      terminalOutput = '';
      terminalSessionActive = true;
      const active = connection!;
      const access = active.mode === 'supabase' ? { ...active, token: await hostedAccessToken(active) } : active;
      try { await window.consoleConnect.runTask({ ...access, taskId: task.id, tool, repositoryPath }); }
      catch (error) { terminalTaskId = null; terminalSessionActive = false; throw error; }
      await refresh();
    }
    if (action === 'submit') await command(task, { type: 'submit-package' });
    if (action === 'accept') await command(task, { type: 'accept-package' });
    if (action === 'request-changes') { const note = prompt('What needs to change?'); if (note) await command(task, { type: 'request-changes', note }); }
  } catch (error) { notice = (error as Error).message; render(); }
});

try { connection = JSON.parse(localStorage.getItem('console-connect.connection') ?? 'null'); } catch { /* Ignore damaged local preference. */ }
window.consoleConnect.onWorkspaceConnected(() => { void refresh(); });
window.consoleConnect.onWorkspaceRevision(revision => { if (!snapshot || revision > snapshot.revision) void refresh(); });
window.consoleConnect.onWorkspaceConnectionError(message => { notice = message; render(); });
window.consoleConnect.onTerminalData(event => {
  if (event.taskId !== terminalTaskId) return;
  terminalOutput = (terminalOutput + event.data).slice(-100000);
  terminal?.write(event.data);
});
window.consoleConnect.onTerminalExit(event => {
  if (event.taskId !== terminalTaskId) return;
  terminalSessionActive = false;
  const line = `\r\nProcess exited (${event.exitCode}).\r\n`;
  terminalOutput += line;
  terminal?.write(line);
  render();
});
window.consoleConnect.onSharedTerminalData(event => {
  if (event.taskId !== watchedTaskId) return;
  watchedOutput = (watchedOutput + event.data).slice(-100000);
  terminal?.write(event.data);
});
window.consoleConnect.onSharedTerminalEnded(event => {
  if (event.taskId !== watchedTaskId) return;
  watchedTaskId = null;
  watchedOutput = '';
  notice = 'Terminal sharing ended.';
  render();
});
window.consoleConnect.onTerminalSharingError(event => {
  if (event.taskId !== terminalTaskId) return;
  notice = 'Terminal sharing stopped because the workspace connection failed.';
  void refresh();
  render();
});
loadTheme();
render();
if (connection) { startWorkspaceWatch(); void refresh(); }
setInterval(() => { if (connection) void refresh(); }, 15_000);
setInterval(() => {
  const task = snapshot?.tasks.find(item => item.id === selectedTaskId) ?? snapshot?.tasks[0];
  if (connection && task?.package?.pullRequestUrl && ['submitted', 'accepted'].includes(task.status)) {
    void request(`/pull-request/${task.id}`).then(refresh).catch(() => {});
  }
}, 60_000);
