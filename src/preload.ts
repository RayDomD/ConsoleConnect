import { contextBridge, ipcRenderer } from 'electron';
type WorkspaceInput = { url: string; token: string; mode?: 'local' } | {
  mode: 'supabase'; projectUrl: string; publishableKey: string; workspaceId: string; token: string;
};

contextBridge.exposeInMainWorld('consoleConnect', {
  host: (input: { name: string; repository: string; owner: string }) => ipcRenderer.invoke('host', input),
  request: (input: { url: string; token: string; path: string; body?: unknown }) => ipcRenderer.invoke('request', input),
  watchWorkspace: (input: { url: string; token: string }) => ipcRenderer.invoke('watch-workspace', input),
  stopWatchingWorkspace: () => ipcRenderer.send('stop-watch-workspace'),
  onWorkspaceConnected: (callback: () => void) => ipcRenderer.on('workspace-connected', () => callback()),
  onWorkspaceRevision: (callback: (revision: number) => void) => ipcRenderer.on('workspace-revision', (_event, revision) => callback(revision)),
  onWorkspaceConnectionError: (callback: (message: string) => void) => ipcRenderer.on('workspace-connection-error', (_event, message) => callback(message)),
  chooseRepository: () => ipcRenderer.invoke('choose-repository'),
  copyText: (value: string) => ipcRenderer.invoke('copy-text', value),
  notifyTeamChat: (input: { title: string; body: string }) => ipcRenderer.invoke('notify-team-chat', input),
  onOpenTeamChatNotification: (callback: () => void) => ipcRenderer.on('open-team-chat-notification', () => callback()),
  openOAuth: (input: { projectUrl: string; url: string }) => ipcRenderer.invoke('open-oauth', input),
  validateRepository: (input: { repositoryPath: string; workspaceRepository: string }) => ipcRenderer.invoke('validate-repository', input),
  prepareDecision: (input: WorkspaceInput & { decisionId: string; repositoryPath: string }) => ipcRenderer.invoke('prepare-decision', input),
  runTask: (input: WorkspaceInput & { taskId: string; tool: string; repositoryPath: string }) => ipcRenderer.invoke('run-task', input),
  runOrchestrator: (input: { repositoryPath: string; workspaceRepository: string; tool: string }) => ipcRenderer.invoke('run-orchestrator', input),
  setTerminalSharing: (input: { taskId: string; enabled: boolean }) => ipcRenderer.invoke('set-terminal-sharing', input),
  watchTerminal: (input: { url: string; token: string; taskId: string }) => ipcRenderer.invoke('watch-terminal', input),
  stopWatchingTerminal: (input: { taskId: string }) => ipcRenderer.send('stop-watch-terminal', input),
  onSharedTerminalData: (callback: (event: { taskId: string; data: string }) => void) => ipcRenderer.on('shared-terminal-data', (_event, value) => callback(value)),
  onSharedTerminalEnded: (callback: (event: { taskId: string }) => void) => ipcRenderer.on('shared-terminal-ended', (_event, value) => callback(value)),
  onTerminalSharingError: (callback: (event: { taskId: string }) => void) => ipcRenderer.on('terminal-sharing-error', (_event, value) => callback(value)),
  terminalWrite: (input: { taskId: string; data: string }) => ipcRenderer.send('terminal-write', input),
  terminalResize: (input: { taskId: string; cols: number; rows: number }) => ipcRenderer.send('terminal-resize', input),
  terminalKill: (input: { taskId: string }) => ipcRenderer.send('terminal-kill', input),
  worktreeChanges: (input: { taskId: string }) => ipcRenderer.invoke('worktree-changes', input),
  worktreeFacts: (input: { taskId: string }) => ipcRenderer.invoke('worktree-facts', input),
  cliFolder: () => ipcRenderer.invoke('cli-folder'),
  onCliRequest: (callback: (request: { id: string; argv: string[]; cwd: string; tool?: string; console?: string; taskId: string | null }) => void) =>
    ipcRenderer.on('cli-request', (_event, value) => callback(value)),
  replyToCli: (value: { id: string; reply: { ok: true; text: string; data: unknown } | { ok: false; error: string } }) => ipcRenderer.send('cli-reply', value),
  onTerminalData: (callback: (event: { taskId: string; data: string }) => void) => ipcRenderer.on('terminal-data', (_event, value) => callback(value)),
  onTerminalExit: (callback: (event: { taskId: string; exitCode: number }) => void) => ipcRenderer.on('terminal-exit', (_event, value) => callback(value)),
});
