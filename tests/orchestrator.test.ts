import { describe, expect, test } from 'vitest';
import type { CommandInput, Snapshot } from '../src/coordination';
import { runCliCommand, type WorkspaceApi } from '../src/orchestrator';

const blair = '11111111-1111-4111-8111-111111111111';
const sam = '22222222-2222-4222-8222-222222222222';
const login = 'aaaaaaaa-0000-4000-8000-000000000001';
const invite = 'abbbbbbb-0000-4000-8000-000000000002';

function workspace() {
  const state: Snapshot = {
    workspace: { id: 'w', name: 'Smoke team', repository: 'https://github.com/example/demo' }, revision: 3, memberId: blair,
    members: [{ id: blair, name: 'Blair', role: 'owner' }, { id: sam, name: 'Sam', role: 'contributor' }],
    tasks: [
      { id: login, title: 'Review login', description: 'Check the form', authorId: blair, assigneeId: null, status: 'unassigned', revision: 1, createdAt: '2026-09-25T00:00:00Z' },
      { id: invite, title: 'Expired invite retry', description: '', authorId: blair, assigneeId: sam, status: 'running', revision: 4, createdAt: '2026-09-25T00:00:00Z' },
    ],
    messages: [{ id: 'm1', taskId: invite, authorId: sam, body: 'Retry after 24 hours?', createdAt: '2026-09-25T00:00:00Z' }],
    decisions: [],
  };
  const sent: Array<{ taskId: string | null; fields: CommandInput }> = [];
  const api: WorkspaceApi = { snapshot: () => state, send: async (taskId, fields) => { sent.push({ taskId, fields }); } };
  return { api, sent };
}

const context = { cwd: 'C:/work/demo', taskId: null };

describe('console-connect commands in the app', () => {
  test('task list shows open tasks with short ids, assignees, and states', async () => {
    const { api } = workspace();
    const result = await runCliCommand(['task', 'list'], context, api);
    expect(result.text).toContain('aaaaaaaa  Unassigned  Review login');
    expect(result.text).toContain('abbbbbbb  Running  Expired invite retry · Sam');
    expect(result.data).toMatchObject({ tasks: [{ id: login, status: 'unassigned' }, { id: invite, assignee: 'Sam' }] });
  });

  test('task create resolves the assignee by name and records it as the person', async () => {
    const { api, sent } = workspace();
    const result = await runCliCommand(['task', 'create', '--title', 'Invite email copy', '--assignee', 'sam'], context, api);
    expect(sent[0]).toMatchObject({ taskId: null, fields: { type: 'create-task', title: 'Invite email copy', description: '', assigneeId: sam } });
    expect(result.text).toMatch(/^Created [0-9a-f]{8} "Invite email copy" as Blair, assigned to Sam\.$/);
  });

  test('ids accept a unique prefix and reject an ambiguous one', async () => {
    const { api, sent } = workspace();
    await runCliCommand(['task', 'claim', 'aa'], context, api);
    expect(sent[0]).toEqual({ taskId: login, fields: { type: 'claim-task' } });
    await expect(runCliCommand(['task', 'claim', 'a'], context, api)).rejects.toThrow('More than one task starts with "a"');
  });

  test('task reply and ask post in the task discussion; ask needs a task console', async () => {
    const { api, sent } = workspace();
    await runCliCommand(['task', 'reply', 'abbb', 'Yes,', 'say', '24', 'hours.'], context, api);
    expect(sent[0]).toEqual({ taskId: null, fields: { type: 'post-message', taskId: invite, body: 'Yes, say 24 hours.' } });
    await expect(runCliCommand(['ask', 'Which copy?'], context, api)).rejects.toThrow('Run ask inside a task console');
    await runCliCommand(['ask', 'Which copy?'], { ...context, taskId: invite }, api);
    expect(sent[1]).toEqual({ taskId: null, fields: { type: 'post-message', taskId: invite, body: 'Which copy?' } });
  });

  test('task show includes the discussion; unknown commands and missing projects explain themselves', async () => {
    const { api } = workspace();
    expect((await runCliCommand(['task', 'show', 'abbb'], context, api)).text).toContain('Sam: Retry after 24 hours?');
    await expect(runCliCommand(['task', 'fly'], context, api)).rejects.toThrow('Unknown command "task fly"');
    await expect(runCliCommand(['task', 'list'], context, { ...api, snapshot: () => null })).rejects.toThrow('Open a project in Console Connect first.');
  });

  test('commands from a tool console carry the tool so the app can mark them', async () => {
    const { api, sent } = workspace();
    await runCliCommand(['task', 'reply', 'abbb', 'On it.'], { ...context, tool: 'codex' }, api);
    expect(sent[0]!.fields).toMatchObject({ type: 'post-message', via: 'codex' });
  });
});
