import { loadTheme, selectTheme, themes, type ThemeId } from './themes';
import type { Message, Snapshot, Task, WorkPackage } from './coordination';
import { commandSchema, toolSchema, type AssigningRule } from './coordination/_internal/protocol';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { flushPending, loadPending, savePending } from './offline';
import { hostedAccessToken, hostedProjects, hostedRequest, hostedSignIn, watchHostedWorkspace, type SupabaseConnection } from './supabase-client';
import { invitationLink, parseInvitationLink } from './invitations';
import { repositoryIdentity } from './repository';
import { openPalette, paletteOpen, type PaletteItem } from './palette';
import { consoleReadiness, needsInput } from './console-state';
import { defaultAutoSettings, detectEvents, detectWorkerEvents, eventLine, planAutoRun, runCliCommand, taskBrief, workerLine, type AutoSettings, type AutoUsage, type OrchestratorEvent, type PackageDraft, type ReviewProposal, type WorkerEvent, type WorkspaceApi } from './orchestrator';
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
      runOrchestrator(input: { repositoryPath: string; workspaceRepository: string; tool: string }): Promise<{ directory: string }>;
      setTerminalSharing(input: { taskId: string; enabled: boolean }): Promise<void>;
      watchTerminal(input: { url: string; token: string; taskId: string }): Promise<void>;
      stopWatchingTerminal(input: { taskId: string }): void;
      onSharedTerminalData(callback: (event: { taskId: string; data: string }) => void): void;
      onSharedTerminalEnded(callback: (event: { taskId: string }) => void): void;
      onTerminalSharingError(callback: (event: { taskId: string }) => void): void;
      terminalWrite(input: { taskId: string; data: string }): void;
      terminalResize(input: { taskId: string; cols: number; rows: number }): void;
      terminalKill(input: { taskId: string }): void;
      worktreeChanges(input: { taskId: string }): Promise<Array<{ path: string; added: number | null; removed: number | null }>>;
      worktreeFacts(input: { taskId: string }): Promise<{ branch: string; commit: string; files: Array<{ path: string; added: number | null; removed: number | null }>; pullRequestUrl?: string }>;
      cliFolder(): Promise<string>;
      onCliRequest(callback: (request: { id: string; argv: string[]; cwd: string; tool?: string; console?: string; taskId: string | null }) => void): void;
      replyToCli(value: { id: string; reply: { ok: true; text: string; data: unknown } | { ok: false; error: string } }): void;
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
// Set before a keyboard-driven selection so the next render skips the glide.
let keyboardMove = false;
// Focus mode (F) on the console tab: sidebar as dots, title in the top bar, the well edge to edge.
let consoleFocus = false;
let decliningTaskId: string | null = null;
// The package card edits only the words; Git facts come from the worktree (orchestrator ADR Q7).
let packageEditing: { taskId: string; sourceRef: string; deliverables: string[]; pullRequestUrl?: string } | null = null;
let manualPackageTaskId: string | null = null;
// The orchestrator console (orchestrator ADR Q5): one per app, in the linked main folder, with its own terminal.
const orchestratorKey = 'orchestrator';
let showOrchestrator = false;
type OrchestratorSession = { tool: string; workspaceId: string; directory: string; startedAt: number; endedAt: number; active: boolean; output: string; lastOutputAt: number };
let orchestrator = null as OrchestratorSession | null;
let orchestratorTerminal: Terminal | null = null;
let orchestratorFit: FitAddon | null = null;
const cliActivity: Array<{ at: number; text: string; tool?: string }> = [];
const cliActivityLimit = 8;
// Updates for the orchestrator (orchestrator ADR Q8): typed into its console once it is ready, never sent.
// Anything that arrives before the person presses Enter waits and joins the next line.
let orchestratorEvents: OrchestratorEvent[] = [];
const orchestratorEventLimit = 20;
let orchestratorTypedAt = 0;
let orchestratorLastInputAt = 0;

function queueOrchestratorEvents(events: OrchestratorEvent[]) {
  if (!events.length) return;
  orchestratorEvents = [...orchestratorEvents, ...events].slice(-orchestratorEventLimit);
}

// Automatic handling (orchestrator ADR Q9): settings and today's count live on this computer; Pause lasts until restart.
const autoSettingsKey = 'console-connect.orchestrator-auto';
const autoUsageKey = 'console-connect.orchestrator-auto-usage';
let autoPaused = false;
let autoRunStartedAt = 0;
let heldAssignments: Array<{ id: string; argv: string[]; summary: string }> = [];
const today = () => new Date().toISOString().slice(0, 10);

function loadAutoSettings(): AutoSettings {
  try { return { ...defaultAutoSettings, ...JSON.parse(localStorage.getItem(autoSettingsKey) ?? '{}') }; } catch { return defaultAutoSettings; }
}
function loadAutoUsage(): AutoUsage {
  try { const usage = JSON.parse(localStorage.getItem(autoUsageKey) ?? 'null') as AutoUsage | null; return usage?.date === today() ? usage : { date: today(), count: 0 }; }
  catch { return { date: today(), count: 0 }; }
}

function orchestratorReadiness() {
  return orchestrator ? consoleReadiness({ tool: orchestrator.tool, output: orchestrator.output, lastOutputAt: orchestrator.lastOutputAt, now: Date.now() }) : 'working';
}

// An automatic run lasts from its Enter until the tool has answered and is ready again.
function autoRunActive() {
  if (!autoRunStartedAt || !orchestrator?.active) return false;
  if (orchestrator.lastOutputAt > autoRunStartedAt && orchestratorReadiness() === 'ready') { autoRunStartedAt = 0; render(); return false; }
  return true;
}

// The opener is typed once the orchestrator console is first ready (orchestrator ADR Q12), and waits for Enter.
let orchestratorOpenerPending = false;

function typeOrchestratorOpener() {
  if (!orchestratorOpenerPending || !orchestrator?.active || orchestratorReadiness() !== 'ready') return;
  orchestratorOpenerPending = false;
  const me = snapshot?.members.find(member => member.id === snapshot?.memberId)?.name ?? 'your';
  window.consoleConnect.terminalWrite({ taskId: orchestratorKey,
    data: `You are ${me}'s orchestrator for ${snapshot?.workspace.name ?? 'this project'}. Run console-connect brief to see the team, the rules, and open tasks, then wait for instructions.` });
  orchestratorTypedAt = Date.now();
}

function typeOrchestratorEvents() {
  if (!orchestrator?.active || !orchestratorEvents.length || orchestrator.workspaceId !== snapshot?.workspace.id) return;
  if (autoRunActive() || orchestratorTypedAt > orchestratorLastInputAt || orchestratorReadiness() !== 'ready') return;
  const plan = planAutoRun(orchestratorEvents, loadAutoSettings(), loadAutoUsage(), autoPaused, today());
  if (plan.auto.length) {
    window.consoleConnect.terminalWrite({ taskId: orchestratorKey, data: `${eventLine(plan.auto)}\r` });
    const usage = loadAutoUsage();
    localStorage.setItem(autoUsageKey, JSON.stringify({ date: today(), count: usage.count + 1 }));
    autoRunStartedAt = Date.now();
    orchestratorEvents = plan.ask;
    cliActivity.unshift({ at: Date.now(), text: `Auto: ${eventLine(plan.auto).slice(0, 120)}`, tool: orchestrator.tool });
    cliActivity.length = Math.min(cliActivity.length, cliActivityLimit);
  } else {
    window.consoleConnect.terminalWrite({ taskId: orchestratorKey, data: eventLine(plan.ask) });
    orchestratorEvents = [];
    orchestratorTypedAt = Date.now();
  }
  render();
}

// Worker side (orchestrator ADR Q10): replies and change requests on this person's running task are typed
// into its console. Replies may be sent automatically if the worker chose that; change requests always wait.
let workerEvents: WorkerEvent[] = [];
let workerTypedAt = 0;

function typeWorkerEvents() {
  if (!terminalTaskId || !terminalSessionActive || !workerEvents.length || briefPendingTaskId === terminalTaskId) return;
  if (workerTypedAt > terminalLastInputAt || localReadiness() !== 'ready') return;
  const autoReplies = loadAutoSettings().workerReplies === 'auto' && workerEvents.every(event => event.kind === 'reply');
  window.consoleConnect.terminalWrite({ taskId: terminalTaskId, data: workerLine(workerEvents) + (autoReplies ? '\r' : '') });
  workerEvents = [];
  workerTypedAt = autoReplies ? 0 : Date.now();
}

// Worker side of stalls: after this long waiting on its owner, the session is reported so the orchestrator hears.
const stallAfterMs = 120_000;
let waitingSince = 0;
let stallReported = false;

