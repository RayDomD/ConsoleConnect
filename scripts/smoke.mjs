import electron from 'electron';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const directory = await mkdtemp(join(tmpdir(), 'console-connect-smoke-'));
const repository = join(directory, 'repo');
const git = promisify(execFile);
await git('git', ['init', repository]);
await git('git', ['-C', repository, 'remote', 'add', 'origin', 'https://github.com/example/demo']);
await git('git', ['-C', repository, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com',
  'commit', '--allow-empty', '-m', 'Initial']);
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const packaged = process.argv.includes('--packaged');
const executable = packaged ? join(process.cwd(), 'release', 'win-unpacked', 'Console Connect.exe') : electron;
const child = spawn(executable, [...(packaged ? [] : ['.']), `--remote-debugging-port=${port}`], {
  env: { ...process.env, CONSOLE_CONNECT_TEST_DATA: directory, CONSOLE_CONNECT_TEST_PROVIDER_VERSION: '1' }, stdio: 'ignore',
});

try {
  let page;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      page = (await response.json()).find(item => item.type === 'page');
      if (page) break;
    } catch { /* Wait for Electron. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!page) throw new Error('Desktop window did not open.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let nextId = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const onMessage = data => {
      const reply = JSON.parse(data.toString());
      if (reply.id !== id) return;
      socket.off('message', onMessage);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails)));
      else resolve(reply.result);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('#host'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('#hosted-host') && document.querySelector('#hosted-join'))"))) {
    throw new Error('Hosted workspace setup is missing from the desktop window.');
  }
  if (!(await evaluate("Boolean(document.querySelector('#join-invitation [data-action=sign-in-github]') && document.querySelector('#join-invitation [data-action=sign-in-google]'))"))) {
    throw new Error('Invitation sign-in options are missing.');
  }
  const helpWorks = await evaluate(`(() => {
    const ids = ['join-invitation', 'host', 'join', 'hosted-host', 'hosted-join'];
    if (!ids.every(id => document.querySelector('#' + id + ' [data-action=connection-help]'))) return false;
    const input = document.querySelector('#host input[name=owner]');
    input.value = 'Alex';
    const button = document.querySelector('#host [data-action=connection-help]');
    button.click();
    const opened = !document.querySelector('#help-host').hidden && button.getAttribute('aria-expanded') === 'true';
    button.click();
    return opened && document.querySelector('#help-host').hidden && input.value === 'Alex';
  })()`);
  if (!helpWorks) throw new Error('Connection help is missing or clears the form.');
  if (!(await evaluate("getComputedStyle(document.querySelector('#host [data-action=connection-help]')).width === '44px'"))) {
    throw new Error('Connection help target is too small.');
  }
  const rejectedOAuth = await evaluate("window.consoleConnect.openOAuth({ projectUrl: 'https://example.supabase.co', url: 'https://other.example.com/auth/v1/authorize' }).then(() => false, () => true)");
  if (!rejectedOAuth) throw new Error('External OAuth URLs were not rejected.');
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/dashboard.png', Buffer.from(captured.data, 'base64'));
    await evaluate("document.querySelector('#host [data-action=connection-help]').click()");
    const helpCaptured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/connection-help.png', Buffer.from(helpCaptured.data, 'base64'));
    await evaluate("document.querySelector('#host [data-action=connection-help]').click()");
  }
  await evaluate("document.querySelector('[data-action=settings]').click()");
  if (!(await evaluate("Boolean(document.querySelector('#supabase-settings') && document.querySelector('#theme') && document.querySelector('.settings-body [data-action=sign-in-github]') && document.querySelector('.settings-body [data-action=sign-in-google]'))"))) {
    throw new Error('Settings did not expose appearance and Supabase connection defaults.');
  }
  if (!(await evaluate("Boolean(document.querySelector('#chat-notifications-enabled') && document.querySelector('#chat-notifications-preview') && window.consoleConnect.notifyTeamChat)"))) {
    throw new Error('Team chat notification controls are missing.');
  }
  await evaluate("document.querySelector('#chat-notifications-preview').click()");
  if (!(await evaluate("JSON.parse(localStorage.getItem('console-connect.chat-notifications')).showPreview === false"))) {
    throw new Error('Notification preview preference was not saved.');
  }
  await evaluate("document.querySelector('#supabase-settings').requestSubmit()");
  if (!(await evaluate("document.querySelector('.notice')?.getAttribute('role') === 'status'"))) {
    throw new Error('Saved settings notice is not announced as a status.');
  }
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/settings.png', Buffer.from(captured.data, 'base64'));
  }
  await evaluate("document.querySelector('[data-action=settings-back]').click()");
  await evaluate(`document.querySelector('#host input[name=owner]').value='Alex'; document.querySelector('#host input[name=name]').value='Smoke team'; document.querySelector('#host input[name=repository]').value='https://github.com/example/demo'; document.querySelector('#host').requestSubmit();`);
  let visible = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    visible = await evaluate('document.body.innerText');
    if (visible.includes('Smoke team') && await evaluate("Boolean(document.querySelector('[data-action=new-task]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!visible.includes('Smoke team') || !(await evaluate("Boolean(document.querySelector('[data-action=new-task]'))"))) throw new Error(`Host form failed: ${visible.slice(0, 300)}`);
  await evaluate("document.querySelector('[data-action=disconnect]').click()");
  if (!(await evaluate("Boolean(document.querySelector('[data-action=open-project]'))"))) throw new Error('Dashboard did not retain the project.');
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/dashboard-project.png', Buffer.from(captured.data, 'base64'));
  }
  await evaluate("document.querySelector('[data-action=open-project]').click()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('[data-action=new-task]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('[data-action=new-task]'))"))) throw new Error('Saved project did not reopen.');
  await evaluate(`document.querySelector('[data-action="new-task"]').click(); document.querySelector('#new-task input[name=title]').value='Review login'; document.querySelector('#new-task textarea[name=description]').value='Check the form'; document.querySelector('#new-task').requestSubmit();`);
  for (let attempt = 0; attempt < 30; attempt++) {
    visible = await evaluate('document.body.innerText');
    if (visible.includes('Review login')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!visible.includes('Review login')) throw new Error('Task creation did not appear in the desktop window.');
  await evaluate(`document.querySelector('[data-action="propose-decision"]').click(); document.querySelector('#decision input[name=title]').value='Use OAuth'; document.querySelector('#decision textarea[name=body]').value='Use OAuth for sign-in.'; document.querySelector('#decision').requestSubmit();`);
  let decisionId;
  for (let attempt = 0; attempt < 30; attempt++) {
    const stateText = await evaluate(`(async () => { const c = JSON.parse(localStorage.getItem('console-connect.connection')); return JSON.stringify((await window.consoleConnect.request({ ...c, path: '/state' })).data); })()`);
    decisionId = JSON.parse(stateText).decisions[0]?.id;
    if (decisionId) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!decisionId) throw new Error('Decision proposal did not reach the host.');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.decision [data-action=enter-decision-commit]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (await evaluate("Boolean(document.querySelector('.decision input[data-commit-for]'))")) throw new Error('Commit field showed before the decision was prepared.');
  await evaluate("document.querySelector('.decision [data-action=enter-decision-commit]').click()");
  if (!(await evaluate("document.querySelector('.decision input[data-commit-for]')?.labels?.[0]?.textContent?.includes('Pushed commit SHA')"))) {
    throw new Error('Decision commit field has no visible label.');
  }
  const prepared = await evaluate(`(async () => { const c = JSON.parse(localStorage.getItem('console-connect.connection')); return window.consoleConnect.prepareDecision({ ...c, decisionId: ${JSON.stringify(decisionId)}, repositoryPath: ${JSON.stringify(repository)} }); })()`);
  if (!(await readFile(prepared, 'utf8')).includes('Use OAuth for sign-in.')) throw new Error('Decision file was not prepared.');
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/screenshot.png', Buffer.from(captured.data, 'base64'));
  }
  const host = JSON.parse(await evaluate("localStorage.getItem('console-connect.connection')"));
  await evaluate(`(() => { const projects = JSON.parse(localStorage.getItem('console-connect.projects')); projects[0].localRepositoryPath = ${JSON.stringify(repository)}; localStorage.setItem('console-connect.projects', JSON.stringify(projects)); })()`);
  await call('Page.reload');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('[data-action=open-project]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate(`document.body.innerText.includes(${JSON.stringify(repository)})`))) throw new Error('The saved Git folder did not survive a restart.');
  await evaluate("document.querySelector('[data-action=open-project]').click()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('[data-action=new-task]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('[data-action=new-task]'))"))) throw new Error('Saved project did not reopen after restart.');
  const hostCall = async (path, body) => {
    const response = await fetch(`${host.url}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path}: ${result.error}`);
    return result;
  };
  await evaluate("window.__providerResults = {}; window.consoleConnect.onTerminalData(event => { const result = window.__providerResults[event.taskId] ??= { output: '' }; result.output += event.data; }); window.consoleConnect.onTerminalExit(event => { const result = window.__providerResults[event.taskId] ??= { output: '' }; result.exitCode = event.exitCode; });");
  const providerOwner = (await hostCall('/state')).memberId;
  for (const tool of ['codex', 'claude', 'antigravity']) {
    const providerTaskId = crypto.randomUUID();
    await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId: providerTaskId,
      title: `Check ${tool} launch`, description: '', assigneeId: providerOwner });
    await hostCall('/commands', { id: crypto.randomUUID(), type: 'approve-task', taskId: providerTaskId, revision: 1 });
    if (tool === 'claude') {
      // The row can render before the approval does; the tool picker only appears once the task is ready.
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate(`(() => { const row = document.querySelector('[data-task="${providerTaskId}"]'); if (!row) return false; row.click(); document.querySelector('[data-tab=console]')?.click(); return Boolean(document.querySelector('#tool')); })()`)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await evaluate(`document.querySelector('#tool').value='claude'; document.querySelector('[data-action=start]').click()`);
    } else {
      await evaluate(`(async () => { const c = JSON.parse(localStorage.getItem('console-connect.connection')); await window.consoleConnect.runTask({ ...c, taskId: ${JSON.stringify(providerTaskId)}, tool: ${JSON.stringify(tool)}, repositoryPath: ${JSON.stringify(repository)} }); })()`);
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}]?.exitCode === 0`)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const result = await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}]`);
    if (result?.exitCode !== 0 || !/\d+\.\d+/.test(result.output)) throw new Error(`${tool} did not launch in Electron's terminal.`);
    if (tool === 'claude') {
      await evaluate(`document.querySelector('[data-task="${providerTaskId}"]').click()`);
      if (!(await evaluate("Boolean(document.querySelector('[data-action=start]'))"))) throw new Error('An exited console cannot be relaunched from the task.');
      if (process.argv.includes('--screenshot')) {
        const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile('dist/console-tab.png', Buffer.from(captured.data, 'base64'));
      }
      await evaluate("document.querySelector('[data-tab=package]').click()");
      if (await evaluate("Boolean(document.querySelector('#terminal'))")) throw new Error('Console remained inside the package tab.');
      await evaluate("document.querySelector('[data-tab=console]').click()");
      if (!(await evaluate("Boolean(document.querySelector('#terminal'))"))) throw new Error('Console output did not return in its tab.');
      await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}] = { output: '' }`);
      await evaluate("document.querySelector('#tool').value='claude'; document.querySelector('[data-action=start]').click()");
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}]?.exitCode === 0`)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if ((await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}]`))?.exitCode !== 0) throw new Error('The second console launch failed.');
      await evaluate("window.__terminalBefore = document.querySelector('#terminal .xterm'); document.querySelector('#terminal .xterm-helper-textarea').focus()");
      const updateTaskId = crypto.randomUUID();
      await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId: updateTaskId,
        title: 'Keep console mounted', description: '', assigneeId: null });
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate("document.body.innerText.includes('Keep console mounted')")) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!(await evaluate("window.__terminalBefore === document.querySelector('#terminal .xterm') && document.activeElement === document.querySelector('#terminal .xterm-helper-textarea')"))) {
        throw new Error('Workspace update replaced or unfocused the active console.');
      }
    }
  }
  const taskId = crypto.randomUUID();
  const hostState = await hostCall('/state');
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId,
    title: 'Watch controlled output', description: '', assigneeId: hostState.memberId });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'approve-task', taskId, revision: 1 });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'start-task', taskId, revision: 2, tool: 'codex' });
  await hostCall(`/terminal/${taskId}/share`, { enabled: true });
  const invite = await hostCall('/invites', { role: 'reviewer' });
  const invitation = new URL('consoleconnect://invite/local');
  invitation.searchParams.set('host', host.url);
  invitation.searchParams.set('code', invite.code);
  await evaluate("window.__smokeWorkspaceConnected = false; window.__smokeWorkspaceRevision = 0; window.consoleConnect.onWorkspaceConnected(() => { window.__smokeWorkspaceConnected = true; }); window.consoleConnect.onWorkspaceRevision(revision => { window.__smokeWorkspaceRevision = revision; });");
  await evaluate(`document.querySelector('[data-action="disconnect"]').click(); document.querySelector('[data-action="add-project"]').click(); document.querySelector('#join-invitation input[name=link]').value=${JSON.stringify(invitation.toString())}; document.querySelector('#join-invitation input[name=name]').value='Blair'; document.querySelector('#join-invitation').requestSubmit();`);
  for (let attempt = 0; attempt < 30; attempt++) {
    visible = await evaluate('document.body.innerText');
    if (visible.includes('Watch controlled output')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!visible.includes('Watch controlled output')) throw new Error('Reviewer did not see the shared task.');
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await evaluate('window.__smokeWorkspaceConnected')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate('window.__smokeWorkspaceConnected'))) throw new Error('Workspace event connection did not open.');
  const liveTaskId = crypto.randomUUID();
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId: liveTaskId,
    title: 'Live arrival', description: '', assigneeId: null });
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await evaluate("document.body.innerText.includes('Live arrival')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("document.body.innerText.includes('Live arrival')"))) throw new Error('Reviewer did not see the live workspace update.');
  await evaluate(`document.querySelector('[data-task="${liveTaskId}"]').click(); document.querySelector('[data-action=toggle-assign-menu]').click()`);
  if (!(await evaluate(`document.querySelector('.menu [data-member="${hostState.memberId}"]')?.textContent.includes('Alex')`))) throw new Error('Assign menu did not list the teammate.');
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/assign-menu.png', Buffer.from(captured.data, 'base64'));
  }
  await evaluate(`document.querySelector('.menu [data-member="${hostState.memberId}"]').click()`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await hostCall('/state')).tasks.find(task => task.id === liveTaskId)?.assigneeId === hostState.memberId) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if ((await hostCall('/state')).tasks.find(task => task.id === liveTaskId)?.assigneeId !== hostState.memberId) throw new Error('Assign menu did not assign the task.');
  const incomingMessageId = crypto.randomUUID();
  await hostCall('/commands', { id: incomingMessageId, type: 'post-message', body: 'Can someone test invitation expiry?' });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.chat-link .chat-count'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('.chat-link .chat-count') && document.querySelector('.chat-toast'))"))) {
    const state = await evaluate("JSON.stringify({ badge: document.querySelector('.chat-link .chat-count')?.textContent, toast: document.querySelector('.chat-toast')?.textContent, visible: document.body.innerText.slice(-700) })");
    throw new Error(`Incoming team message did not show an unread badge and preview: ${state}`);
  }
  await evaluate("document.querySelector('.topbar [data-action=open-chat-drawer]').click()");
  if (!(await evaluate("Boolean(document.querySelector('.chat-drawer') && !document.querySelector('.chat-link .chat-count'))"))) {
    throw new Error('Chat drawer did not open and mark messages read.');
  }
  if (process.argv.includes('--screenshot')) {
    await new Promise(resolve => setTimeout(resolve, 400)); // Let the drawer entrance finish.
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/team-chat-drawer.png', Buffer.from(captured.data, 'base64'));
  }
  await evaluate(`document.querySelector('[data-action=reply-message][data-message="${incomingMessageId}"]').click(); document.querySelector('#team-chat-body').value='I can test it.'; document.querySelector('#workspace-message').requestSubmit()`);
  let replyId;
  for (let attempt = 0; attempt < 30; attempt++) {
    replyId = (await hostCall('/state')).messages.find(message => message.replyToId === incomingMessageId)?.id;
    if (replyId) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!replyId) throw new Error('Reply did not reach the team chat.');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('[data-action=edit-message][data-message="${replyId}"]'))`)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await evaluate(`document.querySelector('[data-action=edit-message][data-message="${replyId}"]').click(); document.querySelector('.chat-edit textarea').value='I tested the expired invite.'; document.querySelector('.chat-edit').requestSubmit()`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await hostCall('/state')).messages.find(message => message.id === replyId)?.body === 'I tested the expired invite.') break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if ((await hostCall('/state')).messages.find(message => message.id === replyId)?.body !== 'I tested the expired invite.') throw new Error('Edit did not reach the team chat.');
  // Wait for the renderer's own refresh, or Unsend sends the pre-edit version and gets a 409.
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`Boolean(!document.querySelector('.chat-edit') && document.querySelector('[data-action=unsend-message][data-message="${replyId}"]') && document.body.innerText.includes('I tested the expired invite.'))`)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await evaluate(`window.confirm = () => true; document.querySelector('[data-action=unsend-message][data-message="${replyId}"]').click()`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await hostCall('/state')).messages.find(message => message.id === replyId)?.deletedAt) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await hostCall('/state')).messages.find(message => message.id === replyId)?.deletedAt) throw new Error('Unsend did not reach the team chat.');
  await evaluate("document.querySelector('[data-action=close-chat-drawer]').click()");
  await evaluate("document.querySelector('[data-action=workspace-chat]').click(); document.querySelector('#workspace-message textarea[name=body]').value='Can someone review today?'; document.querySelector('#workspace-message').requestSubmit();");
  const lastActions = "[...document.querySelectorAll('#team-chat-stream .chat-message')].at(-1)?.querySelector('.chat-message-actions')";
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.querySelector('#team-chat-stream')?.innerText.includes('Can someone review today?')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (await evaluate(`getComputedStyle(${lastActions}).opacity !== '0'`)) throw new Error('Message actions show without hover or focus.');
  await evaluate(`${lastActions}.querySelector('button').focus()`);
  await new Promise(resolve => setTimeout(resolve, 250)); // Let the reveal finish.
  if (await evaluate(`getComputedStyle(${lastActions}).opacity !== '1'`)) throw new Error('Message actions did not show on keyboard focus.');
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/team-chat.png', Buffer.from(captured.data, 'base64'));
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    if ((await hostCall('/state')).messages.some(message => message.body === 'Can someone review today?')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await hostCall('/state')).messages.some(message => message.body === 'Can someone review today?')) throw new Error('Workspace message was not shared.');
  await evaluate(`document.querySelector('[data-task="${taskId}"]').click(); document.querySelector('[data-tab=console]').click(); document.querySelector('[data-action="watch-terminal"]').click();`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('[data-action=stop-watching]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('[data-action=stop-watching]'))"))) throw new Error('View-only terminal did not open.');
  await evaluate("window.consoleConnect.onSharedTerminalData(event => { window.__smokeSharedOutput = event.data; })");
  await hostCall(`/terminal/${taskId}/output`, { chunk: 'SHARED_OUTPUT_OK' });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("window.__smokeSharedOutput === 'SHARED_OUTPUT_OK'")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("window.__smokeSharedOutput === 'SHARED_OUTPUT_OK'"))) throw new Error('Shared output did not reach the desktop window.');
  await hostCall(`/terminal/${taskId}/share`, { enabled: false });
  socket.close();
  console.log('Electron hosted, launched provider checks, prepared a decision, handled unread chat, reply/edit/unsend, live updates, and view-only terminal output.');
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
