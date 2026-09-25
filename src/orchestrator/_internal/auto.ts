import type { OrchestratorEvent } from './events';

// Settings > Orchestrator (orchestrator ADR Q9), stored per person on their own computer. Off by default.
export type AutoChoice = 'ask' | 'auto';
export interface AutoSettings { enabled: boolean; questions: AutoChoice; stalls: AutoChoice; submissions: AutoChoice; dailyLimit: number }
export interface AutoUsage { date: string; count: number }

export const defaultAutoSettings: AutoSettings = { enabled: false, questions: 'ask', stalls: 'ask', submissions: 'ask', dailyLimit: 20 };

const choiceFor = (event: OrchestratorEvent, settings: AutoSettings): AutoChoice => {
  if (event.kind === 'question') return settings.questions;
  if (event.kind === 'stalled') return settings.stalls;
  if (event.kind === 'submitted') return settings.submissions;
  return 'ask';
};

// Splits waiting updates into those the orchestrator may handle now (typed and sent) and those typed in for the person.
export function planAutoRun(events: OrchestratorEvent[], settings: AutoSettings, usage: AutoUsage, paused: boolean, today: string) {
  const used = usage.date === today ? usage.count : 0;
  if (!settings.enabled || paused || used >= settings.dailyLimit) return { auto: [] as OrchestratorEvent[], ask: events };
  return { auto: events.filter(event => choiceFor(event, settings) === 'auto'), ask: events.filter(event => choiceFor(event, settings) === 'ask') };
}
