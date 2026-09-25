import electron from 'electron';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
// Its own pipe, so the CLI check never reaches a real Console Connect the person has open.
const cliPipe = process.platform === 'win32' ? `\\\\.\\pipe\\cc-smoke-${port}` : join(directory, 'cli.sock');
const executable = packaged ? join(process.cwd(), 'release', 'win-unpacked', 'Console Connect.exe') : electron;
const child = spawn(executable, [...(packaged ? [] : ['.']), `--remote-debugging-port=${port}`], {
  env: { ...process.env, CONSOLE_CONNECT_TEST_DATA: directory, CONSOLE_CONNECT_TEST_PROVIDER_VERSION: '1', CONSOLE_CONNECT_PIPE: cliPipe }, stdio: 'ignore',
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
  if (!(await evaluate("document.fonts.check(\"13px 'JetBrains Mono'\") && [...document.fonts].some(face => face.family.includes('JetBrains Mono') && face.status === 'loaded')"))) {
    throw new Error('The terminal face did not load before the first render.');
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
  // Automatic handling is off by default and is set per event kind on this computer.
  if (!(await evaluate("document.querySelector('[data-auto=enabled]')?.checked === false && document.querySelector('[data-auto=questions]')?.disabled === true"))) throw new Error('Automatic handling was not off by default.');
  await evaluate("(() => { const box = document.querySelector('[data-auto=enabled]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await evaluate("(() => { const select = document.querySelector('[data-auto=questions]'); select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  if (!(await evaluate("(() => { const saved = JSON.parse(localStorage.getItem('console-connect.orchestrator-auto')); return saved.enabled === true && saved.questions === 'auto' && saved.submissions === 'ask' && saved.dailyLimit === 20; })()"))) {
    throw new Error('Automatic handling settings were not saved.');
  }
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('dist/settings-orchestrator.png', Buffer.from(captured.data, 'base64'));
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
  // Workspace-level actions must work before any task exists.
  await evaluate("document.querySelector('[data-action=open-orchestrator]').click()");
  if (!(await evaluate("document.querySelector('.breadcrumb-current')?.textContent === 'Orchestrator' && Boolean(document.querySelector('#orchestrator-tool'))"))) {
    throw new Error('The orchestrator did not open in a workspace without tasks.');
  }
  await evaluate("document.querySelector('[data-action=disconnect]').click()");
  if (!(await evaluate("Boolean(document.querySelector('[data-action=open-project]'))"))) throw new Error('Dashboard did not retain the project.');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.project-counts'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("document.querySelector('.project-counts')?.textContent === 'Nothing needs you'"))) throw new Error('Project row did not show live counts from the running host.');
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
      // With no saved choice, the rail opens exactly when the window is at least 1280px wide.
      if (!(await evaluate("(innerWidth >= 1280) === Boolean(document.querySelector('.session-rail'))"))) {
        throw new Error(`Session rail default ignored the window width: ${await evaluate("JSON.stringify({ width: innerWidth, rail: document.querySelector('.right-rail')?.className })")}`);
      }
      if (!(await evaluate("Boolean(document.querySelector('.session-rail'))"))) await evaluate("document.querySelector('[data-action=toggle-session-rail]').click()");
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate("document.querySelector('.session-rail .session-files')?.textContent === 'No changes yet.'")) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!(await evaluate("document.querySelector('.session-rail .session-files')?.textContent === 'No changes yet.'"))) throw new Error(`Session rail did not read the task worktree: ${await evaluate("JSON.stringify({ width: innerWidth, rail: document.querySelector('.right-rail')?.className, text: document.querySelector('.right-rail')?.innerText.slice(0, 300) })")}`);
      await evaluate("document.querySelector('[data-action=toggle-session-rail]').click()");
      if (await evaluate("Boolean(document.querySelector('.right-rail'))")) throw new Error('Session rail did not close.');
      await evaluate("document.querySelector('[data-action=toggle-session-rail]').click()");
      if (!(await evaluate("Boolean(document.querySelector('.session-rail'))"))) throw new Error('Session rail did not reopen.');
      await evaluate("document.querySelector('[data-action=toggle-console-focus]').click()");
      if (!(await evaluate("Boolean(document.querySelector('.workspace-focus .breadcrumb .status-pill') && getComputedStyle(document.querySelector('.console-active > h1')).display === 'none')"))) {
        throw new Error('Focus mode did not fold the title into the top bar.');
      }
      if (process.argv.includes('--screenshot')) {
        const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile('dist/console-focus.png', Buffer.from(captured.data, 'base64'));
      }
      await evaluate("document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true, bubbles: true }))");
      if (!(await evaluate("Boolean(document.activeElement?.closest('.xterm'))"))) throw new Error('Ctrl+` did not focus the terminal.');
      await evaluate("document.querySelector('[data-action=toggle-console-focus]').click()");
      if (await evaluate("Boolean(document.querySelector('.workspace-focus'))")) throw new Error('Focus mode did not turn off.');
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
  const press = async (key, modifiers = 0) => {
    const code = /^[0-9]$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const windowsVirtualKeyCode = { Enter: 13, Escape: 27 }[key] ?? key.toUpperCase().charCodeAt(0);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, ...(key.length === 1 && !modifiers ? { text: key } : key === 'Enter' ? { text: '\r' } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
  };
  const activeTask = "document.querySelector('.task-list .active')?.dataset.task";
  const activeTab = "document.querySelector('.task-tab.active')?.dataset.tab";
  if (await evaluate("Boolean(document.activeElement?.closest('.xterm'))")) {
    const before = await evaluate(activeTask);
    await press('j');
    if ((await evaluate(activeTask)) !== before) throw new Error('J moved tasks while typing in the terminal.');
  }
  await evaluate('document.activeElement?.blur()');
  const order = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('.task-list [data-task]')].map(item => item.dataset.task))"));
  const start = order.indexOf(await evaluate(activeTask));
  await press('k');
  if ((await evaluate(activeTask)) !== order[Math.max(0, start - 1)]) throw new Error('K did not select the previous task.');
  await press('j');
  if ((await evaluate(activeTask)) !== order[Math.min(order.length - 1, Math.max(0, start - 1) + 1)]) throw new Error('J did not select the next task.');
  await press('2');
  if ((await evaluate(activeTab)) !== 'console') throw new Error('2 did not open the console tab.');
  await press('1');
  if ((await evaluate(activeTab)) !== 'overview') throw new Error('1 did not open the overview tab.');
  await press('k', 2);
  if (!(await evaluate("document.activeElement === document.querySelector('.palette-input')"))) throw new Error('Ctrl+K did not open the palette.');
  await call('Input.insertText', { text: 'Review' });
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/palette.png', Buffer.from(captured.data, 'base64'));
  }
  await press('Enter');
  if (await evaluate("Boolean(document.querySelector('.palette'))")) throw new Error('Choosing a palette item did not close it.');
  if (!(await evaluate("document.querySelector('.task-list .active')?.textContent.includes('Review login')"))) throw new Error('Palette did not jump to the task.');
  await evaluate("document.querySelector('[data-action=open-palette]').click()");
  if (!(await evaluate("document.activeElement === document.querySelector('.palette-input')"))) throw new Error('The Jump button did not open the palette.');
  await press('Escape');
  if (await evaluate("Boolean(document.querySelector('.palette'))")) throw new Error('Escape did not close the palette.');
  // console-connect through the generated shim, the way a terminal or AI tool runs it.
  const cli = (args, pipe = cliPipe, tool) => new Promise(resolve => execFile(join(directory, 'bin', process.platform === 'win32' ? 'console-connect.cmd' : 'console-connect'),
    // cmd joins arguments as typed, so quote the ones with spaces the way a person would.
    process.platform === 'win32' ? args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg) : args,
    { shell: process.platform === 'win32', env: { ...process.env, CONSOLE_CONNECT_PIPE: pipe, ...(tool ? { CONSOLE_CONNECT_TOOL: tool } : {}) } }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
  const listed = await cli(['task', 'list', '--json']);
  if (listed.code !== 0 || !JSON.parse(listed.stdout).tasks.some(task => task.title === 'Review login')) throw new Error(`console-connect task list failed: ${JSON.stringify(listed)}`);
  // Presence heartbeats reach the host without changing the workspace revision.
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await hostCall('/state');
    if (state.presence?.find(item => item.memberId === state.memberId)?.at) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const seen = await hostCall('/state');
  if (!['here', 'away'].includes(seen.presence?.find(item => item.memberId === seen.memberId)?.status)) throw new Error(`Presence did not reach the host: ${JSON.stringify(seen.presence)}`);
  const briefed = await cli(['brief']);
  if (briefed.code !== 0 || !briefed.stdout.includes('You are Alex, Owner.') || !briefed.stdout.includes('Assigning: Anyone assigns to anyone. You can assign.')) {
    throw new Error(`console-connect brief failed: ${JSON.stringify(briefed)}`);
  }
  const created = await cli(['task', 'create', '--title', 'From the CLI', '--description', 'Made by console-connect']);
  if (created.code !== 0 || !created.stdout.includes('as Alex')) throw new Error(`console-connect task create failed: ${JSON.stringify(created)}`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.querySelector('.task-list')?.innerText.includes('From the CLI')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("document.querySelector('.task-list')?.innerText.includes('From the CLI')"))) throw new Error(`A task created through console-connect did not appear in the app: ${JSON.stringify({ created, onHost: (await hostCall('/state')).tasks.map(task => task.title), notice: await evaluate("document.querySelector('.notice')?.innerText ?? null"), view: await evaluate("document.querySelector('.task-list')?.innerText.slice(0, 300) ?? 'no list'") })}`);
  const cliTask = (await hostCall('/state')).tasks.find(task => task.title === 'From the CLI');
  const replied = await cli(['task', 'reply', cliTask.id.slice(0, 8), 'Picked up by Codex.'], cliPipe, 'codex');
  if (replied.code !== 0 || (await hostCall('/state')).messages.find(message => message.body === 'Picked up by Codex.')?.via !== 'codex') {
    throw new Error(`A reply from a Codex console was not marked via Codex: ${JSON.stringify(replied)}`);
  }
  const closed = await cli(['brief'], process.platform === 'win32' ? '\\\\.\\pipe\\cc-smoke-closed' : join(directory, 'closed.sock'));
  if (closed.code !== 2 || !closed.stderr.includes('Open Console Connect')) throw new Error(`console-connect without the app should exit 2: ${JSON.stringify(closed)}`);
  // A tool drafts the package; the app adds the Git facts from the task worktree.
  const claudeTask = (await hostCall('/state')).tasks.find(task => task.title === 'Check claude launch');
  const drafted = await cli(['package', 'draft', '--task', claudeTask.id.slice(0, 8), '--summary', 'Launch checked from the console.', '--checks', 'claude --version printed', '--questions', 'None'], cliPipe, 'claude');
  if (drafted.code !== 0) throw new Error(`package draft failed: ${JSON.stringify(drafted)}`);
  const draft = (await hostCall('/state')).tasks.find(task => task.id === claudeTask.id).draftPackage;
  if (draft?.summary !== 'Launch checked from the console.' || !draft.sourceRef.startsWith(`console-connect/${claudeTask.id} · `) || draft.verification !== 'claude --version printed') {
    throw new Error(`The drafted package lacks the Git facts: ${JSON.stringify(draft)}`);
  }
  await evaluate(`document.querySelector('[data-task="${claudeTask.id}"]').click(); document.querySelector('[data-tab=package]').click()`);
  if (!(await evaluate("document.querySelector('.package-card-summary')?.textContent === 'Launch checked from the console.' && Boolean(document.querySelector('.package-card [data-action=submit]'))"))) {
    throw new Error('The package tab did not show the drafted card.');
  }
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/package-card.png', Buffer.from(captured.data, 'base64'));
  }
  // The orchestrator console runs a tool in the main project folder and lists CLI activity.
  await evaluate("document.querySelector('[data-action=open-orchestrator]').click()");
  if (!(await evaluate("document.querySelector('.breadcrumb-current')?.textContent === 'Orchestrator' && document.querySelector('.cli-activity')?.innerText.includes('Created')"))) {
    throw new Error('The orchestrator view did not open with CLI activity.');
  }
  await evaluate("document.querySelector('#orchestrator-tool').value = 'codex'; document.querySelector('[data-action=start-orchestrator]').click()");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate("Boolean(document.querySelector('#orchestrator-terminal .xterm')) && document.querySelector('.session-state')?.textContent === 'Session ended'")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('#orchestrator-terminal .xterm')) && document.querySelector('.session-state')?.textContent === 'Session ended' && document.querySelector('.session-place')?.textContent === 'Main folder · no worktree'"))) {
    throw new Error(`The orchestrator console did not run: ${await evaluate("document.querySelector('.notice')?.innerText ?? document.querySelector('.desk-content')?.innerText.slice(0, 300)")}`);
  }
  if (!(await evaluate("document.querySelector('.auto-badge')?.textContent === 'Auto · 0 of 20 today'"))) throw new Error('The orchestrator strip did not show the Auto badge.');
  await evaluate("document.querySelector('[data-action=toggle-auto-pause]').click()");
  if (!(await evaluate("document.querySelector('.auto-badge')?.textContent.startsWith('Auto paused')"))) throw new Error('Pause did not pause automatic handling.');
  await evaluate("document.querySelector('[data-action=toggle-auto-pause]').click()");
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/orchestrator.png', Buffer.from(captured.data, 'base64'));
  }
  // The project map: drafted from the files the app finds, then read into every brief.
  await mkdir(join(repository, 'docs'), { recursive: true });
  await writeFile(join(repository, 'docs', 'specification.md'), '# Spec\n');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('[data-action=draft-project-map]'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await evaluate("document.querySelector('[data-action=draft-project-map]').click()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("/[1-9] protected/.test(document.querySelector('.project-map')?.innerText ?? '')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const mapText = await readFile(join(repository, 'docs', 'README.md'), 'utf8').catch(() => '');
  if (!mapText.includes('- `docs/specification.md` — ') || !mapText.includes('(protected)')) throw new Error(`The drafted project map is wrong: ${mapText}`);
  if (!(await evaluate("/[1-9] protected/.test(document.querySelector('.project-map')?.innerText ?? '')"))) throw new Error(`The orchestrator rail did not read the project map: ${await evaluate("(document.querySelector('.project-map')?.outerHTML ?? 'no section') + ' | ' + (document.querySelector('.notice')?.innerText ?? 'no notice')")}`);
  const mapped = await cli(['brief']);
  if (!mapped.stdout.includes('Project map (docs/README.md @ main folder):') || !mapped.stdout.includes('docs/specification.md:')) throw new Error(`The brief did not carry the project map: ${mapped.stdout}`);
  await evaluate("document.querySelector('.task-link')?.click()");
  // The owner sets the team's assigning rule from the Team section; the host records it.
  await evaluate("(() => { const select = document.querySelector('#assigning-rule'); select.value = 'leads'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await hostCall('/state')).settings?.assigningRule === 'leads') break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if ((await hostCall('/state')).settings?.assigningRule !== 'leads') throw new Error('The assigning rule did not reach the host.');
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'set-assigning-rule', rule: 'anyone' });
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
  await evaluate(`document.querySelector('[data-action="disconnect"]').click()`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.querySelector('.project-counts')?.textContent.includes(' running')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("document.querySelector('.project-counts')?.textContent.includes(' running')"))) throw new Error('Project row did not count running tasks.');
  await evaluate(`document.querySelector('[data-action="add-project"]').click(); document.querySelector('#join-invitation input[name=link]').value=${JSON.stringify(invitation.toString())}; document.querySelector('#join-invitation input[name=name]').value='Blair'; document.querySelector('#join-invitation').requestSubmit();`);
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
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.querySelector('.assigned-by-me')?.innerText.includes('Waiting for approval')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("(() => { const text = document.querySelector('.assigned-by-me')?.innerText ?? ''; return text.includes('Waiting for approval') && text.includes('Live arrival') && text.includes('Alex'); })()"))) throw new Error('Assigned by me did not list the handed-out task.');
  const liveRevision = (await hostCall('/state')).tasks.find(task => task.id === liveTaskId).revision;
  const declined = await hostCall('/commands', { id: crypto.randomUUID(), type: 'decline-task', taskId: liveTaskId, revision: liveRevision, note: 'Busy this week.' });
  if (declined.error) throw new Error(`Decline failed: ${declined.error}`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.querySelector('.assigned-by-me')?.innerText.includes('Declined by Alex')")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("document.querySelector('.assigned-by-me')?.innerText.includes('Declined by Alex')"))) throw new Error('A declined task did not show as declined to its sender.');
  if (!(await evaluate("document.querySelector('.orchestrator-link .chat-count')?.textContent === '1'"))) throw new Error(`The decline was not queued for the orchestrator: ${await evaluate("document.querySelector('.orchestrator-link .chat-count')?.title")}`);
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/assigned-by-me.png', Buffer.from(captured.data, 'base64'));
  }
  // A tool proposes a review through console-connect; only the person's click sends it.
  const reviewTaskId = crypto.randomUUID();
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId: reviewTaskId, title: 'Expired invite retry', description: '', assigneeId: hostState.memberId });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'approve-task', taskId: reviewTaskId, revision: 1 });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'start-task', taskId: reviewTaskId, revision: 2, tool: 'codex' });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'save-package', taskId: reviewTaskId, revision: 3, summary: 'Retry link for expired invites', sourceRef: `console-connect/${reviewTaskId}`, deliverables: ['src/invitations.ts'], verification: '32 passed', questions: '' });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'submit-package', taskId: reviewTaskId, revision: 4 });
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await cli(['package', 'show', reviewTaskId.slice(0, 8), '--json'])).stdout.includes('Retry link')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const proposed = await cli(['review', 'propose', reviewTaskId.slice(0, 8), '--accept', '--note', 'Tests pass and the copy matches.'], cliPipe, 'codex');
  if (proposed.code !== 0 || !proposed.stdout.includes("waits for Blair's click")) throw new Error(`review propose failed: ${JSON.stringify(proposed)}`);
  if ((await hostCall('/state')).tasks.find(task => task.id === reviewTaskId).status !== 'submitted') throw new Error('A proposed review was sent without a click.');
  if (!(await evaluate("document.querySelector('.proposal h2')?.textContent.includes('Expired invite retry') && document.activeElement?.dataset.action === 'proposal-confirm'"))) {
    throw new Error('The review confirmation card did not appear with the confirm button focused.');
  }
  if (process.argv.includes('--screenshot')) {
    const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile('dist/review-proposal.png', Buffer.from(captured.data, 'base64'));
  }
  await evaluate("document.querySelector('[data-action=proposal-confirm]').click()");
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await hostCall('/state');
    if (state.tasks.find(task => task.id === reviewTaskId).status === 'accepted' && state.messages.some(message => message.body === 'Tests pass and the copy matches.')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const reviewed = await hostCall('/state');
  if (reviewed.tasks.find(task => task.id === reviewTaskId).status !== 'accepted') throw new Error('Confirming the proposal did not accept the package.');
  if (reviewed.messages.find(message => message.body === 'Tests pass and the copy matches.')?.via !== 'codex') throw new Error('The proposal note was not posted via Codex.');
  if (await evaluate("Boolean(document.querySelector('.proposal'))")) throw new Error('The confirmation card stayed open.');
  // Requesting changes by hand writes the note inline (Electron has no prompt()).
  const changesTaskId = crypto.randomUUID();
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'create-task', taskId: changesTaskId, title: 'Invite email copy', description: '', assigneeId: hostState.memberId });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'approve-task', taskId: changesTaskId, revision: 1 });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'start-task', taskId: changesTaskId, revision: 2, tool: 'codex' });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'save-package', taskId: changesTaskId, revision: 3, summary: 'Email copy', sourceRef: 'main', deliverables: [], verification: '', questions: '' });
  await hostCall('/commands', { id: crypto.randomUUID(), type: 'submit-package', taskId: changesTaskId, revision: 4 });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`(() => { const row = document.querySelector('[data-task="${changesTaskId}"]'); if (!row) return false; row.click(); document.querySelector('[data-tab=package]')?.click(); return Boolean(document.querySelector('[data-action=request-changes]')); })()`)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await evaluate("document.querySelector('[data-action=request-changes]').click()");
  await evaluate("document.querySelector('#request-changes textarea').value = 'Mention the 24-hour limit.'; document.querySelector('#request-changes').requestSubmit()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await hostCall('/state')).tasks.find(task => task.id === changesTaskId).status === 'changes_requested') break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const changed = (await hostCall('/state')).tasks.find(task => task.id === changesTaskId);
  if (changed.status !== 'changes_requested' || changed.package.reviewNote !== 'Mention the 24-hour limit.') throw new Error('Request changes did not send the inline note.');
  const incomingMessageId = crypto.randomUUID();
  await hostCall('/commands', { id: incomingMessageId, type: 'post-message', body: 'Can someone test invitation expiry?' });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.chat-link[data-action=workspace-chat] .chat-count'))")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!(await evaluate("Boolean(document.querySelector('.chat-link[data-action=workspace-chat] .chat-count') && document.querySelector('.chat-toast'))"))) {
    const state = await evaluate("JSON.stringify({ badge: document.querySelector('.chat-link[data-action=workspace-chat] .chat-count')?.textContent, toast: document.querySelector('.chat-toast')?.textContent, visible: document.body.innerText.slice(-700) })");
    throw new Error(`Incoming team message did not show an unread badge and preview: ${state}`);
  }
  await evaluate("document.querySelector('.topbar [data-action=open-chat-drawer]').click()");
  if (!(await evaluate("Boolean(document.querySelector('.chat-drawer') && !document.querySelector('.chat-link[data-action=workspace-chat] .chat-count'))"))) {
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
