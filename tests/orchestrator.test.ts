import { describe, expect, test } from 'vitest';
import type { CommandInput, Snapshot } from '../src/coordination';
import { runCliCommand, taskBrief, type PackageDraft, type ReviewProposal, type WorkspaceApi } from '../src/orchestrator';

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
  const proposals: ReviewProposal[] = [];
  const drafts: PackageDraft[] = [];
  const held: Array<{ argv: string[]; summary: string }> = [];
  const api: WorkspaceApi = { snapshot: () => state, send: async (taskId, fields) => { sent.push({ taskId, fields }); },
    propose: proposal => { proposals.push(proposal); }, draftPackage: async draft => { drafts.push(draft); }, hold: item => { held.push(item); } };
  return { api, sent, proposals, drafts, held, state };
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

  test('review propose only queues a confirmation for the person; nothing is sent', async () => {
    const { api, sent, proposals, state } = workspace();
    state.tasks[1] = { ...state.tasks[1]!, status: 'submitted', package: { summary: 'Retry link', sourceRef: 'console-connect/abbb', deliverables: ['src/invitations.ts'], verification: '32 passed', questions: '' } };
    const shown = await runCliCommand(['package', 'show', 'abbb'], context, api);
    expect(shown.text).toContain('Retry link');
    expect(shown.text).toContain('src/invitations.ts');
    const result = await runCliCommand(['review', 'propose', 'abbb', '--accept', '--note', 'Tests pass.'], { ...context, tool: 'codex' }, api);
    expect(sent).toEqual([]);
    expect(proposals).toEqual([{ id: expect.any(String), taskId: invite, action: 'accept', note: 'Tests pass.', via: 'codex' }]);
    expect(result.text).toBe("Proposed accepting \"Expired invite retry\". It waits for Blair's click in Console Connect.");
    await expect(runCliCommand(['review', 'propose', 'aaaa', '--changes', '--note', 'x'], context, api)).rejects.toThrow('There is no submitted package to review.');
    await expect(runCliCommand(['review', 'propose', 'abbb', '--note', 'x'], context, api)).rejects.toThrow('Choose --accept or --changes.');
  });

  test('task decline is for the person it was assigned to, with an optional note', async () => {
    const { api, sent, state } = workspace();
    state.tasks[1] = { ...state.tasks[1]!, assigneeId: blair, status: 'awaiting_approval' };
    await runCliCommand(['task', 'decline', 'abbb', '--note', 'Out this week.'], context, api);
    expect(sent[0]).toEqual({ taskId: invite, fields: { type: 'decline-task', note: 'Out this week.' } });
    await expect(runCliCommand(['task', 'decline', 'aaaa'], context, api)).rejects.toThrow('Only the person it was assigned to can decline it.');
  });

  test('the typed-in task brief is one line: the task, its decisions, and how to hand work back', () => {
    const { state } = workspace();
    state.tasks[1] = { ...state.tasks[1]!, description: 'Show a retry link.\n\nKeep the copy short.' };
    state.decisions.push({ id: 'd1', title: 'Links last 24 hours', body: '', proposedBy: blair, createdAt: '', status: 'official', affectedTaskIds: [invite] });
    const brief = taskBrief(state, state.tasks[1]!);
    expect(brief).not.toMatch(/[\r\n]/);
    expect(brief).toContain('Task "Expired invite retry" (abbbbbbb) for Sam: Show a retry link. Keep the copy short.');
    expect(brief).toContain('Follow the decision "Links last 24 hours".');
    expect(brief).toContain('console-connect package draft --summary');
    expect(brief).toContain('console-connect ask');
  });

  test('package draft saves the words for the task console it runs in; the app adds the Git facts', async () => {
    const { api, drafts, state } = workspace();
    state.memberId = sam;
    const inTask = { ...context, taskId: invite, tool: 'claude' as const };
    const result = await runCliCommand(['package', 'draft', '--summary', 'Retry banner added.', '--checks', 'npm test: 34 passed', '--questions', 'Email the owner?'], inTask, api);
    expect(drafts).toEqual([{ taskId: invite, summary: 'Retry banner added.', checks: 'npm test: 34 passed', questions: 'Email the owner?', via: 'claude' }]);
    expect(result.text).toBe('Drafted the work package for "Expired invite retry". Only you can see it until you submit it in Console Connect.');
    await expect(runCliCommand(['package', 'draft', '--checks', 'x'], inTask, api)).rejects.toThrow('Give the package a --summary.');
    await expect(runCliCommand(['package', 'draft', '--summary', 'x'], context, api)).rejects.toThrow('Run package draft in the task console, or add --task <id>.');
    state.memberId = blair;
    await expect(runCliCommand(['package', 'draft', '--summary', 'x'], inTask, api)).rejects.toThrow('Only the person working on this task can draft its package.');
  });

  test('during an automatic run, handing out work is held for the person to send', async () => {
    const { api, sent, held } = workspace();
    const auto = { ...context, tool: 'codex' as const, holdAssignments: true };
    const created = await runCliCommand(['task', 'create', '--title', 'Follow-up', '--assignee', 'Sam'], auto, api);
    await runCliCommand(['task', 'assign', 'aaaa', 'Sam'], auto, api);
    expect(sent).toEqual([]);
    expect(held.map(item => item.summary)).toEqual(['Create "Follow-up" for Sam', 'Assign "Review login" to Sam']);
    expect(held[0]!.argv).toEqual(['task', 'create', '--title', 'Follow-up', '--assignee', 'Sam']);
    expect(created.text).toBe('Held for Blair to send: Create "Follow-up" for Sam. Automatic runs never hand out work.');
    await runCliCommand(['task', 'create', '--title', 'Notes'], auto, api);
    expect(sent).toHaveLength(1);
  });
});