function reportSessionState() {
  const task = snapshot?.tasks.find(item => item.id === terminalTaskId);
  if (!task || !terminalSessionActive || !['running', 'changes_requested'].includes(task.status)) return;
  const report = (state: 'needs_input' | 'working') => void command(null, { type: 'report-session', taskId: task.id, state, ...(terminalTool ? { via: terminalTool } : {}) }).catch(() => {});
  if (localSessionNeedsInput()) {
    waitingSince ||= Date.now();
    if (!stallReported && Date.now() - waitingSince >= stallAfterMs) { stallReported = true; report('needs_input'); }
  } else {
    waitingSince = 0;
    if (stallReported && localReadiness() === 'working') { stallReported = false; report('working'); }
  }
}
// Reads are logged as what was read; changes log the app's own confirmation line.
function activityLabel(argv: string[], text: string) {
  const reads: Record<string, string> = { 'brief': 'Read the brief', 'task list': 'Listed open tasks', 'task show': 'Read a task', 'package show': 'Read a work package' };
  return reads[argv.slice(0, 2).join(' ')] ?? reads[argv[0] ?? ''] ?? text.split('\n')[0]!.slice(0, 140);
}
let cliFolderPath = '';
void window.consoleConnect.cliFolder().then(path => { cliFolderPath = path; if (view === 'settings') render(); });
let requestingChangesTaskId: string | null = null;
// Reviews a tool proposed through console-connect; each waits for the person's click (orchestrator ADR Q4).
let reviewProposals: ReviewProposal[] = [];
let editingProposal = false;
let shownProposalId = '';
// Decisions whose commit field is showing: prepared this session, or opened with Enter commit.
const commitFieldDecisionIds = new Set<string>();
let terminalTaskId: string | null = null;
let terminalOutput = '';
let terminalSessionActive = false;
let terminalTool = '';
let terminalStartedAt = 0;
let terminalEndedAt = 0;
let terminalDirectory = '';
let terminalLastOutputAt = 0;
let terminalNeedsInput = false;
let terminalLastInputAt = 0;
// The task brief waits here until the tool is first ready, then is typed in without Enter (orchestrator ADR Q6).
let briefPendingTaskId: string | null = null;
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

// Live counts for the Projects page, read from each project's own state when it answers.
// A project that can't be reached shows no counts rather than stale ones.
type ProjectSummary = { running: number; review: number; unread: number };
const projectSummaries = new Map<string, ProjectSummary>();
const projectSummaryMaxAgeMs = 30_000;
const projectSummaryTimeoutMs = 4_000;
let projectSummariesLoadedAt = 0;
let projectSummariesLoading = false;
const projectOpenedKey = (projectId: string) => `console-connect.project-opened.${projectId}`;

function relativeTime(timestamp: number) {
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  if (Math.abs(minutes) < 60 * 24) return format.format(Math.round(minutes / 60), 'hour');
  return format.format(Math.round(minutes / (60 * 24)), 'day');
}

function summarize(state: Snapshot): ProjectSummary {
  const me = state.members.find(member => member.id === state.memberId);
  return {
    running: state.tasks.filter(task => task.status === 'running').length,
    review: me?.role === 'contributor' ? 0 : state.tasks.filter(task => task.status === 'submitted' && task.assigneeId !== state.memberId).length,
    unread: unreadTeamMessages(state),
  };
}

function loadProjectSummaries() {
  if (projectSummariesLoading || Date.now() - projectSummariesLoadedAt < projectSummaryMaxAgeMs) return;
  projectSummariesLoading = true;
  void Promise.all(projects.map(async project => {
    try {
      const state = await Promise.race([request('/state', undefined, project.connection) as Promise<Snapshot>,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Timed out.')), projectSummaryTimeoutMs))]);
      projectSummaries.set(project.id, summarize(state));
    } catch { projectSummaries.delete(project.id); }
  })).finally(() => {
    projectSummariesLoading = false;
    projectSummariesLoadedAt = Date.now();
    if (view === 'dashboard') render();
  });
}

function renderDashboard() {
  loadProjectSummaries();
  const projectList = projects.map(project => {
    const identity = repositoryIdentity(project.repository);
    const host = project.connection.mode === 'supabase' ? 'Hosted on Supabase' : project.connection.shareUrl ? 'Hosted on this computer' : 'Hosted by a teammate';
    const opened = Number(localStorage.getItem(projectOpenedKey(project.id)));
    const meta = [identity ? identity.split('/').slice(1).join('/') : project.repository || 'Open to load repository details', host, opened ? `Opened ${relativeTime(opened)}` : ''].filter(Boolean);
    const summary = projectSummaries.get(project.id);
    const counts = summary ? [summary.running ? `<span><i class="status-dot status-running" aria-hidden="true"></i>${summary.running} running</span>` : '',
      summary.review ? `<span><i class="status-dot status-submitted" aria-hidden="true"></i>${summary.review} ${summary.review === 1 ? 'needs' : 'need'} your review</span>` : '',
      summary.unread ? `<span>${summary.unread} unread in chat</span>` : ''].filter(Boolean) : [];
    const countLine = summary ? `<div class="project-counts">${counts.length ? counts.join('') : '<span class="project-quiet">Nothing needs you</span>'}</div>` : '';
    const folder = project.localRepositoryPath
      ? `Local folder: ${escape(project.localRepositoryPath)}. <button class="text-button inline-link" data-action="choose-project-folder" data-project="${escape(project.id)}">Change</button>`
      : `No local folder yet. <button class="text-button inline-link" data-action="choose-project-folder" data-project="${escape(project.id)}">Choose folder</button>`;
    return `<article class="project-row"><div class="project-head"><h2>${escape(project.name)}</h2><button data-action="open-project" data-project="${escape(project.id)}">Open</button></div><p>${meta.map(escape).join(' · ')}</p>${countLine}<p class="project-folder">${folder}</p></article>`;
  }).join('');
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
  document.querySelector('.settings-body')?.insertAdjacentHTML('beforeend', `<section class="settings-section"><h2>Orchestrator</h2><p>How your orchestrator console hears about team updates. They are typed in for you to send, unless you let it handle some automatically. Automatic runs use your AI tool's usage, and approvals still wait for your click.</p>${autoSettingsMarkup()}</section><section class="settings-section"><h2>Command line</h2><p>Use <code>console-connect</code> from any terminal or AI tool while this app is open. Consoles inside the app already have it. For other terminals, add this folder to your PATH.</p><div class="cli-folder"><input readonly aria-label="console-connect folder" value="${escape(cliFolderPath)}"><button class="secondary" data-action="copy-cli-folder">Copy folder</button></div></section><section class="settings-section"><h2>Team chat notifications</h2><p class="description">Unread messages still appear in the app when desktop notifications are muted.</p><label class="chat-setting-check"><input id="chat-notifications-enabled" type="checkbox" ${chatNotifications.enabled ? 'checked' : ''}>Show desktop notifications when the app is in the background</label><label class="chat-setting-check"><input id="chat-notifications-preview" type="checkbox" ${chatNotifications.showPreview ? 'checked' : ''}>Include message text in desktop notifications</label></section>`);
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
      const previous = snapshot?.workspace.id === next.workspace.id && snapshot.memberId === next.memberId ? snapshot : null;
      queueOrchestratorEvents(detectEvents(previous, next));
      // Decision changes wait for acknowledgement in the app (banner under the console), so only the rest is queued.
      if (terminalTaskId && terminalSessionActive) workerEvents.push(...detectWorkerEvents(previous, next, terminalTaskId).filter(event => event.kind !== 'decision'));
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
    // The team's assigning rule decides whether this person may hand work to someone else.
    const teammates = canAssign() ? snapshot!.members.filter(member => member.id !== snapshot!.memberId) : [];
    const menu = assignMenuOpen ? `<div class="menu" role="menu" aria-label="Teammates">${teammates.map(member => `<button class="menu-item" role="menuitem" data-action="assign" data-member="${escape(member.id)}"><span class="avatar" aria-hidden="true">${escape(member.name.slice(0, 1).toUpperCase())}</span>${escape(member.name)}</button>`).join('')}</div>` : '';
    return `<p class="action-heading">Nobody has this yet</p><div class="actions"><button data-action="claim">Claim task</button>${teammates.length ? `<span class="actions-or">or</span><div class="assign-menu"><button class="secondary" data-action="toggle-assign-menu" aria-haspopup="menu" aria-expanded="${assignMenuOpen}">Assign to teammate${chevronIcon}</button>${menu}</div>` : ''}</div>${canAssign() ? '' : '<p class="action-hint">Your team lets leads assign work. Suggest an assignee in the discussion.</p>'}`;
  }
  if (mine && (task.status === 'awaiting_approval' || task.status === 'ready')) {
    const primary = task.status === 'ready' ? '<button data-action="task-tab" data-tab="console">Open console</button>' : '<button data-action="approve">Approve assignment</button>';
    if (decliningTaskId !== task.id) return `<div class="actions">${primary}<button class="secondary" data-action="start-decline">Decline</button></div>`;
    const sender = snapshot!.members.find(member => member.id === task.assignedBy)?.name;
    return `<form id="decline-task"><label>${sender ? `Tell ${escape(sender)} why` : 'Say why'} (optional)<textarea name="note" maxlength="8000"></textarea></label><div class="actions"><button type="submit" class="secondary">Decline task</button><button type="button" class="text-button" data-action="cancel-decline">Keep it</button></div></form>`;
  }
  if (mine && (task.status === 'running' || task.status === 'changes_requested')) {
    const draft = task.draftPackage ?? task.package;
    if (manualPackageTaskId === task.id) {
      return `<form id="package"><label>Summary<input name="summary" required value="${escape(draft?.summary)}"></label><label>Branch, commit, or document<input name="sourceRef" required value="${escape(draft?.sourceRef ?? `console-connect/${task.id}`)}"></label><label>Pull request URL, if available<input name="pullRequestUrl" type="url" value="${escape(draft?.pullRequestUrl)}"></label><label>Deliverables, one per line<textarea name="deliverables">${escape(draft?.deliverables.join('\n'))}</textarea></label><label>Verification<textarea name="verification">${escape(draft?.verification)}</textarea></label><label>Open questions<textarea name="questions">${escape(draft?.questions)}</textarea></label><div class="actions"><button type="submit">Save draft</button>${task.draftPackage ? '<button type="button" data-action="submit">Submit for review</button>' : ''}</div></form>`;
    }
    if (packageEditing?.taskId === task.id) return packageEditMarkup(task, packageEditing);
    if (task.draftPackage) return packageCardMarkup(task.draftPackage);
    return '<p class="action-heading">No draft yet</p><p class="action-hint">Your tool drafts it with console-connect package draft, or start one here. The app fills in the changed files, commit, and pull request.</p><div class="actions"><button data-action="draft-package">Draft work package</button></div>';
  }
  if (reviewer && task.status === 'submitted') {
    if (requestingChangesTaskId !== task.id) return '<div class="actions"><button data-action="accept">Accept package</button><button class="secondary" data-action="request-changes">Request changes</button></div>';
    return '<form id="request-changes"><label>What needs to change?<textarea name="note" required maxlength="8000"></textarea></label><div class="actions"><button type="submit">Send request</button><button type="button" class="text-button" data-action="cancel-request-changes">Cancel</button></div></form>';
  }
  return '';
}

function decisionStep(decisionId: string, owner: boolean) {
  const id = escape(decisionId);
  if (owner && !commitFieldDecisionIds.has(decisionId)) {
    return `<button data-action="prepare-decision" data-decision="${id}">Prepare Markdown</button><small>Next: push it, then paste the commit to approve. <button class="text-button inline-link" data-action="enter-decision-commit" data-decision="${id}">Enter commit</button></small>`;
  }
  return `<label>Pushed commit SHA<input data-commit-for="${id}" autocomplete="off"></label><button data-action="approve-decision" data-decision="${id}">Verify and approve</button>`;
}

// Statuses and roles are stored as identifiers (awaiting_approval, owner) and shown in sentence case.
const sentenceCase = (value: string) => { const text = value.replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1); };

