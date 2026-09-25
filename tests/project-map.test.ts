import { expect, test } from 'vitest';
import { draftProjectMap, knowledgeFlags, parseProjectMap, protectedChanges } from '../src/orchestrator';

const map = `# Console Connect: project map

## Start here
- \`docs/specification.md\` — What the product is and isn't. Read before any feature work. (protected)
- \`PRODUCT.md\` — Users, purpose, brand commitments.

## Decisions and plans
- \`docs/adr/\` — Architecture and design records. (protected)
- \`docs/decisions/\` — Official team decisions, written by Console Connect. (protected)
`;

test('the project map is Markdown groups of paths with what they are, and optional protection', () => {
  expect(parseProjectMap(map)).toEqual([
    { heading: 'Start here', entries: [
      { path: 'docs/specification.md', description: "What the product is and isn't. Read before any feature work.", protected: true },
      { path: 'PRODUCT.md', description: 'Users, purpose, brand commitments.', protected: false },
    ] },
    { heading: 'Decisions and plans', entries: [
      { path: 'docs/adr/', description: 'Architecture and design records.', protected: true },
      { path: 'docs/decisions/', description: 'Official team decisions, written by Console Connect.', protected: true },
    ] },
  ]);
});

test('the app drafts a map from the files it finds, protecting the spec, ADRs, design, and decisions', () => {
  const draft = draftProjectMap(['docs/specification.md', 'DESIGN.md', 'docs/adr/', 'docs/notes/']);
  const parsed = parseProjectMap(draft).flatMap(group => group.entries);
  expect(parsed.map(entry => [entry.path, entry.protected])).toEqual([
    ['docs/specification.md', true], ['DESIGN.md', true], ['docs/adr/', true], ['docs/notes/', false],
  ]);
});

test('packages touching protected docs are named for the reviewer, by file or folder', () => {
  const groups = parseProjectMap(map);
  expect(protectedChanges(['src/hosted-core.ts +4 −2', 'docs/adr/2026-09-20-sessions.md +1 −1', 'PRODUCT.md +2'], groups)).toEqual(['docs/adr/2026-09-20-sessions.md']);
});

test('the brief flags hand-edited decision files and protected changes that skipped a package', () => {
  const flags = knowledgeFlags({
    decisions: [{ id: 'd1', title: 'Use OAuth', expected: '# Use OAuth\n', actual: '# Use OAuth, edited\n' }, { id: 'd2', title: 'Keep', expected: 'x', actual: 'x' }],
    commits: [
      { sha: '7d2f00aa11', subject: 'Tweak ADR', paths: ['docs/adr/a.md'], pullRequests: [] },
      { sha: '8e1f00bb22', subject: 'Merge #44', paths: ['docs/adr/a.md'], pullRequests: ['https://github.com/o/r/pull/44'] },
      { sha: '9a0000cc33', subject: 'Merge #45', paths: ['docs/specification.md'], pullRequests: ['https://github.com/o/r/pull/45'] },
    ],
    packagePullRequests: ['https://github.com/o/r/pull/44'],
    commitsChecked: true,
  });
  expect(flags).toEqual([
    'docs/decisions/d1.md differs from the approved decision "Use OAuth". Use the approved text.',
    'docs/adr/a.md changed on main outside a package (commit 7d2f00a, pushed directly).',
    'docs/specification.md changed on main outside a package (commit 9a0000c, pull request #45 has no work package).',
  ]);
  expect(knowledgeFlags({ decisions: [], commits: [], packagePullRequests: [], commitsChecked: false }))
    .toEqual(['Could not check main for protected changes outside packages: the GitHub CLI is not available.']);
});
