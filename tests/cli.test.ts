import { afterEach, expect, test } from 'vitest';
import { createServer, type Server } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipePath, sendCliRequest } from '../src/cli';

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve)); });
const testPipe = () => process.platform === 'win32' ? `\\\\.\\pipe\\cc-test-${randomUUID()}` : join(tmpdir(), `cc-test-${randomUUID()}.sock`);

test('the CLI sends one request over the pipe and reads one reply', async () => {
  const path = testPipe();
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.once('data', line => {
      const request = JSON.parse(String(line).trim());
      socket.end(JSON.stringify({ ok: true, text: `got ${request.argv.join(' ')} from ${request.tool}`, data: request }));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(path, resolve));
  const reply = await sendCliRequest(path, { version: 1, argv: ['task', 'list'], cwd: 'C:/work', tool: 'codex' });
  expect(reply).toMatchObject({ ok: true, text: 'got task list from codex' });
});

test('with no app listening the CLI reports it instead of throwing', async () => {
  expect(await sendCliRequest(testPipe(), { version: 1, argv: ['brief'], cwd: '.' })).toBeNull();
});

test('the pipe is per user and can be overridden for isolated runs', () => {
  expect(pipePath({ CONSOLE_CONNECT_PIPE: 'custom' })).toBe('custom');
  expect(pipePath({}, 'win32')).toMatch(/^\\\\\.\\pipe\\console-connect-/);
  expect(pipePath({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux')).toMatch(/console-connect-.+\.sock$/);
});