const viaLabel = (tool: string) => `via ${escape(toolNames[tool] ?? tool)}`;

// "Assigned by Blair via Codex" when someone other than the assignee handed the task out.
function assignedByLine(task: Task) {
  if (!task.assignedBy || !task.assigneeId || task.assignedBy === task.assigneeId) return '';
  const name = snapshot?.members.find(member => member.id === task.assignedBy)?.name ?? 'a teammate';
  return `<span aria-hidden="true">·</span><span>Assigned by ${escape(name)}${task.via ? ` ${viaLabel(task.via)}` : ''}</span>`;
}

const assigningRules: Record<AssigningRule, { short: string; full: string }> = {
  anyone: { short: 'Anyone', full: 'Anyone can assign to anyone. Recipients still approve.' },
  leads: { short: 'Owners and Reviewers', full: 'Owners and Reviewers assign. Contributors claim or suggest an assignee.' },
  owner: { short: 'Owner only', full: 'Only the Owner assigns. Everyone else claims or suggests.' },
};

function canAssign() {
  const role = snapshot?.members.find(member => member.id === snapshot?.memberId)?.role;
  const rule = snapshot?.settings?.assigningRule ?? 'anyone';
  return rule === 'anyone' || (rule === 'leads' && role !== 'contributor') || role === 'owner';
}

function assigningRuleMarkup(owner: boolean) {
  const rule = snapshot?.settings?.assigningRule ?? 'anyone';
  return owner
    ? `<label class="assigning-rule">Who assigns work<select id="assigning-rule">${Object.entries(assigningRules).map(([id, label]) => `<option value="${id}" ${id === rule ? 'selected' : ''}>${label.short}</option>`).join('')}</select><small>${assigningRules[rule].full} Applies to every orchestrator too.</small></label>`
    : `<p class="assigning-rule">Who assigns work<small>${assigningRules[rule].full}</small></p>`;
}

// Everything this person handed out, grouped by where it stands (orchestrator ADR, "Assigned by me").
const assignedGroups: Array<[string, (task: Task) => boolean]> = [
  ['Needs your review', task => task.status === 'submitted'],
  ['Declined', task => Boolean(task.declinedBy)],
  ['Waiting for approval', task => task.status === 'awaiting_approval'],
  ['Ready to start', task => task.status === 'ready'],
  ['Running', task => task.status === 'running'],
  ['Changes requested', task => task.status === 'changes_requested'],
  ['Accepted, waiting to merge', task => task.status === 'accepted'],
];

function assignedByMeMarkup() {
  const me = snapshot!.memberId;
  const handedOut = snapshot!.tasks.filter(task => task.assignedBy === me && task.assigneeId !== me && task.status !== 'completed'
    && (task.assigneeId !== null || Boolean(task.declinedBy)));
  if (!handedOut.length) return '';
  const name = (id: string | null | undefined) => escape(snapshot!.members.find(member => member.id === id)?.name ?? 'Teammate');
  const groups = assignedGroups.map(([label, test]) => {
    const tasks = handedOut.filter(test);
    return tasks.length ? `<h3>${label}</h3>${tasks.map(task => `<button class="assigned-item" data-task="${task.id}"><strong>${escape(task.title)}</strong><small>${task.declinedBy ? `Declined by ${name(task.declinedBy)}` : name(task.assigneeId)}${task.via ? ` · ${viaLabel(task.via)}` : ''}</small></button>`).join('')}` : '';
  }).join('');
  return `<section class="assigned-by-me"><div class="section-head"><span class="section-label">Assigned by me</span><span class="section-count">${handedOut.length}</span></div>${groups}</section>`;
}

const fileLine = (file: { path: string; added: number | null; removed: number | null }) =>
  `${file.path}${file.added !== null ? ` +${file.added}` : ''}${file.removed ? ` −${file.removed}` : ''}`;
const maxDeliverables = 100;

