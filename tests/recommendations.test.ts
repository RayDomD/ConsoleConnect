import { expect, test } from 'vitest';
import type { Idea, Snapshot } from '../src/coordination';
import { detectEvents, eventLine, recommendNext, suggestSize } from '../src/orchestrator';

const blair = '11111111-1111-4111-8111-111111111111';
const ideaId = 'eeeeeeee-0000-4000-8000-000000000005';
const task = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;

function idea(fields: Partial<Idea>): Idea {
  return { id: ideaId, title: 'Session timeout', note: '', size: 'feature', stage: 'talk', createdBy: blair, createdAt: '', revision: 1,
    skipped: [], documents: [], taskIds: [], ...fields };
}

test('the next step is the next stage on the size path, with its fixed reason', () => {
  expect(recommendNext(idea({ size: 'big', stage: 'talk' }))).toEqual({ stage: 'write',
    text: 'Write it up next: run console-connect playbook write eeeeeeee, because a spec gives every task the same contract.' });
  expect(recommendNext(idea({ size: 'feature', stage: 'talk' }))?.stage).toBe('split');
  expect(recommendNext(idea({ size: 'quick', stage: 'build' }))).toEqual({ stage: 'review',
    text: 'Review next: run console-connect playbook review eeeeeeee, because it checks what shipped against what was agreed.' });
  expect(recommendNext(idea({ size: 'quick', stage: 'review' }))).toBeNull();
  expect(recommendNext(idea({ stage: 'done' }))).toBeNull();
});

test('a size change is suggested when simple signals disagree with the size', () => {
  expect(suggestSize(idea({ size: 'quick', stage: 'build', taskIds: [task(1), task(2)] }))).toEqual({ size: 'feature',
    text: 'This Quick fix has 2 tasks. Consider making it a Feature.' });
  expect(suggestSize(idea({ size: 'quick', taskIds: [task(1)] }))).toBeNull();
  expect(suggestSize(idea({ size: 'feature', taskIds: [task(1), task(2), task(3), task(4)] }))?.size).toBe('big');
  expect(suggestSize(idea({ size: 'feature' }), '# Session timeout\n\n## Sessions\n\n1. Tokens\n2. Banner\n')).toEqual({ size: 'big',
    text: 'This Feature spans several sessions. Consider making it a Big idea, so it gets a spec.' });
  expect(suggestSize(idea({ size: 'feature' }), '# Session timeout\n\nOne session.')).toBeNull();
  expect(suggestSize(idea({ size: 'big', taskIds: [task(1), task(2), task(3), task(4), task(5)] }))).toBeNull();
});

test('the orchestrator hears when an idea reaches a new stage, with the recommendation', () => {
  const snapshot = (ideas: Idea[]): Snapshot => ({ workspace: { id: 'w', name: 'Team', repository: '' }, revision: 1, memberId: blair,
    members: [{ id: blair, name: 'Blair', role: 'owner' }], tasks: [], messages: [], decisions: [], ideas });
  const events = detectEvents(snapshot([idea({})]), snapshot([idea({ stage: 'split', revision: 3 })]));
  expect(events).toEqual([{ kind: 'idea-stage', ideaId, title: 'Session timeout', size: 'feature', stage: 'split' }]);
  expect(eventLine(events)).toBe('"Session timeout" reached Split into tasks (eeeeeeee). Run console-connect playbook split eeeeeeee, then Build next: work the linked tasks, because each gets its own branch and package.');
  expect(detectEvents(snapshot([idea({})]), snapshot([idea({ revision: 2, readyBy: blair })]))).toEqual([]);
  expect(detectEvents(snapshot([]), snapshot([idea({})]))).toEqual([]);
  expect(eventLine(detectEvents(snapshot([idea({ stage: 'review' , size: 'quick' })]), snapshot([idea({ stage: 'done', size: 'quick' })])))).toBe('"Session timeout" is done (eeeeeeee). Write the session summary if it is missing.');
});
