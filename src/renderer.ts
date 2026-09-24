import { loadTheme, selectTheme, themes, type ThemeId } from './themes';
import type { Message, Snapshot, Task } from './coordination';
import { commandSchema } from './coordination/_internal/protocol';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { flushPending, loadPending, savePending } from './offline';
import { hostedAccessToken, hostedProjects, hostedRequest, hostedSignIn, watchHostedWorkspace, type SupabaseConnection } from './supabase-client';
import { invitationLink, parseInvitationLink } from './invitations';
import { captureMotion, dismiss, drawerExit, installPressSound, playMotion, pressSoundEnabled, setPressSound } from './motion';

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
      copyText(value: string): Promise<void>;
      notifyTeamChat(input: { title: string; body: string }): Promise<boolean>;
      onOpenTeamChatNotification(callback: () => void): void;
      openOAuth(input: { projectUrl: string; url: string }): Promise<string>;
      validateRepository(input: { repositoryPath: string; workspaceRepository: string }): Promise<string>;
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
type TaskTab = 'overview' | 'console' | 'package' | 'discussion';
let taskTab: TaskTab = 'overview';
let showWorkspaceChat = false;
let showChatDrawer = false;
let replyingToId: string | null = null;
let editingMessageId: string | null = null;
let editingDraft = '';
let chatDraft = '';
let chatToast: { message: Message; count: number } | null = null;
let observedChatContext = '';
const observedChatMessageIds = new Set<string>();
let pendingDesktopChat: { workspaceId: string; workspaceName: string; count: number; latest: Message; author: string } | null = null;
let desktopChatTimer: ReturnType<typeof setTimeout> | null = null;
let notice = '';
let currentInvitationLink = '';
let invitationStatus = '';
let showInviteForm = false;
let assignMenuOpen = false;
// Decisions whose commit field is showing: prepared this session, or opened with Enter commit.
const commitFieldDecisionIds = new Set<string>();
let terminalTaskId: string | null = null;
let terminalOutput = '';
let terminalSessionActive = false;
let watchedTaskId: string | null = null;
let watchedOutput = '';
let terminal: Terminal | null = null;
let terminalFit: FitAddon | null = null;
let terminalRenderSource: 'local' | 'shared' | null = null;
let terminalRenderedTaskId: string | null = null;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
type View = 'dashboard' | 'review' | 'settings';
type SavedProject = { id: string; name: string; repository: string; localRepositoryPath?: string; connection: LocalConnection | SupabaseConnection };
const projectsKey = 'console-connect.projects';
const supabaseDefaultsKey = 'console-connect.supabase-defaults';
const chatNotificationsKey = 'console-connect.chat-notifications';
const noReadMessage = 'none';
const chatNotificationBatchMs = 1500;
let view: View = 'dashboard';
let settingsReturnView: View = 'dashboard';
let showSetup = false;
let projects: SavedProject[] = [];
let supabaseDefaults = { projectUrl: '', publishableKey: '' };
let chatNotifications = { enabled: true, showPreview: true };

function teamMessages(state = snapshot): Message[] {
  return state?.messages.filter(message => !message.taskId) ?? [];
}

function chatReadKey(state: Snapshot) {
  return `console-connect.chat-read.${state.workspace.id}.${state.memberId}`;
}

function markTeamChatRead(state = snapshot) {
  if (!state) return;
  const last = teamMessages(state).at(-1);
  localStorage.setItem(chatReadKey(state), last?.id ?? noReadMessage);
  chatToast = null;
}

function unreadTeamMessages(state = snapshot) {
  if (!state) return 0;
  const messages = teamMessages(state);
  const lastReadId = localStorage.getItem(chatReadKey(state));
  if (lastReadId === null) return 0;
  const lastReadIndex = messages.findIndex(message => message.id === lastReadId);
  return messages.slice(lastReadIndex + 1).filter(message => message.authorId !== state.memberId && !message.deletedAt).length;
}

function queueDesktopChatNotification(state: Snapshot, incoming: Message[]) {
  const latest = incoming.at(-1)!;
  const author = state.members.find(member => member.id === latest.authorId)?.name ?? 'Teammate';
  if (pendingDesktopChat?.workspaceId === state.workspace.id) {
    pendingDesktopChat.count += incoming.length;
    pendingDesktopChat.latest = latest;
    pendingDesktopChat.author = author;
  } else pendingDesktopChat = { workspaceId: state.workspace.id, workspaceName: state.workspace.name,
    count: incoming.length, latest, author };
  if (desktopChatTimer) return;
  desktopChatTimer = setTimeout(() => {
    desktopChatTimer = null;
    const batch = pendingDesktopChat;
    pendingDesktopChat = null;
    if (!batch || document.hasFocus() || !chatNotifications.enabled || snapshot?.workspace.id !== batch.workspaceId) return;
    const latest = teamMessages().find(message => message.id === batch.latest.id);
    if (!latest || latest.deletedAt) return;
    const title = batch.count === 1 ? `${batch.author} · ${batch.workspaceName}`
      : `${batch.count} new team messages · ${batch.workspaceName}`;
    const body = chatNotifications.showPreview ? latest.body : 'Open Console Connect to read them.';
    void window.consoleConnect.notifyTeamChat({ title, body }).catch(() => {});
  }, chatNotificationBatchMs);
}

function observeTeamMessages(next: Snapshot) {
  const context = `${next.workspace.id}:${next.memberId}`;
  const messages = teamMessages(next);
  if (observedChatContext !== context) {
    observedChatContext = context;
    observedChatMessageIds.clear();
    for (const message of messages) observedChatMessageIds.add(message.id);
    if (localStorage.getItem(chatReadKey(next)) === null) markTeamChatRead(next);
    chatToast = null;
    return;
  }
  const incoming = messages.filter(message => !observedChatMessageIds.has(message.id)
    && message.authorId !== next.memberId && !message.deletedAt);
  for (const message of messages) observedChatMessageIds.add(message.id);
  if (chatToast) {
    const latest = messages.find(message => message.id === chatToast?.message.id);
    if (!latest || latest.deletedAt) chatToast = null;
    else chatToast.message = latest;
  }
  if (!incoming.length) return;
  if (view === 'review' && (showWorkspaceChat || showChatDrawer) && document.hasFocus()) {
    markTeamChatRead(next);
    return;
  }
  chatToast = { message: incoming.at(-1)!, count: (chatToast?.count ?? 0) + incoming.length };
  if (!document.hasFocus() && chatNotifications.enabled) queueDesktopChatNotification(next, incoming);
}

function projectId(target: LocalConnection | SupabaseConnection) {
  return target.mode === 'supabase' ? `supabase:${target.projectUrl}:${target.workspaceId}` : `local:${target.url}`;
}

function rememberProject(target: LocalConnection | SupabaseConnection, state: Snapshot) {
  const previous = projects.find(item => item.id === projectId(target));
  const project = { id: projectId(target), name: state.workspace.name, repository: state.workspace.repository,
    localRepositoryPath: previous?.localRepositoryPath, connection: target };
  projects = [project, ...projects.filter(item => item.id !== project.id)];
  localStorage.setItem(projectsKey, JSON.stringify(projects));
}

