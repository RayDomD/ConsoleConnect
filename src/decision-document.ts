import type { Decision } from './coordination/_internal/protocol';

export function renderDecisionDocument(decision: Decision) {
  const supersedes = decision.supersedesId ? `Supersedes: ${decision.supersedesId}\n\n` : '';
  const affected = decision.affectedTaskIds.length ? `Affected tasks: ${decision.affectedTaskIds.join(', ')}\n\n` : '';
  return `# ${decision.title}\n\n<!-- Console Connect decision: ${decision.id} -->\n\n${supersedes}${affected}${decision.body}\n`;
}
