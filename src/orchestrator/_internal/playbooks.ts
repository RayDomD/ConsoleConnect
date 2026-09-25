import type { Idea, IdeaStage } from '../../coordination';

// Stage instructions for any orchestrating tool (guided path ADR Q22). The repo's docs/playbooks/<stage>.md replaces these.
export const stageNames: Record<IdeaStage, string> = {
  talk: 'Talk it through', write: 'Write it up', split: 'Split into tasks', build: 'Build', review: 'Review',
};
export const sizeNames: Record<Idea['size'], string> = { quick: 'Quick fix', feature: 'Feature', big: 'Big idea' };

// The ADR's earlier playbook names still work.
const aliases: Record<string, IdeaStage> = { grill: 'talk', spec: 'write', tickets: 'split' };

export function playbookStage(value: string | undefined): IdeaStage | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return lower in stageNames ? lower as IdeaStage : aliases[lower] ?? null;
}

export const playbookPath = (stage: IdeaStage) => `docs/playbooks/${stage}.md`;

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'idea';

/** Where a stage's document goes for an idea, or null for stages that write no document of their own. */
export function stageDocument(stage: IdeaStage, idea: Pick<Idea, 'title'>, today = new Date()) {
  const name = slug(idea.title);
  switch (stage) {
    case 'talk': return `docs/ideas/${name}.md`;
    case 'write': return `docs/specs/${name}.md`;
    case 'split': return `docs/plans/${today.toISOString().slice(0, 10)}-${name}.md`;
    case 'build': return null;
    case 'review': return `docs/session-summaries/${name}.md`;
  }
}

const builtIn: Record<IdeaStage, string[]> = {
  talk: [
    'Talk it through: agree on what the idea is and why before anyone writes a spec. It produces an idea note in docs/ideas/.',
    '',
    '1. Read the idea card and the project map (console-connect brief).',
    '2. Ask the person one question at a time about the problem, who it is for, what is out of scope, and how you will know it works. Recommend an answer with each question.',
    '3. Write the answers as short decisions in the idea note, one per heading, with the reason for each.',
    '4. If the work clearly spans several sessions, add a "Sessions" heading that lists them.',
    '5. Link the note: console-connect idea link <idea> --doc <path>. An Owner or Reviewer marks the idea ready in Console Connect.',
  ],
  write: [
    'Write it up: turn the agreed idea into a spec the team can build against. It produces a spec in docs/specs/.',
    '',
    '1. Read the idea note and any decisions it names.',
    '2. Write the contracts: data, commands, rules, and error messages, then the acceptance checks for each piece.',
    '3. List what the spec does not cover.',
    '4. Link the spec: console-connect idea link <idea> --doc <path> --stage write.',
    '5. Propose the spec as a decision in Console Connect, and link it with --spec <decision id>. The stage advances once an Owner or Reviewer approves it.',
  ],
  split: [
    'Split into tasks: cut the work into tasks one person can finish and review in a session. It produces tasks and a plan in docs/plans/.',
    '',
    '1. Read the spec, or the idea note for a Feature.',
    '2. Cut thin end-to-end tasks. Each names its acceptance check.',
    '3. Create each task with console-connect task create --title <t> --description <d>. Add --after <id> when a task must wait for another to be accepted.',
    '4. Write the plan: the tasks in order, who takes which, and what blocks what.',
    '5. Link them: console-connect idea link <idea> --task <id,id> --doc <path> --stage split.',
  ],
  build: [
    'Build: do the linked tasks through the normal task flow. It produces a branch, commits, and a work package per task.',
    '',
    '1. Each assignee approves their task and launches its console in Console Connect.',
    '2. Work on the task branch. Run the checks the task names.',
    '3. Draft the package with console-connect package draft --summary <s> --checks <c>, then submit it in the app.',
    '4. A reviewer accepts each package. The stage advances once every linked task is accepted.',
  ],
  review: [
    'Review: confirm what shipped matches what was agreed. It produces a session summary in docs/session-summaries/.',
    '',
    '1. Read the spec or idea note, then each linked task\'s package.',
    '2. Check each acceptance check against the evidence in the packages.',
    '3. Write the summary: what shipped, what differs from the plan and why, and the checks that ran.',
    '4. Link it: console-connect idea link <idea> --doc <path> --stage review. The idea is done once every linked task is merged.',
  ],
};

/** The playbook text: the repo's override when present, otherwise the built-in one, plus the idea's file when an idea is named. */
export function playbookText(stage: IdeaStage, override: string | null, idea?: Idea) {
  const body = override?.trim() ? override.trim() : builtIn[stage].join('\n');
  if (!idea) return body;
  const document = stageDocument(stage, idea);
  return [body, '', `Idea: ${idea.title} (${idea.id.slice(0, 8)}), ${sizeNames[idea.size]}.`,
    ...(idea.note ? [`Note: ${idea.note}`] : []), ...(document ? [`Write to: ${document}`] : [])].join('\n');
}
