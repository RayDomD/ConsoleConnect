import { expect, test } from 'vitest';
import { defaultAutoSettings, planAutoRun, type OrchestratorEvent } from '../src/orchestrator';

const submitted: OrchestratorEvent = { kind: 'submitted', taskId: 'a', title: 'Retry', person: 'Sam' };
const question: OrchestratorEvent = { kind: 'question', taskId: 'b', title: 'Copy', person: 'Casey', body: '24 hours?' };
const declined: OrchestratorEvent = { kind: 'declined', taskId: 'c', title: 'Docs', person: 'Riley' };
const today = '2026-09-25';

test('everything is typed in for the person until they turn automatic handling on', () => {
  expect(planAutoRun([submitted, question], defaultAutoSettings, { date: today, count: 0 }, false, today)).toEqual({ auto: [], ask: [submitted, question] });
});

test('only the kinds set to Auto are sent, and declines always ask', () => {
  const settings = { ...defaultAutoSettings, enabled: true, questions: 'auto' as const };
  expect(planAutoRun([submitted, question, declined], settings, { date: today, count: 0 }, false, today)).toEqual({ auto: [question], ask: [submitted, declined] });
});

test('pause and the daily limit stop automatic runs; the count resets each day', () => {
  const settings = { ...defaultAutoSettings, enabled: true, questions: 'auto' as const, dailyLimit: 3 };
  expect(planAutoRun([question], settings, { date: today, count: 1 }, true, today).auto).toEqual([]);
  expect(planAutoRun([question], settings, { date: today, count: 3 }, false, today).auto).toEqual([]);
  expect(planAutoRun([question], settings, { date: '2026-09-24', count: 3 }, false, today).auto).toEqual([question]);
});