function packageFactsMarkup(pack: { sourceRef: string; deliverables: string[]; pullRequestUrl?: string }) {
  return `<dt>Changed</dt><dd>${pack.deliverables.length ? `<ul class="package-files">${pack.deliverables.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : 'No file changes yet'}</dd><dt>Source</dt><dd class="package-source">${escape(pack.sourceRef)}${pack.pullRequestUrl ? ` · <span>${escape(pack.pullRequestUrl.replace(/^https:\/\/github\.com\//, ''))}</span>` : ''}</dd>`;
}

function packageCardMarkup(pack: WorkPackage) {
  return `<section class="package-card"><p class="package-card-summary">${escape(pack.summary)}</p><dl>${packageFactsMarkup(pack)}<dt>Checked</dt><dd>${escape(pack.verification) || 'Not recorded'}</dd><dt>Question</dt><dd>${escape(pack.questions) || 'None'}</dd></dl><div class="actions"><button class="secondary" data-action="edit-package">Edit</button><span class="package-private">Only you can see this until you submit</span><button data-action="submit">Submit for review</button></div></section>`;
}

function packageEditMarkup(task: Task, facts: { sourceRef: string; deliverables: string[]; pullRequestUrl?: string }) {
  const draft = task.draftPackage;
  return `<form id="package-card" class="package-card"><label>Summary<textarea name="summary" required maxlength="8000">${escape(draft?.summary)}</textarea></label><dl>${packageFactsMarkup(facts)}</dl><label>Checked<textarea name="verification" maxlength="8000">${escape(draft?.verification)}</textarea></label><label>Question<textarea name="questions" maxlength="8000">${escape(draft?.questions)}</textarea></label><div class="actions"><button type="submit">Save draft</button><button type="button" class="text-button" data-action="cancel-package-edit">Cancel</button></div></form>`;
}

// Words from the person or their tool, plus the Git facts read from the task worktree on this computer.
async function saveDraftPackage(draft: PackageDraft) {
  const task = snapshot?.tasks.find(item => item.id === draft.taskId);
  if (!task) throw new Error('Task not found.');
  const facts = await window.consoleConnect.worktreeFacts({ taskId: task.id });
  await command(task, { type: 'save-package', summary: draft.summary, sourceRef: `${facts.branch} · ${facts.commit.slice(0, 7)}`,
    pullRequestUrl: facts.pullRequestUrl ?? task.draftPackage?.pullRequestUrl, deliverables: facts.files.slice(0, maxDeliverables).map(fileLine),
    verification: draft.checks, questions: draft.questions, ...(draft.via ? { via: draft.via } : {}) });
}

function taskBody(task: Task) {
  const assignee = snapshot!.members.find(member => member.id === task.assigneeId);
  const tabs: TaskTab[] = ['overview', 'console', 'package', 'discussion'];
  const packageSummary = task.package ? `<section class="package-summary"><span class="section-label">Work package</span><h2>${escape(task.package.summary)}</h2><p>${escape(task.package.deliverables.join(', '))}</p><p><strong>Verification:</strong> ${escape(task.package.verification)}</p>${task.package.reviewNote ? `<p><strong>Review:</strong> ${escape(task.package.reviewNote)}</p>` : ''}</section>` : '';
  return `<h1>${escape(task.title)}</h1><div class="meta"><span class="status-pill status-pill-${task.status}"><i class="status-dot status-${task.status}" aria-hidden="true"></i>${escape(sentenceCase(task.status))}</span>${assignee ? `<span class="meta-person"><span class="avatar" aria-hidden="true">${escape(assignee.name.slice(0, 1).toUpperCase())}</span>${escape(assignee.name)}</span><span aria-hidden="true">·</span>` : ''}<span>Revision ${task.revision}</span>${assignedByLine(task)}</div><nav class="task-tabs" aria-label="Task sections">${tabs.map(tab => `<button class="task-tab ${taskTab === tab ? 'active' : ''}" data-action="task-tab" data-tab="${tab}" title="${tab.charAt(0).toUpperCase() + tab.slice(1)} (${tabs.indexOf(tab) + 1})" aria-current="${taskTab === tab ? 'page' : 'false'}">${tab.charAt(0).toUpperCase() + tab.slice(1)}</button>`).join('')}</nav><div class="task-tab-content">${taskTab === 'overview' ? `<p class="description">${escape(task.description)}</p>${['unassigned', 'awaiting_approval', 'ready'].includes(task.status) ? `<section class="action-panel">${taskActions(task)}</section>` : ''}` : ''}${taskTab === 'package' ? `${packageSummary}${['running', 'changes_requested', 'submitted'].includes(task.status) ? `<section class="action-panel">${taskActions(task)}</section>` : !task.package ? '<p class="description">No work package yet.</p>' : ''}` : ''}</div>`;
}

const toolNames: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };

function elapsedLabel() {
  return elapsedFrom(terminalStartedAt, terminalSessionActive ? Date.now() : terminalEndedAt);
}

function elapsedFrom(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const clock = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  return hours ? `${hours}:${clock(Math.floor(seconds / 60) % 60)}:${clock(seconds % 60)}` : `${Math.floor(seconds / 60)}:${clock(seconds % 60)}`;
}

// The well flexes with the window, so xterm refits and the tool learns its new size whenever the container changes.
const terminalResizeObserver = new ResizeObserver(() => {
  if (!terminal || !terminalFit || !terminal.element?.isConnected) return;
  terminalFit.fit();
  if (terminalRenderSource === 'local' && terminalSessionActive && terminalTaskId) {
    window.consoleConnect.terminalResize({ taskId: terminalTaskId, cols: terminal.cols, rows: terminal.rows });
  }
});
const localReadiness = () => consoleReadiness({ tool: terminalTool, output: terminalOutput, lastOutputAt: terminalLastOutputAt, now: Date.now() });
const localSessionNeedsInput = () => terminalSessionActive && needsInput({ readiness: localReadiness(), lastInputAt: terminalLastInputAt, lastOutputAt: terminalLastOutputAt,
  terminalFocused: terminalRenderSource === 'local' && Boolean(terminal?.element?.contains(document.activeElement)) && document.hasFocus() });

function typeBriefWhenReady() {
  if (!briefPendingTaskId || briefPendingTaskId !== terminalTaskId || !terminalSessionActive) return;
  if (localReadiness() !== 'ready') return;
  const task = snapshot?.tasks.find(item => item.id === briefPendingTaskId);
  briefPendingTaskId = null;
  if (task && snapshot) {
    window.consoleConnect.terminalWrite({ taskId: task.id, data: taskBrief(snapshot, task) });
    // The brief now waits in the input; later updates hold until the person sends or edits it.
    workerTypedAt = Date.now();
  }
}
setInterval(() => {
  const elapsed = document.querySelector('.session-elapsed');
  if (elapsed && terminalSessionActive) elapsed.textContent = elapsedLabel();
  typeBriefWhenReady();
  typeOrchestratorOpener();
  typeOrchestratorEvents();
  typeWorkerEvents();
  reportSessionState();
  // Re-render only when the inferred state flips, so the terminal and any focus stay put.
  if (localSessionNeedsInput() !== terminalNeedsInput) { terminalNeedsInput = !terminalNeedsInput; render(); }
}, 1000);

// Session rail (R): open by default on wide windows; an explicit choice is remembered on this computer.
const sessionRailKey = 'console-connect.session-rail';
const sessionRailMinWidth = 1280;
const changedFilesRefreshMs = 5_000;
type ChangedFile = { path: string; added: number | null; removed: number | null };
let changedFiles: { taskId: string; files: ChangedFile[]; at: number } | null = null;

function sessionRailOpen() {
  const saved = localStorage.getItem(sessionRailKey);
  return saved ? saved === 'open' : innerWidth >= sessionRailMinWidth;
}

function changedFilesMarkup() {
  if (!changedFiles || changedFiles.taskId !== terminalTaskId) return '<p class="rail-meta">Reading the task folder…</p>';
  if (!changedFiles.files.length) return '<p class="rail-meta">No changes yet.</p>';
  return changedFiles.files.map(file => `<div class="file"><span class="file-path" title="${escape(file.path)}">${escape(file.path)}</span><span class="file-counts">${file.added !== null ? `<span class="file-added">+${file.added}</span>` : ''}${file.removed ? ` <span class="file-removed">−${file.removed}</span>` : ''}</span></div>`).join('');
}

async function refreshChangedFiles() {
  const taskId = terminalTaskId;
  if (!taskId || !document.querySelector('.session-files')) return;
  try { changedFiles = { taskId, files: await window.consoleConnect.worktreeChanges({ taskId }), at: Date.now() }; }
  catch { changedFiles = { taskId, files: [], at: Date.now() }; }
  const section = document.querySelector('.session-files');
  if (section && taskId === terminalTaskId) section.innerHTML = changedFilesMarkup();
}
setInterval(() => { void refreshChangedFiles(); }, changedFilesRefreshMs);

function sessionRailMarkup(task: Task) {
  if (task.id !== terminalTaskId) {
    return `<section><h2 class="section-label">This session</h2><p class="rail-meta">${task.id === watchedTaskId ? 'Watching a shared console, view only.' : 'No console on this computer for this task.'}</p></section>`;
  }
  const state = terminalSessionActive && terminalNeedsInput ? '<span class="status-pill status-pill-input"><i class="status-dot status-awaiting_approval" aria-hidden="true"></i>Needs input</span>'
    : terminalSessionActive ? '<span class="status-pill"><i class="status-dot status-running" aria-hidden="true"></i>Running</span>'
    : '<span class="status-pill status-pill-ended"><i class="status-dot status-completed" aria-hidden="true"></i>Ended</span>';
  const canDraft = task.assigneeId === snapshot?.memberId && ['running', 'changes_requested'].includes(task.status);
  return `<section><h2 class="section-label">This session</h2>${state}<p class="rail-meta">Started ${relativeTime(terminalStartedAt)} on this computer</p>${terminalDirectory ? `<p class="rail-meta rail-path" title="${escape(terminalDirectory)}">${escape(terminalDirectory)}</p>` : ''}</section><section><h2 class="section-label">Changed files</h2><div class="session-files">${changedFilesMarkup()}</div></section>${canDraft ? '<section><button class="rail-draft" data-action="draft-package">Draft work package</button><p class="rail-meta">Stays private until you submit.</p></section>' : ''}`;
}

function orchestratorMarkup() {
  const session = orchestrator?.workspaceId === snapshot?.workspace.id ? orchestrator : null;
  const tools = Object.entries(toolNames).map(([id, name]) => `<option value="${id}" ${id === (session?.tool ?? 'codex') ? 'selected' : ''}>${name}</option>`).join('');
  const launch = session?.active ? '' : `<div class="console-launch"><select id="orchestrator-tool" aria-label="Choose tool">${tools}</select><button data-action="start-orchestrator">${session ? 'New console' : 'Open orchestrator'}</button></div>`;
  const strip = `<div class="session-strip">${session ? `<span class="session-tool">${escape(toolNames[session.tool] ?? session.tool)}</span><span class="session-place" title="${escape(session.directory)}">Main folder · no worktree</span><span class="session-elapsed">${elapsedFrom(session.startedAt, session.active ? Date.now() : session.endedAt)}</span>` : ''}<span class="session-state">${session ? session.active ? 'Session running' : 'Session ended' : 'No console'}</span><span class="session-spacer"></span>${autoBadgeMarkup()}${session?.active ? '<button class="text-button session-stop" data-action="stop-orchestrator">Stop</button>' : ''}${launch}</div>`;
  const body = session ? '<div id="orchestrator-terminal" aria-label="Orchestrator console output"></div>'
    : '<div class="console-empty"><p>Run Codex, Antigravity, or Claude Code in your main project folder, with console-connect ready. It plans, hands out, and follows work as you. Accepting work and approving decisions still need your click.</p></div>';
  return `<h1>Orchestrator</h1><div class="meta"><span>Acts as ${escape(snapshot!.members.find(member => member.id === snapshot!.memberId)?.name ?? 'you')}</span><span aria-hidden="true">·</span><span>Main project folder</span></div><div class="task-tab-content"><section class="console-workspace">${strip}${body}</section></div>`;
}

function autoBadgeMarkup() {
  const settings = loadAutoSettings();
  if (!settings.enabled) return '';
  return `<span class="auto-badge${autoPaused ? ' auto-paused' : ''}">${autoPaused ? 'Auto paused' : 'Auto'} · ${loadAutoUsage().count} of ${settings.dailyLimit} today</span><button class="text-button" data-action="toggle-auto-pause">${autoPaused ? 'Resume' : 'Pause'}</button>`;
}

function autoSettingsMarkup() {
  const settings = loadAutoSettings();
  const choice = (key: 'questions' | 'stalls' | 'submissions', label: string, hint: string) => `<label class="auto-choice"><span>${label}<small>${hint}</small></span><select data-auto="${key}" ${settings.enabled ? '' : 'disabled'}><option value="ask" ${settings[key] === 'ask' ? 'selected' : ''}>Ask me</option><option value="auto" ${settings[key] === 'auto' ? 'selected' : ''}>Auto</option></select></label>`;
  return `<label class="chat-setting-check"><input type="checkbox" data-auto="enabled" ${settings.enabled ? 'checked' : ''}>Let the orchestrator handle updates automatically</label><div class="auto-settings">${choice('questions', 'A teammate\'s AI asks a question', 'The orchestrator answers in the task discussion as you.')}${choice('stalls', 'A session gets stuck or ends without a package', 'The orchestrator suggests a next step to the owner.')}${choice('submissions', 'Work is submitted', 'The orchestrator reads the package and proposes a review; accepting waits for your click.')}<p class="auto-choice"><span>Assign follow-up work<small>New hand-outs from an automatic run are held for you to send.</small></span><strong>Always asks you</strong></p><label class="auto-choice"><span>Replies on your own tasks<small>Answers and comments reach your task console. Change requests and decision changes always wait for you.</small></span><select data-auto="workerReplies"><option value="ask" ${settings.workerReplies === 'ask' ? 'selected' : ''}>Ask me</option><option value="auto" ${settings.workerReplies === 'auto' ? 'selected' : ''}>Auto</option></select></label><label class="auto-choice"><span>Pause after this many automatic runs a day</span><input type="number" min="1" max="500" data-auto="dailyLimit" value="${settings.dailyLimit}" ${settings.enabled ? '' : 'disabled'}></label></div>`;
}

function decisionChangedMarkup(task: Task) {
  const decision = snapshot!.decisions.find(item => item.id === task.pendingDecisionIds![0]);
  if (!decision) return '';
  return `<div class="decision-changed" role="status"><div><strong>The "${escape(decision.title)}" decision changed</strong><span>Acknowledge it before you submit. Your session keeps running until you decide.</span></div><button class="text-button" data-action="task-tab" data-tab="package">View the change</button><button class="secondary" data-action="ack-and-tell" data-decision="${escape(decision.id)}">Acknowledge and tell ${escape(toolNames[terminalTool] ?? 'your tool')}</button></div>`;
}

function orchestratorRailMarkup() {
  const handedOut = assignedByMeMarkup();
  const activity = cliActivity.length
    ? cliActivity.map(item => `<div class="activity-item"><span>${escape(item.text)}</span><small>${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(item.at)}${item.tool ? ` · ${viaLabel(item.tool)}` : ''}</small></div>`).join('')
    : '<p class="rail-meta">Nothing yet. Commands your tool runs through console-connect show here.</p>';
  const held = heldAssignments.length ? `<section class="held-work"><div class="section-head"><span class="section-label">Held for you</span></div><p class="rail-meta">Automatic runs never hand out work. Send these yourself.</p>${heldAssignments.map(item => `<div class="held-item"><span>${escape(item.summary)}</span><div><button class="text-button" data-action="discard-held" data-held="${item.id}">Discard</button><button class="secondary" data-action="send-held" data-held="${item.id}">Send</button></div></div>`).join('')}</section>` : '';
  return `${held}${handedOut || '<section class="assigned-by-me"><div class="section-head"><span class="section-label">Assigned by me</span></div><p class="rail-meta">Nothing handed out yet. Tasks you or your orchestrator assign show up here, grouped by where they stand.</p></section>'}<section class="cli-activity"><div class="section-head"><span class="section-label">CLI activity</span></div>${activity}</section>`;
}

function mountOrchestratorTerminal() {
  const container = document.querySelector<HTMLElement>('#orchestrator-terminal');
  if (!container || !orchestrator) return;
  if (orchestratorTerminal?.element) {
    container.append(orchestratorTerminal.element);
  } else {
    orchestratorTerminal = new Terminal({ theme: loadTheme().terminal, fontFamily: terminalFontFamily, fontSize: 13, cursorBlink: orchestrator.active });
    orchestratorFit = new FitAddon();
    orchestratorTerminal.loadAddon(orchestratorFit);
    orchestratorTerminal.open(container);
    orchestratorTerminal.write(orchestrator.output);
    orchestratorTerminal.onData(data => {
      if (!orchestrator?.active) return;
      if (!/^\x1b\[[IO]$/.test(data)) orchestratorLastInputAt = Date.now();
      window.consoleConnect.terminalWrite({ taskId: orchestratorKey, data });
    });
  }
  orchestratorTerminal.options.theme = loadTheme().terminal;
  orchestratorFit?.fit();
  if (orchestrator.active) window.consoleConnect.terminalResize({ taskId: orchestratorKey, cols: orchestratorTerminal.cols, rows: orchestratorTerminal.rows });
  orchestratorResizeObserver.disconnect();
  orchestratorResizeObserver.observe(container);
}

const orchestratorResizeObserver = new ResizeObserver(() => {
  if (!orchestratorTerminal?.element?.isConnected || !orchestratorFit) return;
  orchestratorFit.fit();
  if (orchestrator?.active) window.consoleConnect.terminalResize({ taskId: orchestratorKey, cols: orchestratorTerminal.cols, rows: orchestratorTerminal.rows });
});

const terminalFontFamily = "'JetBrains Mono', Consolas, monospace";
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
    : `<div class="chat-message-meta">${mine ? '<span class="sr-only">You · </span>' : `${escape(author)} · `}${escape(time)}${message.via ? ` · ${viaLabel(message.via)}` : ''}</div>`;
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
  if (keyboardMove) { motion.task = null; motion.tab = null; keyboardMove = false; }
  const editInputFocused = Boolean(document.activeElement?.closest('.chat-edit'));
  const renderedTask = snapshot?.tasks.find(task => task.id === selectedTaskId) ?? snapshot?.tasks[0];
  const nextTerminalSource = renderedTask?.id === terminalTaskId ? 'local'
    : renderedTask?.id === watchedTaskId ? 'shared' : null;
  const keepTerminal = Boolean(terminal && view === 'review' && taskTab === 'console' && !showWorkspaceChat && !showOrchestrator
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
  app.innerHTML = `<div class="workspace"><aside><div class="brand">CONSOLE <b>CONNECT</b></div><div class="workspace-name">${escape(snapshot.workspace.name)}<small>${escape(snapshot.workspace.repository)}</small></div><div class="aside-label"><span>Tasks</span><button class="icon-button new-task" data-action="new-task" aria-label="New task" title="New task (N)">${plusIcon}</button></div><div class="task-list">${snapshot.tasks.map(task => `<button class="task-link ${task.id === selected?.id ? 'active' : ''}" data-task="${task.id}" title="${escape(task.title)}"><i class="status-dot status-${task.status}" aria-hidden="true"></i><strong>${escape(task.title)}</strong><small>${escape(sentenceCase(task.status))}</small></button>`).join('')}</div><div class="sidebar-bottom"><span class="avatar" aria-hidden="true">${escape((me?.name ?? '?').slice(0, 1).toUpperCase())}</span><div class="identity"><span>${escape(me?.name)}</span><small>${escape(sentenceCase(me?.role ?? ''))}</small></div><button class="icon-button settings-button" data-action="settings" aria-label="Settings" title="Settings">${gearIcon}</button></div></aside><main class="desk"><header class="topbar"><nav class="breadcrumb" aria-label="Location"><button class="text-button" data-action="disconnect" title="Back to projects">${escape(snapshot.workspace.name)}</button>${showWorkspaceChat || showOrchestrator || selected ? `<span aria-hidden="true">/</span><span class="breadcrumb-current" aria-current="page">${escape(showWorkspaceChat ? 'Team chat' : showOrchestrator ? 'Orchestrator' : selected!.title)}</span>` : ''}</nav><div></div></header><div class="desk-content">${selected ? taskBody(selected) : '<h1>Choose a task to begin.</h1>'}${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}</div></main><aside class="right-rail">${connection?.shareUrl ? `<div class="host-status"><i class="status-dot status-running" aria-hidden="true"></i><span title="${escape(connection.shareUrl)}">Hosting on this computer</span><button class="text-button" data-action="copy-host-address" data-address="${escape(connection.shareUrl)}">Copy address</button></div>` : ''}<span class="section-label">Team</span>${snapshot.members.map(member => `<div class="member"><span class="avatar">${escape(member.name.slice(0, 1).toUpperCase())}</span><div>${escape(member.name)}<small>${escape(sentenceCase(member.role))}</small></div></div>`).join('')}${assigningRuleMarkup(me?.role === 'owner')}<button class="secondary invite" data-action="invite">Invite member</button>${currentInvitationLink ? `<div class="invitation-link"><label>Invitation link<input readonly value="${escape(currentInvitationLink)}"></label><button class="secondary" data-action="copy-invitation">Copy link</button><small>One-time link, valid for 24 hours. Share it only with the person you want to invite.</small></div>` : ''}<p class="rail-note">Updates appear as teammates work. Approval stays with the person assigned.</p></aside></div>`;
  document.querySelector('.desk-content')?.classList.toggle('console-active', (taskTab === 'console' && !showWorkspaceChat) || showOrchestrator);
  document.querySelector('.topbar div')!.innerHTML = `<button class="text-button topbar-jump" data-action="open-palette" title="Jump to a task, person, or action">Jump<kbd>Ctrl</kbd><kbd>K</kbd></button><button class="secondary topbar-chat" data-action="open-chat-drawer" title="Team chat (C)">Chat${unread ? `<span class="chat-count">${unread}</span>` : ''}</button><button class="text-button" data-action="disconnect">Projects</button>`;
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
  document.querySelector('.task-list')!.insertAdjacentHTML('afterend', `<button class="chat-link orchestrator-link ${showOrchestrator ? 'active' : ''}" data-action="open-orchestrator">Orchestrator${orchestratorEvents.length ? `<span class="chat-count" aria-label="${orchestratorEvents.length} updates waiting" title="${escape(eventLine(orchestratorEvents))}">${orchestratorEvents.length}</span>` : orchestrator?.active && orchestrator.workspaceId === snapshot.workspace.id ? '<i class="status-dot status-running" aria-label="running"></i>' : ''}</button>`);
  if (showWorkspaceChat) {
    document.querySelectorAll('.task-link.active').forEach(item => item.classList.remove('active'));
    document.querySelector('.desk-content')!.classList.add('chat-page');
    document.querySelector('.desk-content')!.innerHTML = `${chatRoomMarkup()}${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}`;
  } else if (showOrchestrator) {
    document.querySelectorAll('.task-link.active').forEach(item => item.classList.remove('active'));
    document.querySelector('.desk-content')!.innerHTML = `${orchestratorMarkup()}${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ''}`;
    mountOrchestratorTerminal();
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
      const launch = canLaunch ? `<div class="console-launch"><select id="tool" aria-label="Choose tool">${Object.entries(toolNames).map(([id, name]) => `<option value="${id}" ${id === terminalTool ? 'selected' : ''}>${name}</option>`).join('')}</select><button data-action="start">${localTerminal ? 'New console' : 'Launch console'}</button></div>` : '';
      const controls = localTerminal && terminalSessionActive && connection?.mode !== 'supabase'
        ? `<button class="text-button" data-action="toggle-terminal-sharing" aria-pressed="${sharedTerminal}">${sharedTerminal ? 'Stop sharing' : 'Share view only'}</button>`
        : watching ? '<button class="text-button" data-action="stop-watching">Stop watching</button>'
          : sharedTerminal && !localTerminal && connection?.mode !== 'supabase' ? '<button class="secondary" data-action="watch-terminal">Watch shared console</button>' : '';
      const stop = localTerminal && terminalSessionActive ? '<button class="text-button session-stop" data-action="stop-console">Stop</button>' : '';
      const session = localTerminal && terminalTool ? `<span class="session-tool">${escape(toolNames[terminalTool] ?? terminalTool)}</span><span class="session-branch" title="console-connect/${escape(selected.id)}"><span class="session-branch-prefix">console-connect</span>/${escape(selected.id.slice(0, 8))}</span><span class="session-elapsed">${elapsedLabel()}</span>` : '';
      const status = localTerminal ? terminalSessionActive ? 'Session running' : 'Session ended' : watching ? 'View only' : 'No console';
      document.querySelector('.task-tab-content')!.insertAdjacentHTML('beforeend', `<section class="console-workspace"><div class="session-strip">${session}<span class="session-state">${status}</span><span class="session-spacer"></span>${controls}${stop}${launch}<span class="session-toggles"><button class="text-button" data-action="toggle-session-rail" aria-pressed="${sessionRailOpen()}" title="Session rail (R)">Session<kbd>R</kbd></button><button class="text-button" data-action="toggle-console-focus" aria-pressed="${consoleFocus}" title="Focus mode (F)">Focus<kbd>F</kbd></button></span></div>${localTerminal || watching ? `<div id="terminal" aria-label="Task console output"></div>${localTerminal && terminalSessionActive && terminalNeedsInput ? `<div class="needs-input" role="status"><i class="status-dot status-submitted" aria-hidden="true"></i>${escape(toolNames[terminalTool] ?? 'The tool')} may be waiting for you<span class="session-spacer"></span><button class="text-button" data-action="focus-terminal">Focus terminal<kbd>Ctrl</kbd><kbd>\`</kbd></button></div>` : ''}${localTerminal && terminalSessionActive && selected.assigneeId === snapshot.memberId && selected.pendingDecisionIds?.length ? decisionChangedMarkup(selected) : ''}${localTerminal && selected.draftPackage && ['running', 'changes_requested'].includes(selected.status) ? '<div class="package-drafted" role="status"><i class="status-dot status-running" aria-hidden="true"></i>Your work package is drafted. Only you can see it.<span class="session-spacer"></span><button class="text-button" data-action="task-tab" data-tab="package">Review and submit</button></div>' : ''}` : `<div class="console-empty"><p>${sharedTerminal ? 'A teammate is sharing a console. Watch it here, or launch your own if this task is assigned to you.' : 'Launch a signed-in local tool for this task. Its output stays here while you move between task sections.'}</p></div>`}</section>`);
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
          terminal = new Terminal({ theme: theme.terminal, fontFamily: terminalFontFamily, fontSize: 13, cursorBlink: localTerminal && terminalSessionActive });
          terminalFit = new FitAddon();
          terminal.loadAddon(terminalFit);
          terminal.open(container);
          terminalFit.fit();
          terminal.write(localTerminal ? terminalOutput : watchedOutput);
          if (localTerminal && terminalSessionActive) {
            terminal.onData(data => {
              // Focus reports (ESC [ I / ESC [ O) are the terminal talking, not the person answering.
              if (!/^\x1b\[[IO]$/.test(data)) terminalLastInputAt = Date.now();
              window.consoleConnect.terminalWrite({ taskId: selected.id, data });
            });
          }
        }
        if (localTerminal && terminalSessionActive) window.consoleConnect.terminalResize({ taskId: selected.id, cols: terminal.cols, rows: terminal.rows });
        terminalResizeObserver.disconnect();
        terminalResizeObserver.observe(container);
      }
    }
    if (taskTab === 'discussion') {
      const messages = snapshot.messages.filter(message => message.taskId === selected.id);
      document.querySelector('.task-tab-content')!.insertAdjacentHTML('beforeend', `<section class="discussion"><span class="section-label">Discussion</span>${messages.map(message => `<div class="message"><strong>${escape(snapshot!.members.find(member => member.id === message.authorId)?.name)}</strong>${message.via ? ` <small class="via-marker">${viaLabel(message.via)}</small>` : ''}<p>${escape(message.body)}</p></div>`).join('') || '<p>No messages yet.</p>'}<form id="message"><label>Message<textarea name="body" required></textarea></label><button type="submit">Post message</button></form></section>`);
    }
  }
  if (notice && loadPending(localStorage).some(item => item.workspaceId === snapshot!.workspace.id && item.memberId === snapshot!.memberId)) {
    document.querySelector('.notice')?.insertAdjacentHTML('beforeend', '<button class="secondary" data-action="discard-pending">Discard oldest saved update</button>');
  }
  document.querySelector('.right-rail')!.insertAdjacentHTML('beforeend', assignedByMeMarkup());
  document.querySelector('.right-rail')!.insertAdjacentHTML('beforeend', `<section class="decisions"><div class="section-head"><span class="section-label">Decisions</span><button class="text-button" data-action="propose-decision">${plusIcon}Propose</button></div>${snapshot.decisions.map(decision => `<div class="decision"><div class="decision-head"><strong>${escape(decision.title)}</strong><span class="decision-status decision-status-${decision.status}">${escape(decision.status.charAt(0).toUpperCase() + decision.status.slice(1))}</span></div><p>${escape(decision.body)}</p>${decision.documentCommit ? `<small>Commit ${escape(decision.documentCommit.slice(0, 12))}</small>` : ''}${decision.status === 'proposed' && me?.role !== 'contributor' ? decisionStep(decision.id, me?.role === 'owner') : ''}</div>`).join('')}</section>`);
  if (showOrchestrator) {
    document.querySelector('.right-rail')!.innerHTML = orchestratorRailMarkup();
  } else if (selected && taskTab === 'console' && !showWorkspaceChat) {
    if (consoleFocus) {
      document.querySelector('.workspace')!.classList.add('workspace-focus');
      document.querySelector('.breadcrumb')!.insertAdjacentHTML('beforeend', document.querySelector('.desk-content .status-pill')?.outerHTML ?? '');
    }
    const rail = document.querySelector<HTMLElement>('.right-rail')!;
    if (sessionRailOpen()) {
      rail.classList.add('session-rail');
      rail.setAttribute('aria-label', 'Session');
      rail.innerHTML = sessionRailMarkup(selected);
      if (selected.id === terminalTaskId && (changedFiles?.taskId !== selected.id || Date.now() - changedFiles.at > changedFilesRefreshMs)) void refreshChangedFiles();
    } else {
      rail.remove();
      document.querySelector('.workspace')!.classList.add('workspace-no-rail');
    }
  }
  if (reviewProposals.length) {
    app.insertAdjacentHTML('beforeend', proposalMarkup());
    if (shownProposalId !== reviewProposals[0]!.id) {
      shownProposalId = reviewProposals[0]!.id;
      document.querySelector<HTMLButtonElement>('[data-action=proposal-confirm]')?.focus();
    }
  }
  if (showChatDrawer && !showWorkspaceChat) app.insertAdjacentHTML('beforeend', `<aside class="chat-drawer" aria-label="Team chat drawer">${chatRoomMarkup(true)}</aside>`);
  if (chatToast && !showChatDrawer && !showWorkspaceChat) {
    const author = snapshot.members.find(member => member.id === chatToast!.message.authorId)?.name ?? 'Teammate';
    app.insertAdjacentHTML('beforeend', `<div class="chat-toast" role="status"><div><strong>${chatToast.count === 1 ? `${escape(author)} sent a message` : `${chatToast.count} new team messages`}</strong><p>${escape(chatToast.message.body.slice(0, 120))}</p></div><button data-action="open-chat-drawer">Reply</button><button class="text-button" data-action="dismiss-chat-toast" aria-label="Dismiss message preview">×</button></div>`);
  }
  const chatStream = document.querySelector<HTMLElement>('#team-chat-stream');
  if (chatStream) chatStream.scrollTop = chatWasAtBottom ? chatStream.scrollHeight : previousChatScroll;
  const deskKey = `${selected?.id}|${taskTab}|${showWorkspaceChat}|${showOrchestrator}`;
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
  if (target.dataset.auto) {
    const settings = loadAutoSettings();
    const key = target.dataset.auto as keyof AutoSettings;
    const input = target as HTMLInputElement;
    const next = { ...settings, [key]: key === 'enabled' ? input.checked : key === 'dailyLimit' ? Math.max(1, Math.min(500, Number(input.value) || settings.dailyLimit)) : input.value };
    localStorage.setItem(autoSettingsKey, JSON.stringify(next));
    render();
  }
  if (target.id === 'assigning-rule') {
    void command(null, { type: 'set-assigning-rule', rule: (target as HTMLSelectElement).value }).catch(error => { notice = (error as Error).message; render(); });
  }
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
    } else if (form.id === 'request-changes') {
      const task = snapshot!.tasks.find(item => item.id === requestingChangesTaskId);
      if (!task) throw new Error('Choose a task first.');
      requestingChangesTaskId = null;
      await command(task, { type: 'request-changes', note: value('note') });
    } else if (form.id === 'decline-task') {
      const task = snapshot!.tasks.find(item => item.id === decliningTaskId);
      if (!task) throw new Error('Choose a task first.');
      const note = value('note');
      decliningTaskId = null;
      await command(task, { type: 'decline-task', ...(note ? { note } : {}) });
    } else if (form.id === 'new-task') {
      await command(null, { type: 'create-task', taskId: crypto.randomUUID(), title: value('title'), description: value('description'), assigneeId: value('assigneeId') || null });
    } else if (form.id === 'package-card') {
      const task = snapshot!.tasks.find(item => item.id === packageEditing?.taskId);
      if (!task || !packageEditing) throw new Error('Choose a task first.');
      const facts = packageEditing;
      packageEditing = null;
      await command(task, { type: 'save-package', summary: value('summary'), sourceRef: facts.sourceRef, pullRequestUrl: facts.pullRequestUrl,
        deliverables: facts.deliverables, verification: value('verification'), questions: value('questions') });
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

const clickAction = (selector: string) => document.querySelector<HTMLButtonElement>(selector)?.click();

function paletteItems(): PaletteItem[] {
  const workspace = snapshot!;
  const tasks = workspace.tasks.map(task => ({ label: task.title, kind: 'Task',
    icon: `<i class="status-dot status-${task.status}" aria-hidden="true"></i>`,
    run: () => { keyboardMove = true; clickAction(`[data-task="${task.id}"]`); } }));
  // A person jumps to the task they hold, preferring one that is running.
  const people = workspace.members.flatMap(member => {
    const held = workspace.tasks.filter(task => task.assigneeId === member.id);
    const task = held.find(item => item.status === 'running') ?? held[0];
    return task ? [{ label: member.name, kind: 'Person', hint: task.title,
      icon: `<span class="avatar" aria-hidden="true">${escape(member.name.slice(0, 1).toUpperCase())}</span>`,
      run: () => { keyboardMove = true; clickAction(`[data-task="${task.id}"]`); } }] : [];
  });
  const actions: PaletteItem[] = [
    { label: 'New task', kind: 'Action', hint: 'N', run: () => clickAction('[data-action=new-task]') },
    { label: 'Open team chat', kind: 'Action', hint: 'C', run: () => clickAction('[data-action=open-chat-drawer]') },
    { label: 'Open orchestrator', kind: 'Action', run: () => clickAction('[data-action=open-orchestrator]') },
    { label: 'Propose decision', kind: 'Action', run: () => clickAction('[data-action=propose-decision]') },
    { label: 'Invite member', kind: 'Action', run: () => clickAction('[data-action=invite]') },
    { label: 'Projects', kind: 'Action', run: () => clickAction('.topbar [data-action=disconnect]') },
    { label: 'Settings', kind: 'Action', run: () => clickAction('[data-action=settings]') },
  ];
  return [...tasks, ...people, ...actions];
}

// Single-key shortcuts stay out of text fields and the terminal, where the keys belong to typing.
const typingTarget = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], .xterm'));
const shortcutTabs: TaskTab[] = ['overview', 'console', 'package', 'discussion'];

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && assignMenuOpen) {
    assignMenuOpen = false; render();
    document.querySelector<HTMLButtonElement>('[data-action=toggle-assign-menu]')?.focus();
    return;
  }
  if (event.key === 'Escape' && reviewProposals.length) { reviewProposals.shift(); editingProposal = false; render(); return; }
  if (reviewProposals.length || paletteOpen() || view !== 'review' || !snapshot || event.defaultPrevented) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'k') {
    if ((event.target as HTMLElement | null)?.closest?.('.xterm')) return;
    event.preventDefault();
    openPalette(paletteItems());
    return;
  }
  if (event.ctrlKey && event.key === '`') {
    const target = showOrchestrator ? orchestratorTerminal : terminal;
    if (target?.element?.isConnected) { event.preventDefault(); target.focus(); return; }
  }
  if (event.ctrlKey || event.metaKey || event.altKey || typingTarget(event.target)) return;
  const tasks = snapshot.tasks;
  if ((key === 'j' || key === 'k') && tasks.length) {
    const index = Math.max(0, tasks.findIndex(task => task.id === (selectedTaskId ?? tasks[0]!.id)));
    const next = tasks[Math.min(tasks.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))]!;
    keyboardMove = true;
    clickAction(`[data-task="${next.id}"]`);
  } else if (['1', '2', '3', '4'].includes(key)) {
    keyboardMove = true;
    clickAction(`[data-action=task-tab][data-tab="${shortcutTabs[Number(key) - 1]}"]`);
  } else if (key === 'r' && document.querySelector('[data-action=toggle-session-rail]')) clickAction('[data-action=toggle-session-rail]');
  else if (key === 'f' && document.querySelector('[data-action=toggle-console-focus]')) clickAction('[data-action=toggle-console-focus]');
  else if (key === 'n') clickAction('[data-action=new-task]');
  else if (key === 'c') clickAction(document.querySelector('.chat-drawer') ? '[data-action=close-chat-drawer]' : '[data-action=open-chat-drawer]');
  else return;
  event.preventDefault();
});