async function discoverHostedProjects(projectUrl: string, publishableKey: string) {
  const found = await hostedProjects(projectUrl, publishableKey);
  for (const item of found) {
    const target: SupabaseConnection = { mode: 'supabase', projectUrl, publishableKey, workspaceId: item.id };
    const id = projectId(target);
    const previous = projects.find(project => project.id === id);
    const project: SavedProject = { id, name: item.name, repository: item.repository,
      localRepositoryPath: previous?.localRepositoryPath, connection: target };
    projects = [project, ...projects.filter(saved => saved.id !== id)];
  }
  if (found.length) {
    showSetup = false;
    localStorage.setItem(projectsKey, JSON.stringify(projects));
  }
  return found.length;
}

async function chooseProjectFolder(project: SavedProject) {
  if (!project.repository) throw new Error('Open this project once to load its repository details.');
  const selected = await window.consoleConnect.chooseRepository();
  if (!selected) return null;
  const path = await window.consoleConnect.validateRepository({ repositoryPath: selected, workspaceRepository: project.repository });
  project.localRepositoryPath = path;
  localStorage.setItem(projectsKey, JSON.stringify(projects));
  return path;
}

async function currentProjectFolder() {
  if (!connection || !snapshot) throw new Error('Open a project first.');
  const active = connection;
  const project = projects.find(item => item.id === projectId(active));
  if (!project) throw new Error('This project is no longer saved on this computer.');
  if (project.localRepositoryPath) {
    return window.consoleConnect.validateRepository({ repositoryPath: project.localRepositoryPath, workspaceRepository: snapshot.workspace.repository });
  }
  return chooseProjectFolder(project);
}

function renderDashboard() {
  const projectList = projects.map(project => `<article class="project-row"><div><span class="section-label">${project.connection.mode === 'supabase' ? 'Supabase' : 'Computer host'}</span><h2>${escape(project.name)}</h2><p>${escape(project.repository || 'Open to load repository details')}</p><p class="project-folder">Local Git folder: ${escape(project.localRepositoryPath || 'Choose once to launch consoles without browsing each time')}</p></div><div class="project-actions"><button class="secondary" data-action="choose-project-folder" data-project="${escape(project.id)}">${project.localRepositoryPath ? 'Change folder' : 'Choose folder'}</button><button data-action="open-project" data-project="${escape(project.id)}">Open Review Desk</button></div></article>`).join('');
  app.innerHTML = `<main class="dashboard"><header class="dashboard-header"><div class="brand">CONSOLE <b>CONNECT</b></div><button class="text-button" data-action="settings">Settings</button></header><div class="dashboard-body"><h1>Projects</h1><p class="description">Choose where you want to work, or connect another workspace.</p><div class="project-list">${projectList || '<p class="empty-projects">No projects connected yet. Add one below to begin.</p>'}</div>${projects.length ? `<button class="secondary add-project" data-action="add-project">${showSetup ? 'Hide connection forms' : 'Add or join a project'}</button>` : ''}${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}${showSetup || !projects.length ? `<section class="setup"><form id="join-invitation"><h2>Join from an invitation</h2><p class="description">Paste the link a teammate shared with you. The project details are already inside it.</p><label>Invitation link<input name="link" required placeholder="consoleconnect://invite/..."></label><label>Your name<input name="name" required></label><button type="submit">Join workspace</button></form><form id="host"><h2>Host on this computer</h2><label>Your name<input name="owner" required></label><label>Workspace name<input name="name" required></label><label>Repository URL<input name="repository" required></label><button type="submit">Start workspace</button></form><form id="join"><h2>Join a computer host</h2><label>Host address<input name="url" placeholder="http://host-ip:24680" required></label><label>Your name<input name="name" required></label><label>Invitation code<input name="code" required></label><button type="submit">Join workspace</button></form><form id="hosted-host"><h2>Host with Supabase</h2><label>Project URL<input name="projectUrl" type="url" required value="${escape(supabaseDefaults.projectUrl)}"></label><label>Publishable key<input name="publishableKey" required value="${escape(supabaseDefaults.publishableKey)}"></label><label>Your name<input name="owner" required></label><label>Workspace name<input name="name" required></label><label>Repository URL<input name="repository" required></label><button type="submit">Start hosted workspace</button></form><form id="hosted-join"><h2>Join with Supabase</h2><label>Project URL<input name="projectUrl" type="url" required value="${escape(supabaseDefaults.projectUrl)}"></label><label>Publishable key<input name="publishableKey" required value="${escape(supabaseDefaults.publishableKey)}"></label><label>Your name<input name="name" required></label><label>Invitation code<input name="code" required></label><button type="submit">Join hosted workspace</button></form></section>` : ''}</div></main>`;
  const connectionHelp: Record<string, string[]> = {
    'join-invitation': ['Ask your teammate for a one-time Console Connect invitation link.', 'For a computer-hosted workspace, join the same Radmin VPN network and keep the host computer online.', 'Paste the link here. If it names a GitHub account, sign in with that account before joining.'],
    host: ['Join a private Radmin VPN network before starting the workspace. Console Connect uses its VPN address automatically.', 'Enter your name, a workspace name, and the GitHub repository URL.', 'Once inside, choose Invite member and share the link. Keep this computer and the VPN running.'],
    join: ['Join the host’s Radmin VPN network first.', 'Ask the host for the address shown in Console Connect and a one-time invitation code.', 'Enter both here while the host computer is running.'],
    'hosted-host': ['Get your Supabase project URL and publishable key from the project settings. The key is safe to use in the desktop app.', 'Enter the workspace name and GitHub repository URL, then start the workspace.', 'Invite teammates from the review desk. Supabase handles coordination, so Radmin VPN is not required.'],
    'hosted-join': ['Ask the owner for a Supabase invitation link, or get the project URL, publishable key, and invitation code.', 'Enter those details here. A GitHub-bound invitation requires sign-in with the invited GitHub account.', 'Your local AI tools still run on your own computer.'],
  };
  for (const [id, steps] of Object.entries(connectionHelp)) {
    const heading = document.querySelector<HTMLHeadingElement>(`#${id} h2`);
    heading?.insertAdjacentHTML('afterend', `<button type="button" class="connection-help-button" data-action="connection-help" data-help="${id}" aria-label="How to connect: ${escape(heading.textContent)}" aria-controls="help-${id}" aria-expanded="false" title="How to connect">?</button><div class="connection-help" id="help-${id}" hidden><strong>How to connect</strong><ol>${steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol></div>`);
  }
  document.querySelector('#join-invitation')?.insertAdjacentHTML('beforeend', '<div class="oauth-actions"><button type="button" class="secondary" data-action="sign-in-github">Sign in with GitHub</button><button type="button" class="secondary" data-action="sign-in-google">Sign in with Google</button></div>');
  const setup = document.querySelector('.dashboard .setup');
  if (setup) {
    const advanced = document.createElement('details');
    advanced.className = 'manual-join';
    advanced.innerHTML = '<summary>Join with an address and code instead</summary>';
    setup.append(advanced);
    for (const id of ['join', 'hosted-join']) {
      const form = setup.querySelector(`#${id}`);
      if (form) advanced.append(form);
    }
  }
}

