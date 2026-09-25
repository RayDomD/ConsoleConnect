import type { Idea, IdeaSize, IdeaStage } from '../../coordination';
// The browser-safe protocol module, not the coordination index, which also carries the Node host.
import { ideaPaths } from '../../coordination/_internal/protocol';
import { sizeNames, stageNames } from './playbooks';

// Recommendations follow fixed rules (guided path ADR Q16, Q23): the next stage on the size path, with one line of why.
const reasons: Record<IdeaStage, string> = {
  talk: 'agreeing on the what and why first saves rework',
  write: 'a spec gives every task the same contract',
  split: 'tasks one person can finish in a session review cleanly',
  build: 'each gets its own branch and package',
  review: 'it checks what shipped against what was agreed',
};
const sessionsHeading = /^#{1,6}\s*Sessions\b/im;
const featureTaskLimit = 3;

/** What to do on a stage, in words a tool can act on. */
export function stageAction(stage: IdeaStage, idea: Pick<Idea, 'id'>) {
  return stage === 'build' ? 'work the linked tasks' : `run console-connect playbook ${stage} ${idea.id.slice(0, 8)}`;
}

/** The stage after the idea's current one on its path, or null when the current stage is its last. */
export function recommendNext(idea: Pick<Idea, 'id' | 'size' | 'stage'>): { stage: IdeaStage; text: string } | null {
  if (idea.stage === 'done') return null;
  const path = ideaPaths[idea.size];
  const stage = path[path.indexOf(idea.stage) + 1];
  if (!stage) return null;
  return { stage, text: `${stageNames[stage]} next: ${stageAction(stage, idea)}, because ${reasons[stage]}.` };
}

/** A different size when simple signals disagree: a Quick fix with several tasks, or a Feature spanning several sessions. */
export function suggestSize(idea: Idea, talkDocument?: string | null): { size: IdeaSize; text: string } | null {
  if (idea.size === 'quick' && idea.taskIds.length > 1) {
    return { size: 'feature', text: `This Quick fix has ${idea.taskIds.length} tasks. Consider making it a ${sizeNames.feature}.` };
  }
  if (idea.size === 'feature' && (idea.taskIds.length > featureTaskLimit || sessionsHeading.test(talkDocument ?? ''))) {
    return { size: 'big', text: `This Feature spans several sessions. Consider making it a ${sizeNames.big}, so it gets a spec.` };
  }
  return null;
}
