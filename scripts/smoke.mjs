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
  await evaluate(`document.querySelector('#host input[name=owner]').value='Alex'; document.querySelector('#host input[name=name]').value='Smoke team'; document.querySelector('#host input[name=repository]').value='https://github.com/example/demo'; document.querySelector('#host').requestSubmit();`);
  let visible = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    visible = await evaluate('document.body.innerText');
    if (visible.includes('Smoke team') && visible.includes('New task')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!visible.includes('Smoke team') || !visible.includes('New task')) throw new Error(`Host form failed: ${visible.slice(0, 300)}`);
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
  const prepared = await evaluate(`(async () => { const c = JSON.parse(localStorage.getItem('console-connect.connection')); return window.consoleConnect.prepareDecision({ ...c, decisionId: ${JSON.stringify(decisionId)}, repositoryPath: ${JSON.stringify(repository)} }); })()`);
  if (!(await readFile(prepared, 'utf8')).includes('Use OAuth for sign-in.')) throw new Error('Decision file was not prepared.');
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/screenshot.png', Buffer.from(captured.data, 'base64'));
  }
  const host = JSON.parse(await evaluate("localStorage.getItem('console-connect.connection')"));
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
    await evaluate(`(async () => { const c = JSON.parse(localStorage.getItem('console-connect.connection')); await window.consoleConnect.runTask({ ...c, taskId: ${JSON.stringify(providerTaskId)}, tool: ${JSON.stringify(tool)}, repositoryPath: ${JSON.stringify(repository)} }); })()`);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}]?.exitCode === 0`)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const result = await evaluate(`window.__providerResults[${JSON.stringify(providerTaskId)}]`);
    if (result?.exitCode !== 0 || !/\d+\.\d+/.test(result.output)) throw new Error(`${tool} did not launch in Electron's terminal.`);
  }
  const taskId = crypto.randomUUID();
  const hostState = await hostCall('/state');
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId,
    title: 'Watch controlled output', description: '', assigneeId: hostState.memberId });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'approve-task', taskId, revision: 1 });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'start-task', taskId, revision: 2, tool: 'codex' });
  await hostCall(`/terminal/${taskId}/share`, { enabled: true });
  const invite = await hostCall('/invites', { role: 'reviewer' });
  await evaluate("window.__smokeWorkspaceConnected = false; window.__smokeWorkspaceRevision = 0; window.consoleConnect.onWorkspaceConnected(() => { window.__smokeWorkspaceConnected = true; }); window.consoleConnect.onWorkspaceRevision(revision => { window.__smokeWorkspaceRevision = revision; });");
  await evaluate(`document.querySelector('[data-action="disconnect"]').click(); document.querySelector('#join input[name=url]').value=${JSON.stringify(host.url)}; document.querySelector('#join input[name=name]').value='Blair'; document.querySelector('#join input[name=code]').value=${JSON.stringify(invite.code)}; document.querySelector('#join').requestSubmit();`);
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
  await evaluate("document.querySelector('[data-action=workspace-chat]').click(); document.querySelector('#workspace-message textarea[name=body]').value='Can someone review today?'; document.querySelector('#workspace-message').requestSubmit();");
  for (let attempt = 0; attempt < 15; attempt++) {
    if ((await hostCall('/state')).messages.some(message => message.body === 'Can someone review today?')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await hostCall('/state')).messages.some(message => message.body === 'Can someone review today?')) throw new Error('Workspace message was not shared.');
  await evaluate(`document.querySelector('[data-task="${taskId}"]').click(); document.querySelector('[data-action="watch-terminal"]').click();`);
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
  console.log('Electron hosted, launched all three provider version checks, prepared a decision file, delivered a live task update, shared a workspace message, and displayed view-only terminal output to a joined reviewer.');
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