app.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (assignMenuOpen && !(event.target as HTMLElement).closest('.assign-menu')) { assignMenuOpen = false; render(); }
  if (!button) return;
  if (button.dataset.task) {
    if (watchedTaskId && watchedTaskId !== button.dataset.task) { window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId }); watchedTaskId = null; watchedOutput = ''; }
    if (selectedTaskId !== button.dataset.task) taskTab = 'overview';
    selectedTaskId = button.dataset.task; showWorkspaceChat = false; showOrchestrator = false; render(); return;
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
      localStorage.setItem(projectOpenedKey(project.id), String(Date.now()));
      projectSummariesLoadedAt = 0;
      currentInvitationLink = '';
      snapshot = null;
      selectedTaskId = null;
      showWorkspaceChat = false; showChatDrawer = false; showOrchestrator = false;
      orchestratorEvents = [];
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
      showWorkspaceChat = true; showOrchestrator = false; showChatDrawer = false; markTeamChatRead(); render(); return;
    }
    if (action === 'task-tab') { taskTab = button.dataset.tab as TaskTab; render(); return; }
    if (action === 'disconnect') {
      if (watchedTaskId) window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId });
      watchedTaskId = null; watchedOutput = '';
      stopHostedWatch?.(); stopHostedWatch = null;
      window.consoleConnect.stopWatchingWorkspace();
      connection = null; snapshot = null; view = 'dashboard'; notice = ''; currentInvitationLink = '';
      orchestratorEvents = [];
      projectSummariesLoadedAt = 0;
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
    if (action === 'new-task') { showWorkspaceChat = false; showOrchestrator = false; document.querySelector('.desk-content')!.innerHTML = `<h1>New task</h1><form id="new-task"><label>Title<input name="title" required></label><label>Description<textarea name="description"></textarea></label><label>Assign to<select name="assigneeId"><option value="">Unassigned</option>${snapshot!.members.map(member => `<option value="${member.id}">${escape(member.name)}</option>`).join('')}</select></label><button type="submit">Create task</button></form>`; return; }
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
    // Workspace-level actions: they work before any task exists.
    if (action === 'toggle-auto-pause') { autoPaused = !autoPaused; render(); return; }
    if (action === 'discard-held') { heldAssignments = heldAssignments.filter(item => item.id !== button.dataset.held); render(); return; }
    if (action === 'send-held') {
      const item = heldAssignments.find(entry => entry.id === button.dataset.held);
      if (!item) return;
      const result = await runCliCommand(item.argv, { cwd: '', taskId: null, tool: toolSchema.safeParse(orchestrator?.tool).data }, cliWorkspace);
      heldAssignments = heldAssignments.filter(entry => entry.id !== item.id);
      notice = result.text; render(); return;
    }
    if (action === 'copy-cli-folder') { await window.consoleConnect.copyText(cliFolderPath); notice = 'Folder copied.'; render(); return; }
    if (action === 'open-orchestrator') {
      if (watchedTaskId) { window.consoleConnect.stopWatchingTerminal({ taskId: watchedTaskId }); watchedTaskId = null; watchedOutput = ''; }
      showOrchestrator = true; showWorkspaceChat = false; render(); return;
    }
    if (action === 'start-orchestrator') {
      const repositoryPath = await currentProjectFolder();
      if (!repositoryPath) return;
      const tool = document.querySelector<HTMLSelectElement>('#orchestrator-tool')!.value;
      orchestratorTerminal?.dispose(); orchestratorTerminal = null; orchestratorFit = null;
      const started = { tool, workspaceId: snapshot!.workspace.id, directory: '', startedAt: Date.now(), endedAt: 0, active: true, output: '', lastOutputAt: Date.now() };
      orchestrator = started;
      orchestratorOpenerPending = true; orchestratorTypedAt = 0; orchestratorLastInputAt = 0;
      try { started.directory = (await window.consoleConnect.runOrchestrator({ repositoryPath, workspaceRepository: snapshot!.workspace.repository, tool })).directory; }
      catch (error) { orchestrator = null; throw error; }
      render(); return;
    }
    if (action === 'stop-orchestrator') {
      if (confirm('Stop the orchestrator console? The tool ends.')) window.consoleConnect.terminalKill({ taskId: orchestratorKey });
      return;
    }
    if (action === 'proposal-dismiss') { reviewProposals.shift(); editingProposal = false; render(); return; }
    if (action === 'proposal-edit') { editingProposal = true; render(); document.querySelector<HTMLTextAreaElement>('#proposal-note')?.focus(); return; }
    if (action === 'proposal-switch') {
      const proposal = reviewProposals[0];
      if (proposal) { proposal.note = document.querySelector<HTMLTextAreaElement>('#proposal-note')?.value ?? proposal.note; proposal.action = proposal.action === 'accept' ? 'changes' : 'accept'; }
      render(); return;
    }
    if (action === 'proposal-confirm') { await confirmProposal(); return; }
    if (action === 'open-palette') { openPalette(paletteItems()); return; }
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
      terminalTool = tool; terminalStartedAt = Date.now(); terminalDirectory = ''; terminalLastOutputAt = Date.now(); terminalNeedsInput = false;
      terminalLastInputAt = 0; briefPendingTaskId = task.id; workerEvents = []; workerTypedAt = 0;
      const active = connection!;
      const access = active.mode === 'supabase' ? { ...active, token: await hostedAccessToken(active) } : active;
      try { terminalDirectory = (await window.consoleConnect.runTask({ ...access, taskId: task.id, tool, repositoryPath })).directory; }
      catch (error) { terminalTaskId = null; terminalSessionActive = false; throw error; }
      await refresh();
    }
    if (action === 'draft-package' || action === 'edit-package') {
      taskTab = 'package';
      const draft = task.draftPackage;
      if (action === 'edit-package' && draft) { packageEditing = { taskId: task.id, sourceRef: draft.sourceRef, deliverables: draft.deliverables, pullRequestUrl: draft.pullRequestUrl }; render(); return; }
      try {
        const facts = await window.consoleConnect.worktreeFacts({ taskId: task.id });
        packageEditing = { taskId: task.id, sourceRef: `${facts.branch} · ${facts.commit.slice(0, 7)}`, deliverables: facts.files.slice(0, maxDeliverables).map(fileLine), pullRequestUrl: facts.pullRequestUrl };
      } catch (error) { manualPackageTaskId = task.id; notice = (error as Error).message; }
      render(); document.querySelector<HTMLTextAreaElement>('#package-card textarea')?.focus(); return;
    }
    if (action === 'cancel-package-edit') { packageEditing = null; render(); return; }
    if (action === 'start-decline') { decliningTaskId = task?.id ?? null; render(); document.querySelector<HTMLTextAreaElement>('#decline-task textarea')?.focus(); return; }
    if (action === 'cancel-decline') { decliningTaskId = null; render(); return; }
    if (action === 'focus-terminal') { terminal?.focus(); return; }
    if (action === 'toggle-console-focus') { consoleFocus = !consoleFocus; keyboardMove = true; render(); return; }
    if (action === 'toggle-session-rail') {
      localStorage.setItem(sessionRailKey, sessionRailOpen() ? 'closed' : 'open');
      keyboardMove = true; render(); return;
    }
    if (action === 'ack-and-tell') {
      const decision = snapshot?.decisions.find(item => item.id === button.dataset.decision);
      await command(task, { type: 'acknowledge-decision', decisionId: button.dataset.decision });
      if (decision) workerEvents.push({ kind: 'decision', decisionId: decision.id, title: decision.title, body: decision.body.replace(/\s+/g, ' ').slice(0, 400) });
      return;
    }
    if (action === 'stop-console') {
      if (confirm('Stop this console? The tool ends and unsaved work in it may be lost.')) window.consoleConnect.terminalKill({ taskId: task.id });
      return;
    }
    if (action === 'submit') await command(task, { type: 'submit-package' });
    if (action === 'accept') await command(task, { type: 'accept-package' });
    // Electron has no prompt(), so the note is written inline.
    if (action === 'request-changes') { requestingChangesTaskId = task.id; render(); document.querySelector<HTMLTextAreaElement>('#request-changes textarea')?.focus(); return; }
    if (action === 'cancel-request-changes') { requestingChangesTaskId = null; render(); return; }
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
// console-connect requests arrive from the pipe in main and run here, as this person, with this session.
const cliWorkspace: WorkspaceApi = {
  snapshot: () => view === 'review' ? snapshot : null,
  send: async (taskId, fields) => {
    const task = taskId ? snapshot?.tasks.find(item => item.id === taskId) ?? null : null;
    if (taskId && !task) throw new Error('Task not found.');
    await command(task, fields);
  },
  propose: proposal => { reviewProposals.push(proposal); render(); },
  hold: item => { heldAssignments.push({ id: crypto.randomUUID(), ...item }); render(); },
  autoSummary: () => {
    const settings = loadAutoSettings();
    const kinds = (['questions', 'stalls', 'submissions'] as const).filter(key => settings[key] === 'auto');
    return !settings.enabled || autoPaused ? 'Auto: off' : `Auto: ${kinds.length ? kinds.join(', ') : 'on, every update asks'}`;
  },
  draftPackage: saveDraftPackage,
};

