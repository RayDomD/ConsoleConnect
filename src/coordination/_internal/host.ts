import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { applyCommand } from './commands';
import { commandSchema, RequestError, snapshot, type WorkspaceState } from './protocol';
import { openStore } from './store';
import { getPullRequestStatus, verifyDecisionDocument, type PullRequestStatus } from '../../github';
import { repositoryIdentity } from '../../repository';
import { renderDecisionDocument } from '../../decisions';

const MAX_BODY_BYTES = 128 * 1024;
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'The update is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'Send valid JSON.'); }
}

export async function startHost(options: {
  directory: string; name: string; repository: string; owner: string; port?: number; bind?: string;
  lookupPullRequest?: (url: string) => Promise<PullRequestStatus>;
  verifyDecisionDocument?: (repository: string, decisionId: string, commitSha: string, expected: string) => Promise<boolean>;
}) {
  const store = await openStore(options.directory);
  const token = secret();
  let existing: WorkspaceState | null;
  try { existing = await store.read(); } catch (error) { await store.close(); throw error; }
  const memberId = existing?.members.find(member => member.role === 'owner')?.id ?? randomUUID();
  let state: WorkspaceState = existing ?? {
    workspace: { id: randomUUID(), name: options.name, repository: options.repository }, revision: 1,
    members: [{ id: memberId, name: options.owner, role: 'owner' }], tasks: [], messages: [], decisions: [],
    credentials: { [hash(token)]: memberId }, invites: {}, appliedCommands: {},
  };
  state.appliedCommands ??= {};
  state.messages ??= [];
  state.decisions ??= [];
  for (const decision of state.decisions) decision.affectedTaskIds ??= [];
  state.credentials[hash(token)] = memberId;
  try { await store.save(state); } catch (error) { await store.close(); throw error; }
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<ServerResponse>();
  const sharedTerminals = new Set<string>();
  const terminalListeners = new Map<string, Set<ServerResponse>>();
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = tail.then(async () => {
      const previous = structuredClone(state);
      try {
        const result = await action();
        if (JSON.stringify(state) !== JSON.stringify(previous)) {
          await store.save(state);
          const event = `data: ${JSON.stringify({ revision: state.revision })}\n\n`;
          for (const listener of listeners) listener.write(event);
        }
        return result;
      } catch (error) { state = previous; throw error; }
    });
    tail = next.catch(() => {});
    return next;
  }
  const server = createServer((request, response) => {
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    if (request.method === 'GET' && request.url === '/events') {
      if (request.headers.origin) { send(403, { error: 'Use the desktop app to connect.' }); return; }
      const actorId = state.credentials[hash(request.headers.authorization?.replace(/^Bearer /, '') ?? '')];
      if (!state.members.some(member => member.id === actorId)) { send(401, { error: 'Reconnect with a valid workspace invitation.' }); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      response.flushHeaders();
      listeners.add(response);
      response.on('close', () => listeners.delete(response));
      return;
    }
    const terminalEvents = /^\/terminal\/([0-9a-f-]{36})\/events$/i.exec(request.url ?? '');
    if (request.method === 'GET' && terminalEvents) {
      if (request.headers.origin) { send(403, { error: 'Use the desktop app to connect.' }); return; }
      const actorId = state.credentials[hash(request.headers.authorization?.replace(/^Bearer /, '') ?? '')];
      if (!state.members.some(member => member.id === actorId)) { send(401, { error: 'Reconnect with a valid workspace invitation.' }); return; }
      const taskId = terminalEvents[1]!;
      if (!state.tasks.some(item => item.id === taskId)) { send(404, { error: 'Task not found.' }); return; }
      if (!sharedTerminals.has(taskId)) { send(409, { error: 'The owner is not sharing this terminal.' }); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      response.flushHeaders();
      const viewers = terminalListeners.get(taskId) ?? new Set<ServerResponse>();
      viewers.add(response);
      terminalListeners.set(taskId, viewers);
      response.on('close', () => viewers.delete(response));
      return;
    }
    void serialized(async () => {
      if (request.headers.origin) throw new RequestError(403, 'Use the desktop app to connect.');
      if (request.method === 'POST' && request.url === '/join') {
        const input = z.object({ code: z.string().min(1).max(100), name: z.string().trim().min(1).max(80) }).parse(await body(request));
        const invite = state.invites[hash(input.code)];
        if (!invite || invite.expiresAt < Date.now()) throw new RequestError(403, 'This invitation has expired or has already been used.');
        const member = { id: randomUUID(), name: input.name, role: invite.role };
        const credential = secret();
        state.members.push(member);
        state.credentials[hash(credential)] = member.id;
        delete state.invites[hash(input.code)];
        state.revision += 1;
        return { token: credential, memberId: member.id };
      }
      const actorId = state.credentials[hash(request.headers.authorization?.replace(/^Bearer /, '') ?? '')];
      const actor = state.members.find(member => member.id === actorId);
      if (!actor) throw new RequestError(401, 'Reconnect with a valid workspace invitation.');
      if (request.method === 'GET' && request.url === '/state') return {
        ...snapshot(state, actor.id), sharedTerminalTaskIds: [...sharedTerminals],
      };
      const terminalOperation = /^\/terminal\/([0-9a-f-]{36})\/(share|output)$/i.exec(request.url ?? '');
      if (request.method === 'POST' && terminalOperation) {
        const taskId = terminalOperation[1]!;
        const task = state.tasks.find(item => item.id === taskId);
        if (!task) throw new RequestError(404, 'Task not found.');
        if (task.assigneeId !== actor.id) throw new RequestError(403, 'Only the session owner can share terminal output.');
        if (terminalOperation[2] === 'share') {
          const input = z.object({ enabled: z.boolean() }).parse(await body(request));
          if (input.enabled && task.status !== 'running') throw new RequestError(409, 'Only a running task can share its terminal.');
          if (input.enabled) sharedTerminals.add(taskId);
          else {
            sharedTerminals.delete(taskId);
            for (const viewer of terminalListeners.get(taskId) ?? []) viewer.end();
            terminalListeners.delete(taskId);
          }
          state.revision += 1;
          return { shared: input.enabled };
        }
        if (!sharedTerminals.has(taskId)) throw new RequestError(409, 'Enable terminal sharing first.');
        const input = z.object({ chunk: z.string().max(4096) }).parse(await body(request));
        const event = `data: ${JSON.stringify({ taskId, data: input.chunk })}\n\n`;
        for (const viewer of terminalListeners.get(taskId) ?? []) viewer.write(event);
        return { delivered: true };
      }
      const pullRequest = /^\/pull-request\/([0-9a-f-]{36})$/i.exec(request.url ?? '');
      if (request.method === 'GET' && pullRequest) {
        const task = state.tasks.find(item => item.id === pullRequest[1]);
        if (!task) throw new RequestError(404, 'Task not found.');
        const url = task.package?.pullRequestUrl;
        if (!url) throw new RequestError(409, 'This package has no linked pull request.');
        if (repositoryIdentity(url) !== repositoryIdentity(state.workspace.repository)) {
          throw new RequestError(409, 'The pull request belongs to a different repository.');
        }
        let latest: PullRequestStatus;
        try { latest = await (options.lookupPullRequest ?? getPullRequestStatus)(url); }
        catch { throw new RequestError(503, 'GitHub status is unavailable. Check GitHub CLI authentication on the host.'); }
        if (latest.url !== url) throw new RequestError(503, 'GitHub returned a different pull request.');
        if (JSON.stringify(task.pullRequestStatus) !== JSON.stringify(latest)) {
          task.pullRequestStatus = latest;
          if (latest.mergedAt && task.status === 'accepted') task.status = 'completed';
          task.revision += 1;
          state.revision += 1;
        }
        return { ...latest, taskStatus: task.status };
      }
      if (request.method === 'POST' && request.url === '/invites') {
        if (actor.role !== 'owner') throw new RequestError(403, 'Only the host can invite members.');
        const input = z.object({ role: z.enum(['reviewer', 'contributor']) }).parse(await body(request));
        const code = secret();
        state.invites[hash(code)] = { role: input.role, expiresAt: Date.now() + INVITE_LIFETIME_MS };
        return { code };
      }
      if (request.method === 'POST' && request.url === '/commands') {
        const command = commandSchema.parse(await body(request));
        const digest = hash(JSON.stringify(command));
        const prior = state.appliedCommands[command.id];
        if (prior) {
          if (prior.actorId !== actor.id || prior.digest !== digest) throw new RequestError(409, 'This operation ID was already used.');
          return { revision: state.revision };
        }
        if (command.type === 'approve-decision') {
          if (actor.role === 'contributor') throw new RequestError(403, 'Only an owner or reviewer can approve decisions.');
          const decision = state.decisions.find(item => item.id === command.decisionId);
          if (!decision) throw new RequestError(404, 'Decision not found.');
          if (decision.status !== 'proposed') throw new RequestError(409, 'This decision is already official.');
          if (decision.supersedesId && !state.decisions.some(item => item.id === decision.supersedesId && item.status === 'official')) {
            throw new RequestError(409, 'The decision being replaced has changed.');
          }
          let published: boolean;
          try { published = await (options.verifyDecisionDocument ?? verifyDecisionDocument)(
            state.workspace.repository, decision.id, command.commitSha, renderDecisionDocument(decision)); }
          catch (error) {
            if ((error as Error).message.includes('HTTP 404')) throw new RequestError(409, 'Push the decision file to GitHub before approving it.');
            throw new RequestError(503, 'Could not verify the decision file on GitHub. Check the host GitHub CLI login.');
          }
          if (!published) throw new RequestError(409, 'The published decision file does not match the proposal.');
        }
        const next = structuredClone(state);
        applyCommand(next, actor, command);
        next.revision += 1;
        next.appliedCommands[command.id] = { actorId: actor.id, digest };
        state = next;
        return { revision: state.revision };
      }
      throw new RequestError(404, 'Unknown workspace operation.');
    }).then(data => send(200, data)).catch(error => {
      send(error instanceof RequestError ? error.status : error instanceof z.ZodError ? 400 : 500,
        { error: error instanceof RequestError ? error.message : error instanceof z.ZodError ? 'The update has invalid fields.' : 'The workspace could not save this update.' });
    });
  });
  server.requestTimeout = 10_000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, options.bind ?? '127.0.0.1', resolve);
    });
  } catch (error) { await store.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Host did not receive a network port.');
  let closed = false;
  return {
    url: `http://${options.bind ?? '127.0.0.1'}:${address.port}`, token,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const listener of listeners) listener.end();
      for (const viewers of terminalListeners.values()) for (const viewer of viewers) viewer.end();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await tail;
      await store.close();
    },
  };
}
