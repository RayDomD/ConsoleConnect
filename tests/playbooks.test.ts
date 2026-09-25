import { expect, test } from 'vitest';
import type { CommandInput, Snapshot } from '../src/coordination';
import { runCliCommand, type WorkspaceApi } from '../src/orchestrator';

const blair = '11111111-1111-4111-8111-111111111111';
const idea = 'cccccccc-0000-4000-8000-000000000003';
const task = 'dddddddd-0000-4000-8000-000000000004';

function workspace(overrides: Record<string, string> = {}) {
  const state: Snapshot = {
    workspace: { id: 'w', name: 'Smoke team', repository: 'https://github.com/example/demo' }, revision: 3, memberId: blair,
    members: [{ id: blair, name: 'Blair', role: 'owner' }],
    tasks: [{ id: task, title: 'Expiry check', description: '', authorId: blair, assigneeId: null, status: 'unassigned', revision: 1, createdAt: '2026-09-25T00:00:00Z' }],
    messages: [], decisions: [],
    ideas: [{ id: idea, title: 'Invite links that expire', note: 'Links older than a day stop working.', size: 'feature', stage: 'talk',
      createdBy: blair, createdAt: '2026-09-25T00:00:00Z', revision: 2, skipped: [], documents: [], taskIds: [] }],
  };
  const sent: Array<{ taskId: string | null; fields: CommandInput }> = [];
  const reads: Array<{ stage: string; taskId: string | null }> = [];
  const api: WorkspaceApi = { snapshot: () => state, send: async (taskId, fields) => { sent.push({ taskId, fields }); },
    propose: () => {}, draftPackage: async () => {}, hold: () => {},
    readPlaybook: async (stage, taskId) => { reads.push({ stage, taskId }); return overrides[stage] ?? null; } };
  return { api, sent, reads, state };
}

const context = { cwd: 'C:/work/demo', taskId: null };

test('each built-in playbook opens with what the stage is for and what it produces', async () => {
  const { api } = workspace();
  for (const stage of ['talk', 'write', 'split', 'build', 'review']) {
    const result = await runCliCommand(['playbook', stage], context, api);
    expect(result.text.split('\n')[0]).toMatch(/\. It produces /);
    expect(result.data).toMatchObject({ stage, source: 'built-in' });
  }
  expect((await runCliCommand(['playbook', 'grill'], context, api)).data).toMatchObject({ stage: 'talk' });
  await expect(runCliCommand(['playbook', 'dance'], context, api)).rejects.toThrow('Choose a stage');
});

test('a playbook in the repo replaces the built-in one, and naming an idea adds its file', async () => {
  const { api, reads } = workspace({ talk: '# Our way to talk it through\nAsk the customer first.' });
  const result = await runCliCommand(['playbook', 'talk', 'cc'], context, api);
  expect(reads).toEqual([{ stage: 'talk', taskId: null }]);
  expect(result.data).toMatchObject({ stage: 'talk', source: 'docs/playbooks/talk.md', ideaId: idea });
  expect(result.text).toContain('Ask the customer first.');
  expect(result.text).toContain('Idea: Invite links that expire');
  expect(result.text).toContain('docs/ideas/invite-links-that-expire.md');
});

test('the idea CLI creates, lists, shows, and links ideas with their revision', async () => {
  const { api, sent } = workspace();
  const created = await runCliCommand(['idea', 'create', '--title', 'Session timeout', '--size', 'big'], context, api);
  expect(sent[0]).toMatchObject({ taskId: null, fields: { type: 'create-idea', title: 'Session timeout', size: 'big' } });
  expect(created.text).toMatch(/^Created idea [0-9a-f]{8} "Session timeout", Big idea, at Talk it through\.$/);
  await expect(runCliCommand(['idea', 'create', '--title', 'X', '--size', 'huge'], context, api)).rejects.toThrow('--size quick, feature, or big');
  expect((await runCliCommand(['idea', 'list'], context, api)).text).toContain('cccccccc  Talk it through  Invite links that expire · Feature');
  expect((await runCliCommand(['idea', 'show', 'cc'], context, api)).text).toContain('Links older than a day stop working.');
  await runCliCommand(['idea', 'link', 'cc', '--task', 'dd', '--doc', 'docs/ideas/invite-expiry.md'], context, api);
  expect(sent[1]).toEqual({ taskId: null, fields: { type: 'link-idea', ideaId: idea, revision: 2, taskIds: [task],
    document: { stage: 'talk', path: 'docs/ideas/invite-expiry.md' } } });
});