function proposalMarkup() {
  const proposal = reviewProposals[0];
  const task = proposal && snapshot?.tasks.find(item => item.id === proposal.taskId);
  if (!proposal || !task) return '';
  const tool = proposal.via ? toolNames[proposal.via] ?? proposal.via : 'Your tool';
  const owner = snapshot!.members.find(member => member.id === task.assigneeId)?.name ?? 'the assignee';
  const accept = proposal.action === 'accept';
  const note = editingProposal
    ? `<label class="proposal-note">Review note<textarea id="proposal-note">${escape(proposal.note)}</textarea></label>`
    : proposal.note ? `<blockquote class="proposal-quote">${escape(proposal.note)}</blockquote>` : '';
  return `<div class="proposal-backdrop"><section class="proposal" role="dialog" aria-modal="true" aria-labelledby="proposal-title"><p class="proposal-label">Needs your confirmation${proposal.via ? ` · ${viaLabel(proposal.via)}` : ''}</p><h2 id="proposal-title">${accept ? 'Accept' : 'Request changes to'} "${escape(task.title)}"?</h2><p class="proposal-why">${escape(tool)} read ${escape(owner)}'s work package and prepared this review. Nothing is sent until you confirm.${accept ? ' GitHub pull request approval stays separate.' : ''}</p>${note}<div class="proposal-actions"><button class="text-button" data-action="proposal-dismiss">Not now</button><span class="session-spacer"></span>${editingProposal ? '' : '<button class="secondary" data-action="proposal-edit">Edit review</button>'}<button class="secondary" data-action="proposal-switch">${accept ? 'Request changes instead' : 'Accept instead'}</button><button data-action="proposal-confirm">${accept ? 'Accept package' : 'Request changes'}</button></div>${reviewProposals.length > 1 ? `<p class="proposal-more">${reviewProposals.length - 1} more waiting</p>` : ''}</section></div>`;
}