function renderSettings() {
  const theme = loadTheme();
  app.innerHTML = `<main class="settings-page"><header class="dashboard-header"><div class="brand">CONSOLE <b>CONNECT</b></div><button class="text-button" data-action="settings-back">Back</button></header><div class="settings-body"><h1>Settings</h1><section class="settings-section"><h2>Appearance</h2><p class="description">Choose the color theme for this computer.</p><label>Theme<select id="theme">${themes.map(item => `<option value="${item.id}" ${item.id === theme.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label><label class="chat-setting-check"><input id="press-sound" type="checkbox" ${pressSoundEnabled() ? 'checked' : ''}>Play a soft click when pressing buttons</label></section><section class="settings-section"><h2>Supabase connection</h2><p class="description">These defaults fill the forms when you add or join a hosted project. Existing projects keep their own connection.</p><form id="supabase-settings"><label>Project URL<input name="projectUrl" type="url" placeholder="https://your-project.supabase.co" value="${escape(supabaseDefaults.projectUrl)}"></label><label>Publishable key<input name="publishableKey" value="${escape(supabaseDefaults.publishableKey)}"></label><button type="submit">Save connection defaults</button></form></section>${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}</div></main>`;
  document.querySelector('.settings-body')?.insertAdjacentHTML('beforeend', '<section class="settings-section"><h2>Account</h2><p class="description">Connect a GitHub or Google account to keep access to hosted projects across computers. Existing projects stay linked to your current identity.</p><div class="oauth-actions"><button class="secondary" data-action="sign-in-github">Connect GitHub</button><button class="secondary" data-action="sign-in-google">Connect Google</button></div></section>');
  document.querySelector('.settings-body')?.insertAdjacentHTML('beforeend', `<section class="settings-section"><h2>Team chat notifications</h2><p class="description">Unread messages still appear in the app when desktop notifications are muted.</p><label class="chat-setting-check"><input id="chat-notifications-enabled" type="checkbox" ${chatNotifications.enabled ? 'checked' : ''}>Show desktop notifications when the app is in the background</label><label class="chat-setting-check"><input id="chat-notifications-preview" type="checkbox" ${chatNotifications.showPreview ? 'checked' : ''}>Include message text in desktop notifications</label></section>`);
}

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
      observeTeamMessages(next);
      snapshot = next;
      rememberProject(active, next);
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
  if (task.status === 'unassigned') {
    const teammates = snapshot!.members.filter(member => member.id !== snapshot!.memberId);
    const menu = assignMenuOpen ? `<div class="menu" role="menu" aria-label="Teammates">${teammates.map(member => `<button class="menu-item" role="menuitem" data-action="assign" data-member="${escape(member.id)}"><span class="avatar" aria-hidden="true">${escape(member.name.slice(0, 1).toUpperCase())}</span>${escape(member.name)}</button>`).join('')}</div>` : '';
    return `<p class="action-heading">Nobody has this yet</p><div class="actions"><button data-action="claim">Claim task</button>${teammates.length ? `<span class="actions-or">or</span><div class="assign-menu"><button class="secondary" data-action="toggle-assign-menu" aria-haspopup="menu" aria-expanded="${assignMenuOpen}">Assign to teammate${chevronIcon}</button>${menu}</div>` : ''}</div>`;
  }
  if (mine && task.status === 'awaiting_approval') return '<button data-action="approve">Approve assignment</button>';
  if (mine && task.status === 'ready') return '<button data-action="task-tab" data-tab="console">Open console</button>';
  if (mine && (task.status === 'running' || task.status === 'changes_requested')) {
    const draft = task.draftPackage ?? task.package;
    return `<form id="package"><label>Summary<input name="summary" required value="${escape(draft?.summary)}"></label><label>Branch, commit, or document<input name="sourceRef" required value="${escape(draft?.sourceRef ?? `console-connect/${task.id}`)}"></label><label>Pull request URL, if available<input name="pullRequestUrl" type="url" value="${escape(draft?.pullRequestUrl)}"></label><label>Deliverables, one per line<textarea name="deliverables">${escape(draft?.deliverables.join('\n'))}</textarea></label><label>Verification<textarea name="verification">${escape(draft?.verification)}</textarea></label><label>Open questions<textarea name="questions">${escape(draft?.questions)}</textarea></label><div class="actions"><button type="submit">Save draft</button>${task.draftPackage ? '<button type="button" data-action="submit">Submit for review</button>' : ''}</div></form>`;
  }
  if (reviewer && task.status === 'submitted') return '<div class="actions"><button data-action="accept">Accept package</button><button class="secondary" data-action="request-changes">Request changes</button></div>';
  return '';
}

function decisionStep(decisionId: string, owner: boolean) {
  const id = escape(decisionId);
  if (owner && !commitFieldDecisionIds.has(decisionId)) {
    return `<button data-action="prepare-decision" data-decision="${id}">Prepare Markdown</button><small>Next: push it, then paste the commit to approve. <button class="text-button inline-link" data-action="enter-decision-commit" data-decision="${id}">Enter commit</button></small>`;
  }
  return `<label>Pushed commit SHA<input data-commit-for="${id}" autocomplete="off"></label><button data-action="approve-decision" data-decision="${id}">Verify and approve</button>`;
}

function taskBody(task: Task) {
  const assignee = snapshot!.members.find(member => member.id === task.assigneeId);
  const status = task.status.replaceAll('_', ' ');
  const tabs: TaskTab[] = ['overview', 'console', 'package', 'discussion'];
  const packageSummary = task.package ? `<section class="package-summary"><span class="section-label">Work package</span><h2>${escape(task.package.summary)}</h2><p>${escape(task.package.deliverables.join(', '))}</p><p><strong>Verification:</strong> ${escape(task.package.verification)}</p>${task.package.reviewNote ? `<p><strong>Review:</strong> ${escape(task.package.reviewNote)}</p>` : ''}</section>` : '';
  return `<h1>${escape(task.title)}</h1><div class="meta"><span class="status-pill status-pill-${task.status}"><i class="status-dot status-${task.status}" aria-hidden="true"></i>${escape(status.charAt(0).toUpperCase() + status.slice(1))}</span>${assignee ? `<span class="meta-person"><span class="avatar" aria-hidden="true">${escape(assignee.name.slice(0, 1).toUpperCase())}</span>${escape(assignee.name)}</span><span aria-hidden="true">·</span>` : ''}<span>Revision ${task.revision}</span></div><nav class="task-tabs" aria-label="Task sections">${tabs.map(tab => `<button class="task-tab ${taskTab === tab ? 'active' : ''}" data-action="task-tab" data-tab="${tab}" aria-current="${taskTab === tab ? 'page' : 'false'}">${tab.charAt(0).toUpperCase() + tab.slice(1)}</button>`).join('')}</nav><div class="task-tab-content">${taskTab === 'overview' ? `<p class="description">${escape(task.description)}</p>${['unassigned', 'awaiting_approval', 'ready'].includes(task.status) ? `<section class="action-panel">${taskActions(task)}</section>` : ''}` : ''}${taskTab === 'package' ? `${packageSummary}${['running', 'changes_requested', 'submitted'].includes(task.status) ? `<section class="action-panel">${taskActions(task)}</section>` : !task.package ? '<p class="description">No work package yet.</p>' : ''}` : ''}</div>`;
}

const chatGroupWindowMs = 5 * 60 * 1000;

// Consecutive messages from one person on the same day, within five minutes, share one name, time, and avatar.
function continuesGroup(previous: Message | undefined, message: Message | undefined) {
  if (!previous || !message || previous.authorId !== message.authorId) return false;
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap <= chatGroupWindowMs && new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString();
}

function chatMessageMarkup(message: Message, messages: Message[], group: { continued: boolean; last: boolean }) {
  const author = snapshot!.members.find(member => member.id === message.authorId)?.name ?? 'Teammate';
  const mine = message.authorId === snapshot!.memberId;
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.createdAt));
  const parent = messages.find(item => item.id === message.replyToId);
  const parentAuthor = parent ? snapshot!.members.find(member => member.id === parent.authorId)?.name ?? 'Teammate' : '';
  const quote = parent ? `<div class="chat-quote"><strong>${escape(parentAuthor)}</strong><span>${escape(parent.deletedAt ? 'Message unsent' : parent.body.slice(0, 140))}</span></div>` : '';
  const actions = message.deletedAt ? '' : `<div class="chat-message-actions"><button class="text-button" data-action="reply-message" data-message="${escape(message.id)}">Reply</button>${mine ? `<button class="text-button" data-action="edit-message" data-message="${escape(message.id)}">Edit</button><button class="text-button" data-action="unsend-message" data-message="${escape(message.id)}">Unsend</button>` : ''}</div>`;
  const content = editingMessageId === message.id && !message.deletedAt
    ? `<form class="chat-edit" data-message="${escape(message.id)}"><label>Edit message<textarea name="body" required maxlength="8000">${escape(editingDraft)}</textarea></label><div><button type="submit">Save edit</button><button type="button" class="secondary" data-action="cancel-edit">Cancel</button></div></form>`
    : `<div class="chat-bubble ${message.deletedAt ? 'chat-bubble-unsent' : ''}">${quote}${message.deletedAt ? 'Message unsent' : escape(message.body)}${message.editedAt && !message.deletedAt ? '<small>Edited</small>' : ''}</div>`;
  const avatar = mine ? '' : group.last ? `<span class="chat-avatar" aria-hidden="true">${escape(author.slice(0, 1).toUpperCase())}</span>` : '<span class="chat-avatar chat-avatar-spacer" aria-hidden="true"></span>';
  const meta = group.continued ? `<div class="sr-only">${escape(mine ? 'You' : author)} · ${escape(time)}</div>`
    : `<div class="chat-message-meta">${mine ? '<span class="sr-only">You · </span>' : `${escape(author)} · `}${escape(time)}</div>`;
  return `<article class="chat-message ${mine ? 'chat-message-own' : ''} ${group.continued ? 'chat-message-continued' : ''}" data-message-id="${escape(message.id)}">${avatar}<div class="chat-message-main">${meta}${content}${actions}</div></article>`;
}

function chatRoomMarkup(compact = false) {
  const messages = teamMessages();
  let previousDay = '';
  const stream = messages.map((message, index) => {
    const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(message.createdAt));
    const divider = day === previousDay ? '' : `<div class="chat-day">${escape(day)}</div>`;
    previousDay = day;
    return divider + chatMessageMarkup(message, messages,
      { continued: continuesGroup(messages[index - 1], message), last: !continuesGroup(message, messages[index + 1]) });
  }).join('');
  const reply = messages.find(message => message.id === replyingToId && !message.deletedAt);
  const replyAuthor = reply ? snapshot!.members.find(member => member.id === reply.authorId)?.name ?? 'Teammate' : '';
  const replyPreview = reply ? `<div class="chat-reply-preview"><div><strong>Replying to ${escape(replyAuthor)}</strong><span>${escape(reply.body.slice(0, 140))}</span></div><button class="text-button" type="button" data-action="cancel-reply" aria-label="Cancel reply">×</button></div>` : '';
  return `<section class="chat-room ${compact ? 'chat-room-compact' : ''}" aria-label="Team chat"><div class="chat-room-header"><div><h2>Team chat</h2><p>Questions, progress, and quick updates for everyone.</p></div>${compact ? '<button class="text-button" data-action="close-chat-drawer" aria-label="Close team chat">Close</button>' : ''}</div><div class="chat-stream" id="team-chat-stream" role="log" aria-live="polite" aria-relevant="additions">${stream || '<p class="chat-empty">No messages yet. Start the conversation.</p>'}</div><form id="workspace-message" class="chat-composer">${replyPreview}<label for="team-chat-body">Message the team</label><div class="chat-compose-row"><textarea id="team-chat-body" name="body" required maxlength="8000" placeholder="Write an update or ask a question…">${escape(chatDraft)}</textarea><button type="submit">Send</button></div></form></section>`;
}

// Lucide "chevron-down" icon (ISC license).
const chevronIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
// Lucide "plus" icon (ISC license).
const plusIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
// Lucide "settings" icon (ISC license).
const gearIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

const regionScrollSelectors = ['.task-list', '.desk', '.right-rail'];
let renderedDeskKey = '';

function render() {
  const previousChatStream = document.querySelector<HTMLElement>('#team-chat-stream');
  const previousChatScroll = previousChatStream?.scrollTop ?? 0;
  const chatWasAtBottom = !previousChatStream || previousChatStream.scrollHeight - previousChatStream.scrollTop - previousChatStream.clientHeight < 40;
  const chatInputFocused = document.activeElement?.id === 'team-chat-body';
  // The shell is locked to the window, so these regions scroll themselves and innerHTML would reset them.
  const previousRegionScroll = regionScrollSelectors.map(selector => document.querySelector(selector)?.scrollTop ?? 0);
  const motion = captureMotion(app);
  const editInputFocused = Boolean(document.activeElement?.closest('.chat-edit'));
  const renderedTask = snapshot?.tasks.find(task => task.id === selectedTaskId) ?? snapshot?.tasks[0];
  const nextTerminalSource = renderedTask?.id === terminalTaskId ? 'local'
    : renderedTask?.id === watchedTaskId ? 'shared' : null;
  const keepTerminal = Boolean(terminal && view === 'review' && taskTab === 'console' && !showWorkspaceChat
    && renderedTask?.id === terminalRenderedTaskId && nextTerminalSource === terminalRenderSource);
  const terminalHadFocus = keepTerminal && terminal?.element?.contains(document.activeElement);
  if (!keepTerminal) {
    terminal?.dispose();
    terminal = null;
    terminalFit = null;
    terminalRenderSource = null;
    terminalRenderedTaskId = null;
  }
  const theme = loadTheme();
  if (view === 'settings') { renderSettings(); return; }
  if (view === 'dashboard') { renderDashboard(); return; }
  if (!snapshot) {
    app.innerHTML = `<main class="loading-workspace"><button class="text-button" data-action="disconnect">← Projects</button><h1>Opening project…</h1>${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : '<p class="description">Connecting to the workspace.</p>'}</main>`;
    return;
  }
  const selected = snapshot.tasks.find(task => task.id === selectedTaskId) ?? snapshot.tasks[0];
  const me = snapshot.members.find(member => member.id === snapshot!.memberId);
  const unread = unreadTeamMessages();
  app.innerHTML = `<div class="workspace"><aside><div class="brand">CONSOLE <b>CONNECT</b></div><div class="workspace-name">${escape(snapshot.workspace.name)}<small>${escape(snapshot.workspace.repository)}</small></div><div class="aside-label"><span>Tasks</span><button class="icon-button new-task" data-action="new-task" aria-label="New task" title="New task">${plusIcon}</button></div><div class="task-list">${snapshot.tasks.map(task => `<button class="task-link ${task.id === selected?.id ? 'active' : ''}" data-task="${task.id}"><i class="status-dot status-${task.status}" aria-hidden="true"></i><strong>${escape(task.title)}</strong><small>${escape(task.status.replaceAll('_', ' '))}</small></button>`).join('')}</div><div class="sidebar-bottom"><span class="avatar" aria-hidden="true">${escape((me?.name ?? '?').slice(0, 1).toUpperCase())}</span><div class="identity"><span>${escape(me?.name)}</span><small>${escape(me?.role)}</small></div><button class="icon-button settings-button" data-action="settings" aria-label="Settings" title="Settings">${gearIcon}</button></div></aside><main class="desk"><header class="topbar"><nav class="breadcrumb" aria-label="Location"><button class="text-button" data-action="disconnect" title="Back to projects">${escape(snapshot.workspace.name)}</button>${showWorkspaceChat || selected ? `<span aria-hidden="true">/</span><span class="breadcrumb-current" aria-current="page">${escape(showWorkspaceChat ? 'Team chat' : selected!.title)}</span>` : ''}</nav><div></div></header><div class="desk-content">${selected ? taskBody(selected) : '<h1>Choose a task to begin.</h1>'}${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}</div></main><aside class="right-rail">${connection?.shareUrl ? `<div class="host-status"><i class="status-dot status-running" aria-hidden="true"></i><span title="${escape(connection.shareUrl)}">Hosting on this computer</span><button class="text-button" data-action="copy-host-address" data-address="${escape(connection.shareUrl)}">Copy address</button></div>` : ''}<span class="section-label">Team</span>${snapshot.members.map(member => `<div class="member"><span class="avatar">${escape(member.name.slice(0, 1).toUpperCase())}</span><div>${escape(member.name)}<small>${escape(member.role)}</small></div></div>`).join('')}<button class="secondary invite" data-action="invite">Invite member</button>${currentInvitationLink ? `<div class="invitation-link"><label>Invitation link<input readonly value="${escape(currentInvitationLink)}"></label><button class="secondary" data-action="copy-invitation">Copy link</button><small>One-time link, valid for 24 hours. Share it only with the person you want to invite.</small></div>` : ''}<p class="rail-note">Updates appear as teammates work. Approval stays with the person assigned.</p></aside></div>`;
  document.querySelector('.desk-content')?.classList.toggle('console-active', taskTab === 'console' && !showWorkspaceChat);
  document.querySelector('.topbar div')!.innerHTML = `<button class="secondary topbar-chat" data-action="open-chat-drawer">Chat${unread ? `<span class="chat-count">${unread}</span>` : ''}</button><button class="text-button" data-action="disconnect">Projects</button>`;
  if (me?.role !== 'owner') document.querySelector('.invite')?.remove();
  if (showInviteForm && me?.role === 'owner') {
    document.querySelector('.invite')?.insertAdjacentHTML('afterend', `<form id="invite-member" class="invite-form"><label>Workspace role<select name="role"><option value="reviewer">Reviewer</option><option value="contributor">Contributor</option></select></label>${connection?.mode === 'supabase' ? '<label>GitHub username (optional)<input name="githubUsername" autocomplete="off" placeholder="username"></label><label class="invite-check"><input type="checkbox" name="repositoryAccess" disabled>Invite to GitHub repository too</label><small>Private personal repositories give collaborators write access. Choose Contributor to enable this.</small>' : '<small>This link grants workspace access. GitHub repository access is managed separately.</small>'}<button type="submit">Create invitation</button></form>`);
  }
  if (currentInvitationLink && invitationStatus) {
    document.querySelector('.invitation-link')?.insertAdjacentHTML('beforeend', `<small>${escape(invitationStatus)}</small>`);
  }
  if (connection?.localOnly) {
    const invite = document.querySelector<HTMLButtonElement>('.invite')!;
    invite.disabled = true;
    invite.textContent = 'Connect VPN to invite';
    invite.insertAdjacentHTML('beforebegin', '<p class="rail-note">Hosting on this computer only. Connect a private VPN and restart Console Connect to invite teammates.</p>');
  }
  document.querySelector('.task-list')!.insertAdjacentHTML('afterend', `<button class="chat-link ${showWorkspaceChat ? 'active' : ''}" data-action="workspace-chat">Team chat${unread ? `<span class="chat-count">${unread}</span>` : ''}</button>`);
  if (showWorkspaceChat) {
    document.querySelectorAll('.task-link.active').forEach(item => item.classList.remove('active'));
    document.querySelector('.desk-content')!.classList.add('chat-page');
    document.querySelector('.desk-content')!.innerHTML = `${chatRoomMarkup()}${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}`;
  } else if (selected) {
    if (taskTab === 'package' && selected.pendingDecisionIds?.length) {
      const mine = selected.assigneeId === snapshot.memberId;
      document.querySelector('.task-tab-content')!.insertAdjacentHTML('afterbegin', `<div class="decision-alert"><strong>Decision changed</strong><p>${mine ? 'Review and acknowledge the official update before submitting work.' : 'The task owner must acknowledge this update before review.'}</p>${selected.pendingDecisionIds.map(id => `<div>${escape(snapshot!.decisions.find(item => item.id === id)?.title ?? id)} ${mine ? `<button class="secondary" data-action="ack-decision" data-decision="${id}">Acknowledge</button>` : ''}</div>`).join('')}</div>`);
    }
    if (taskTab === 'package' && selected.package) {
      const status = selected.pullRequestStatus;
      document.querySelector('.package-summary')?.insertAdjacentHTML('beforeend', `<p><strong>Source:</strong> ${escape(selected.package.sourceRef)}</p>${selected.package.pullRequestUrl ? `<p><strong>Pull request:</strong> ${escape(selected.package.pullRequestUrl)}</p><p><strong>GitHub status:</strong> ${status ? `${escape(status.state.toLowerCase())}, review ${escape((status.reviewDecision || 'PENDING').toLowerCase().replaceAll('_', ' '))}` : 'Not checked yet'}</p><button class="secondary" data-action="check-pr">Check GitHub status</button>` : ''}`);
    }
    if (taskTab === 'console') {
      const mine = selected.assigneeId === snapshot.memberId;
      const localTerminal = selected.id === terminalTaskId;
      const sharedTerminal = snapshot.sharedTerminalTaskIds?.includes(selected.id) ?? false;
      const watching = selected.id === watchedTaskId;
      const canLaunch = mine && ['ready', 'running', 'changes_requested'].includes(selected.status) && !terminalSessionActive;
      const launch = canLaunch ? `<div class="console-launch"><button data-action="start">${localTerminal ? 'New console' : 'Launch console'}</button><select id="tool" aria-label="Choose tool"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="antigravity">Antigravity</option></select></div>` : '';
      const controls = localTerminal && terminalSessionActive && connection?.mode !== 'supabase'
        ? `<button class="secondary" data-action="toggle-terminal-sharing">${sharedTerminal ? 'Stop sharing' : 'Share view only'}</button>`
        : watching ? '<button class="secondary" data-action="stop-watching">Stop watching</button>'
          : sharedTerminal && !localTerminal && connection?.mode !== 'supabase' ? '<button class="secondary" data-action="watch-terminal">Watch shared console</button>' : '';
      const status = localTerminal ? terminalSessionActive ? 'Running on this computer' : 'Previous session ended' : watching ? 'Shared view only' : 'No console open';
      document.querySelector('.task-tab-content')!.insertAdjacentHTML('beforeend', `<section class="console-workspace"><div class="console-toolbar"><div><strong>Task console</strong><small>${status}</small></div><div class="console-controls">${controls}${launch}</div></div>${localTerminal || watching ? '<div id="terminal" aria-label="Task console output"></div>' : `<div class="console-empty"><p>${sharedTerminal ? 'A teammate is sharing a console. Watch it here, or launch your own if this task is assigned to you.' : 'Launch a signed-in local tool for this task. Its output stays here while you move between task sections.'}</p></div>`}</section>`);
      if (localTerminal || watching) {
        terminalRenderSource = localTerminal ? 'local' : 'shared';
        terminalRenderedTaskId = selected.id;
        const container = document.querySelector<HTMLElement>('#terminal')!;
        if (keepTerminal && terminal?.element) {
          container.append(terminal.element);
          terminal.options.theme = theme.terminal;
          terminal.options.cursorBlink = localTerminal && terminalSessionActive;
          terminalFit?.fit();
          if (terminalHadFocus) terminal.focus();
        } else {
          terminal = new Terminal({ theme: theme.terminal, fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: localTerminal && terminalSessionActive });
          terminalFit = new FitAddon();
          terminal.loadAddon(terminalFit);
          terminal.open(container);
          terminalFit.fit();
          terminal.write(localTerminal ? terminalOutput : watchedOutput);
          if (localTerminal && terminalSessionActive) {
            terminal.onData(data => window.consoleConnect.terminalWrite({ taskId: selected.id, data }));
          }
        }
        if (localTerminal && terminalSessionActive) window.consoleConnect.terminalResize({ taskId: selected.id, cols: terminal.cols, rows: terminal.rows });
      }
    }
    if (taskTab === 'discussion') {
      const messages = snapshot.messages.filter(message => message.taskId === selected.id);
      document.querySelector('.task-tab-content')!.insertAdjacentHTML('beforeend', `<section class="discussion"><span class="section-label">Discussion</span>${messages.map(message => `<div class="message"><strong>${escape(snapshot!.members.find(member => member.id === message.authorId)?.name)}</strong><p>${escape(message.body)}</p></div>`).join('') || '<p>No messages yet.</p>'}<form id="message"><label>Message<textarea name="body" required></textarea></label><button type="submit">Post message</button></form></section>`);
    }
  }
  if (notice && loadPending(localStorage).some(item => item.workspaceId === snapshot!.workspace.id && item.memberId === snapshot!.memberId)) {
    document.querySelector('.notice')?.insertAdjacentHTML('beforeend', '<button class="secondary" data-action="discard-pending">Discard oldest saved update</button>');
  }
  document.querySelector('.right-rail')!.insertAdjacentHTML('beforeend', `<section class="decisions"><div class="section-head"><span class="section-label">Decisions</span><button class="text-button" data-action="propose-decision">+ Propose</button></div>${snapshot.decisions.map(decision => `<div class="decision"><div class="decision-head"><strong>${escape(decision.title)}</strong><span class="decision-status decision-status-${decision.status}">${escape(decision.status.charAt(0).toUpperCase() + decision.status.slice(1))}</span></div><p>${escape(decision.body)}</p>${decision.documentCommit ? `<small>Commit ${escape(decision.documentCommit.slice(0, 12))}</small>` : ''}${decision.status === 'proposed' && me?.role !== 'contributor' ? decisionStep(decision.id, me?.role === 'owner') : ''}</div>`).join('')}</section>`);
  if (showChatDrawer && !showWorkspaceChat) app.insertAdjacentHTML('beforeend', `<aside class="chat-drawer" aria-label="Team chat drawer">${chatRoomMarkup(true)}</aside>`);
  if (chatToast && !showChatDrawer && !showWorkspaceChat) {
    const author = snapshot.members.find(member => member.id === chatToast!.message.authorId)?.name ?? 'Teammate';
    app.insertAdjacentHTML('beforeend', `<div class="chat-toast" role="status"><div><strong>${chatToast.count === 1 ? `${escape(author)} sent a message` : `${chatToast.count} new team messages`}</strong><p>${escape(chatToast.message.body.slice(0, 120))}</p></div><button data-action="open-chat-drawer">Reply</button><button class="text-button" data-action="dismiss-chat-toast" aria-label="Dismiss message preview">×</button></div>`);
  }
  const chatStream = document.querySelector<HTMLElement>('#team-chat-stream');
  if (chatStream) chatStream.scrollTop = chatWasAtBottom ? chatStream.scrollHeight : previousChatScroll;
  const deskKey = `${selected?.id}|${taskTab}|${showWorkspaceChat}`;
  regionScrollSelectors.forEach((selector, index) => {
    const region = document.querySelector(selector);
    if (region && (selector !== '.desk' || deskKey === renderedDeskKey)) region.scrollTop = previousRegionScroll[index] ?? 0;
  });
  renderedDeskKey = deskKey;
  if (chatInputFocused) document.querySelector<HTMLTextAreaElement>('#team-chat-body')?.focus();
  if (editInputFocused) document.querySelector<HTMLTextAreaElement>('.chat-edit textarea')?.focus();
  playMotion(app, motion);
}

installPressSound(app);

app.addEventListener('change', event => {
  const target = event.target as HTMLElement;
  if (target.id === 'theme') { selectTheme((target as HTMLSelectElement).value as ThemeId); render(); }
  if (target.id === 'press-sound') setPressSound((target as HTMLInputElement).checked);
  if (target.id === 'chat-notifications-enabled' || target.id === 'chat-notifications-preview') {
    const checkbox = target as HTMLInputElement;
    if (target.id === 'chat-notifications-enabled') chatNotifications.enabled = checkbox.checked;
    else chatNotifications.showPreview = checkbox.checked;
    localStorage.setItem(chatNotificationsKey, JSON.stringify(chatNotifications));
  }
  if ((target as HTMLSelectElement).name === 'role' && target.closest('#invite-member')) {
    const checkbox = document.querySelector<HTMLInputElement>('#invite-member input[name=repositoryAccess]');
    if (checkbox) { checkbox.disabled = (target as HTMLSelectElement).value !== 'contributor'; if (checkbox.disabled) checkbox.checked = false; }
  }
});

app.addEventListener('input', event => {
  const target = event.target as HTMLTextAreaElement;
  if (target.id === 'team-chat-body') chatDraft = target.value;
  if (target.closest('.chat-edit')) editingDraft = target.value;
});

app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const value = (key: string) => String(data.get(key) ?? '').trim();
  try {
    if (form.id === 'invite-member') {
      const active = connection!;
      const role = value('role');
      const githubUsername = value('githubUsername');
      const repositoryAccess = data.has('repositoryAccess');
      if (repositoryAccess && !githubUsername) throw new Error('Enter a GitHub username to invite to the repository.');
      const result = await request('/invites', active.mode === 'supabase'
        ? { role, githubUsername: githubUsername || undefined, repositoryAccess } : { role });
      currentInvitationLink = active.mode === 'supabase'
        ? invitationLink({ mode: 'supabase', projectUrl: active.projectUrl, publishableKey: active.publishableKey, code: result.code })
        : invitationLink({ mode: 'local', url: active.shareUrl || active.url, code: result.code });
      invitationStatus = result.repositoryInvite === 'pending' ? `GitHub invitation sent to ${result.githubUsername}; they must accept it on GitHub.`
        : result.repositoryInvite === 'already-member' ? `${result.githubUsername} already has repository access.`
          : result.repositoryInvite === 'failed' ? 'Workspace link is ready, but GitHub access could not be granted. Try the GitHub invitation separately.'
            : githubUsername ? `Only the connected @${result.githubUsername} GitHub account can use this workspace link.`
              : 'This link grants workspace access only.';
      showInviteForm = false;
      notice = 'Invitation ready. Copy the link and share it with your teammate.';
      render(); return;
    }
    if (form.id === 'supabase-settings') {
      supabaseDefaults = { projectUrl: value('projectUrl').replace(/\/$/, ''), publishableKey: value('publishableKey') };
      localStorage.setItem(supabaseDefaultsKey, JSON.stringify(supabaseDefaults));
      notice = 'Supabase defaults saved for new project connections.';
      render();
      return;
    }
    if (form.id === 'join-invitation') {
      const invitation = parseInvitationLink(value('link'));
      if (invitation.mode === 'supabase') {
        const result = await hostedRequest({ projectUrl: invitation.projectUrl, publishableKey: invitation.publishableKey,
          path: '/join', body: { code: invitation.code, name: value('name') } });
        if (result.status >= 400) throw new Error(result.data.error);
        connection = { mode: 'supabase', projectUrl: invitation.projectUrl,
          publishableKey: invitation.publishableKey, workspaceId: result.data.workspaceId };
        supabaseDefaults = { projectUrl: invitation.projectUrl, publishableKey: invitation.publishableKey };
        localStorage.setItem(supabaseDefaultsKey, JSON.stringify(supabaseDefaults));
      } else {
        const result = await window.consoleConnect.request({ url: invitation.url, token: '', path: '/join',
          body: { code: invitation.code, name: value('name') } });
        if (result.status >= 400) throw new Error(result.data.error);
        connection = { url: invitation.url, token: result.data.token };
      }
    } else if (form.id === 'host') {
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
      await command(null, { type: 'post-message', body: value('body'), replyToId: replyingToId ?? undefined });
      chatDraft = '';
      replyingToId = null;
      render();
      return;
    } else if (form.classList.contains('chat-edit')) {
      const message = teamMessages().find(item => item.id === form.dataset.message);
      if (!message) throw new Error('This message is no longer available.');
      await command(null, { type: 'edit-message', messageId: message.id, version: message.version ?? 1, body: value('body') });
      editingMessageId = null;
      editingDraft = '';
      render();
      return;
    } else if (form.id === 'decision') {
      await command(null, { type: 'propose-decision', decisionId: crypto.randomUUID(), title: value('title'), body: value('body'),
        supersedesId: value('supersedesId') || undefined,
        affectedTaskIds: data.getAll('affectedTaskIds').map(String) });
    }
    if (connection) {
      view = 'review';
      notice = '';
      showSetup = false;
      localStorage.setItem('console-connect.connection', JSON.stringify(connection));
      startWorkspaceWatch();
      await refresh();
    }
  } catch (error) { notice = (error as Error).message; render(); }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && assignMenuOpen) {
    assignMenuOpen = false; render();
    document.querySelector<HTMLButtonElement>('[data-action=toggle-assign-menu]')?.focus();
  }
});

app.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (assignMenuOpen && !(event.target as HTMLElement).closest('.assign-menu')) { assignMenuOpen = false; render(); }
  if (!button) return;
  if (button.dataset.task) {
    if (watchedTaskId && watchedTaskId !== button.dataset.task) { window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId }); watchedTaskId = null; watchedOutput = ''; }
    if (selectedTaskId !== button.dataset.task) taskTab = 'overview';
    selectedTaskId = button.dataset.task; showWorkspaceChat = false; render(); return;
  }
  const action = button.dataset.action;
  const task = snapshot?.tasks.find(item => item.id === selectedTaskId) ?? snapshot?.tasks[0];
  try {
    if (action === 'settings') { settingsReturnView = view; view = 'settings'; notice = ''; render(); return; }
    if (action === 'settings-back') { view = settingsReturnView; notice = ''; render(); return; }
    if (action === 'add-project') { showSetup = !showSetup; render(); return; }
    if (action === 'open-chat-drawer') {
      showWorkspaceChat = false; showChatDrawer = true; markTeamChatRead(); render();
      document.querySelector<HTMLTextAreaElement>('#team-chat-body')?.focus();
      return;
    }
    if (action === 'close-chat-drawer') {
      await dismiss(document.querySelector('.chat-drawer'), drawerExit);
      showChatDrawer = false; render();
      document.querySelector<HTMLButtonElement>('[data-action=open-chat-drawer]')?.focus();
      return;
    }
    if (action === 'dismiss-chat-toast') { chatToast = null; render(); return; }
    if (action === 'cancel-reply') { replyingToId = null; render(); return; }
    if (action === 'cancel-edit') { editingMessageId = null; editingDraft = ''; render(); return; }
    if (action === 'reply-message' || action === 'edit-message' || action === 'unsend-message') {
      const message = teamMessages().find(item => item.id === button.dataset.message);
      if (!message || message.deletedAt) throw new Error('This message is no longer available.');
      if (action === 'reply-message') {
        replyingToId = message.id; render();
        document.querySelector<HTMLTextAreaElement>('#team-chat-body')?.focus();
      } else if (action === 'edit-message') {
        editingMessageId = message.id; editingDraft = message.body; render();
        document.querySelector<HTMLTextAreaElement>('.chat-edit textarea')?.focus();
      } else if (confirm('Unsend this message for everyone? Replies will still show that a message was here.')) {
        await command(null, { type: 'unsend-message', messageId: message.id, version: message.version ?? 1 });
        if (replyingToId === message.id) replyingToId = null;
        render();
      }
      return;
    }
    if (action === 'connection-help') {
      const panel = document.getElementById(`help-${button.dataset.help}`);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    if (action === 'sign-in-github' || action === 'sign-in-google') {
      const provider = action === 'sign-in-github' ? 'github' : 'google';
      const invitationInput = document.querySelector<HTMLInputElement>('#join-invitation input[name=link]');
      const invitation = invitationInput?.value.trim() ? parseInvitationLink(invitationInput.value) : null;
      if (invitation && invitation.mode !== 'supabase') throw new Error('Account sign-in is available for hosted Supabase invitations.');
      const projectUrl = invitation?.projectUrl ?? (connection?.mode === 'supabase' ? connection.projectUrl : supabaseDefaults.projectUrl);
      const publishableKey = invitation?.publishableKey ?? (connection?.mode === 'supabase' ? connection.publishableKey : supabaseDefaults.publishableKey);
      if (!projectUrl || !publishableKey) throw new Error('Paste a hosted invitation link or save the Supabase connection in Settings first.');
      const name = await hostedSignIn(projectUrl, publishableKey, provider,
        url => window.consoleConnect.openOAuth({ projectUrl, url }));
      supabaseDefaults = { projectUrl, publishableKey };
      localStorage.setItem(supabaseDefaultsKey, JSON.stringify(supabaseDefaults));
      const restored = await discoverHostedProjects(projectUrl, publishableKey);
      const nameInput = document.querySelector<HTMLInputElement>('#join-invitation input[name=name]');
      if (nameInput && !nameInput.value.trim()) nameInput.value = name;
      notice = `Connected ${provider === 'github' ? 'GitHub' : 'Google'} account as ${name}. ${restored ? `Restored ${restored} project${restored === 1 ? '' : 's'}.` : ''}`;
      if (!nameInput) render();
      else nameInput.insertAdjacentHTML('afterend', `<small>${escape(notice)}</small>`);
      return;
    }
    if (action === 'choose-project-folder') {
      const project = projects.find(item => item.id === button.dataset.project);
      if (!project) throw new Error('This project is no longer saved on this computer.');
      const path = await chooseProjectFolder(project);
      if (path) { notice = `Saved ${path} for ${project.name} on this computer.`; render(); }
      return;
    }
    if (action === 'open-project') {
      const project = projects.find(item => item.id === button.dataset.project);
      if (!project) throw new Error('This project is no longer saved on this computer.');
      connection = project.connection;
      currentInvitationLink = '';
      snapshot = null;
      selectedTaskId = null;
      showWorkspaceChat = false; showChatDrawer = false;
      view = 'review';
      notice = '';
      localStorage.setItem('console-connect.connection', JSON.stringify(connection));
      render();
      startWorkspaceWatch();
      await refresh();
      return;
    }
    if (action === 'workspace-chat') {
      if (watchedTaskId) { window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId }); watchedTaskId = null; watchedOutput = ''; }
      showWorkspaceChat = true; showChatDrawer = false; markTeamChatRead(); render(); return;
    }
    if (action === 'task-tab') { taskTab = button.dataset.tab as TaskTab; render(); return; }
    if (action === 'disconnect') {
      if (watchedTaskId) window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId });
      watchedTaskId = null; watchedOutput = '';
      stopHostedWatch?.(); stopHostedWatch = null;
      window.consoleConnect.stopWatchingWorkspace();
      connection = null; snapshot = null; view = 'dashboard'; notice = ''; currentInvitationLink = '';
      showChatDrawer = false; showWorkspaceChat = false; chatToast = null;
      localStorage.removeItem('console-connect.connection'); render(); return;
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
      const repositoryPath = await currentProjectFolder();
      if (!repositoryPath) return;
      const active = connection!;
      const access = active.mode === 'supabase' ? { ...active, token: await hostedAccessToken(active) } : active;
      const path = await window.consoleConnect.prepareDecision({ ...access, decisionId: button.dataset.decision!, repositoryPath });
      commitFieldDecisionIds.add(button.dataset.decision!);
      notice = `Prepared ${path}. Commit and push it, then enter the commit SHA to make this decision official.`;
      render();
      return;
    }
    if (action === 'enter-decision-commit') {
      commitFieldDecisionIds.add(button.dataset.decision!); render();
      document.querySelector<HTMLInputElement>(`[data-commit-for="${button.dataset.decision}"]`)?.focus();
      return;
    }
    if (action === 'copy-host-address') { await window.consoleConnect.copyText(button.dataset.address!); notice = 'Host address copied.'; render(); return; }
    if (action === 'approve-decision') {
      const decisionId = button.dataset.decision!;
      const commitSha = (document.querySelector(`[data-commit-for="${decisionId}"]`) as HTMLInputElement).value.trim();
      await command(null, { type: 'approve-decision', decisionId, commitSha });
      return;
    }
    if (action === 'invite') {
      showInviteForm = !showInviteForm;
      render(); return;
    }
    if (action === 'copy-invitation') { await window.consoleConnect.copyText(currentInvitationLink); notice = 'Invitation link copied.'; render(); return; }
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
    if (action === 'toggle-assign-menu') {
      assignMenuOpen = !assignMenuOpen; render();
      document.querySelector<HTMLButtonElement>(assignMenuOpen ? '.menu-item' : '[data-action=toggle-assign-menu]')?.focus();
      return;
    }
    if (action === 'assign') {
      assignMenuOpen = false;
      await command(task, { type: 'assign-task', assigneeId: button.dataset.member });
    }
    if (action === 'approve') await command(task, { type: 'approve-task' });
    if (action === 'start') {
      const repositoryPath = await currentProjectFolder();
      if (!repositoryPath) return;
      const tool = (document.querySelector('#tool') as HTMLSelectElement).value;
      taskTab = 'console';
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

try {
  const stored = JSON.parse(localStorage.getItem(projectsKey) ?? '[]');
  if (Array.isArray(stored)) projects = stored.filter(item => item?.id && item?.connection);
} catch { /* Ignore damaged project history. */ }
try {
  const saved = JSON.parse(localStorage.getItem(supabaseDefaultsKey) ?? 'null');
  if (saved && typeof saved.projectUrl === 'string' && typeof saved.publishableKey === 'string') supabaseDefaults = saved;
} catch { /* Ignore damaged connection defaults. */ }
try {
  const saved = JSON.parse(localStorage.getItem(chatNotificationsKey) ?? 'null');
  if (saved && typeof saved.enabled === 'boolean' && typeof saved.showPreview === 'boolean') chatNotifications = saved;
} catch { /* Ignore damaged notification preferences. */ }
try {
  const previous = JSON.parse(localStorage.getItem('console-connect.connection') ?? 'null') as LocalConnection | SupabaseConnection | null;
  if (previous && !projects.some(item => item.id === projectId(previous))) {
    projects.unshift({ id: projectId(previous), name: 'Previous workspace', repository: '', connection: previous });
    localStorage.setItem(projectsKey, JSON.stringify(projects));
  }
  if (previous?.mode === 'supabase' && !supabaseDefaults.projectUrl) {
    supabaseDefaults = { projectUrl: previous.projectUrl, publishableKey: previous.publishableKey };
  }
} catch { /* Ignore damaged previous connection. */ }
showSetup = projects.length === 0;
window.consoleConnect.onWorkspaceConnected(() => { void refresh(); });
window.consoleConnect.onWorkspaceRevision(revision => { if (!snapshot || revision > snapshot.revision) void refresh(); });
window.consoleConnect.onWorkspaceConnectionError(message => { notice = message; render(); });
window.consoleConnect.onOpenTeamChatNotification(() => {
  if (!snapshot || view !== 'review') return;
  showWorkspaceChat = false; showChatDrawer = true; markTeamChatRead(); render();
});
window.addEventListener('focus', () => {
  if (snapshot && view === 'review' && (showWorkspaceChat || showChatDrawer)) { markTeamChatRead(); render(); }
});
window.consoleConnect.onTerminalData(event => {
  if (event.taskId !== terminalTaskId) return;
  terminalOutput = (terminalOutput + event.data).slice(-100000);
  if (terminalRenderSource === 'local') terminal?.write(event.data);
});
window.consoleConnect.onTerminalExit(event => {
  if (event.taskId !== terminalTaskId) return;
  terminalSessionActive = false;
  const line = `\r\nProcess exited (${event.exitCode}).\r\n`;
  terminalOutput += line;
  if (terminalRenderSource === 'local') terminal?.write(line);
  render();
});
window.consoleConnect.onSharedTerminalData(event => {
  if (event.taskId !== watchedTaskId) return;
  watchedOutput = (watchedOutput + event.data).slice(-100000);
  if (terminalRenderSource === 'shared') terminal?.write(event.data);
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
if (supabaseDefaults.projectUrl && supabaseDefaults.publishableKey) {
  void discoverHostedProjects(supabaseDefaults.projectUrl, supabaseDefaults.publishableKey)
    .then(count => { if (count && view === 'dashboard') render(); }).catch(() => {});
}
setInterval(() => { if (connection) void refresh(); }, 15_000);
setInterval(() => {
  const task = snapshot?.tasks.find(item => item.id === selectedTaskId) ?? snapshot?.tasks[0];
  if (connection && task?.package?.pullRequestUrl && ['submitted', 'accepted'].includes(task.status)) {
    void request(`/pull-request/${task.id}`).then(refresh).catch(() => {});
  }
}, 60_000);