async function confirmProposal() {
  const proposal = reviewProposals[0];
  if (!proposal) return;
  const task = snapshot?.tasks.find(item => item.id === proposal.taskId);
  const note = (document.querySelector<HTMLTextAreaElement>('#proposal-note')?.value ?? proposal.note).trim();
  if (!task || task.status !== 'submitted') { reviewProposals.shift(); editingProposal = false; notice = 'That package changed since the review was proposed.'; render(); return; }
  if (proposal.action === 'changes' && !note) { editingProposal = true; notice = 'Say what needs to change.'; render(); return; }
  // The click sends the review as the person, never marked with the tool.
  if (proposal.action === 'accept') {
    await command(task, { type: 'accept-package' });
    if (note) await command(null, { type: 'post-message', taskId: task.id, body: note, ...(proposal.via ? { via: proposal.via } : {}) });
  } else await command(task, { type: 'request-changes', note });
  reviewProposals.shift(); editingProposal = false; render();
}
window.consoleConnect.onCliRequest(async request => {
  try {
    const tool = toolSchema.safeParse(request.tool);
    const result = await runCliCommand(request.argv, { cwd: request.cwd, taskId: request.taskId, tool: tool.success ? tool.data : undefined,
      holdAssignments: request.console === 'orchestrator' && autoRunActive() }, cliWorkspace);
    window.consoleConnect.replyToCli({ id: request.id, reply: { ok: true, ...result } });
    cliActivity.unshift({ at: Date.now(), text: activityLabel(request.argv, result.text), tool: tool.success ? tool.data : undefined });
    cliActivity.length = Math.min(cliActivity.length, cliActivityLimit);
    if (showOrchestrator) render();
  } catch (error) {
    window.consoleConnect.replyToCli({ id: request.id, reply: { ok: false, error: (error as Error).message } });
  }
});
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
  if (event.taskId === orchestratorKey && orchestrator) {
    orchestrator.output = (orchestrator.output + event.data).slice(-100000);
    orchestrator.lastOutputAt = Date.now();
    orchestratorTerminal?.write(event.data);
    return;
  }
  if (event.taskId !== terminalTaskId) return;
  terminalOutput = (terminalOutput + event.data).slice(-100000);
  terminalLastOutputAt = Date.now();
  if (terminalRenderSource === 'local') terminal?.write(event.data);
});
window.consoleConnect.onTerminalExit(event => {
  if (event.taskId === orchestratorKey && orchestrator) {
    const line = `\r\nProcess exited (${event.exitCode}).\r\n`;
    orchestrator.active = false; orchestrator.endedAt = Date.now(); orchestrator.output += line;
    orchestratorTerminal?.write(line);
    render();
    return;
  }
  if (event.taskId !== terminalTaskId) return;
  const ended = snapshot?.tasks.find(item => item.id === terminalTaskId);
  if (ended && ['running', 'changes_requested'].includes(ended.status) && !ended.draftPackage) {
    void command(null, { type: 'report-session', taskId: ended.id, state: 'exited', ...(terminalTool ? { via: terminalTool } : {}) }).catch(() => {});
  }
  terminalSessionActive = false;
  terminalEndedAt = Date.now();
  waitingSince = 0; stallReported = false;
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
// xterm measures glyphs when a terminal opens, so the terminal face is loaded before anything renders.
void document.fonts.load(`13px ${terminalFontFamily}`).catch(() => undefined).finally(render);
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
