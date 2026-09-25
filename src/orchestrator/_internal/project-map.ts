// The project map (orchestrator ADR Q13): docs/README.md in the repository, versioned with the code.
// Groups of `- \`path\` — what it is; when to read it`, optionally tagged (protected).

export interface MapEntry { path: string; description: string; protected: boolean }
export interface MapGroup { heading: string; entries: MapEntry[] }

export const projectMapPath = 'docs/README.md';
const protectedTag = /\s*\(protected\)\s*$/i;

export function parseProjectMap(markdown: string): MapGroup[] {
  const groups: MapGroup[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) { groups.push({ heading: heading[1]!, entries: [] }); continue; }
    const entry = /^\s*[-*]\s+`?([^`\s]+)`?\s+[—–-]\s+(.+)$/.exec(line);
    if (!entry) continue;
    if (!groups.length) groups.push({ heading: 'Project', entries: [] });
    groups.at(-1)!.entries.push({ path: entry[1]!, description: entry[2]!.replace(protectedTag, '').trim(), protected: protectedTag.test(entry[2]!) });
  }
  return groups.filter(group => group.entries.length);
}

// What the app knows about common project files; anything else found is listed for the team to describe.
const known: Array<{ path: string; group: string; description: string; protected?: boolean }> = [
  { path: 'docs/specification.md', group: 'Start here', description: "What the product is and isn't. Read before any feature work.", protected: true },
  { path: 'PRODUCT.md', group: 'Start here', description: 'Users, purpose, and brand commitments.' },
  { path: 'CONTEXT.md', group: 'Start here', description: 'Shared vocabulary for the domain.' },
  { path: 'DESIGN.md', group: 'Brand and UI', description: 'Tokens, type, and the look. Required for any UI change.', protected: true },
  { path: 'docs/mockups/', group: 'Brand and UI', description: 'Saved design decisions. A mockup for a surface is the decision.' },
  { path: 'docs/decisions/', group: 'Decisions and plans', description: 'Official team decisions, written by Console Connect.', protected: true },
  { path: 'docs/adr/', group: 'Decisions and plans', description: 'Architecture and design records.', protected: true },
  { path: 'docs/plans/', group: 'Decisions and plans', description: 'Approved plans and their status.' },
  { path: 'docs/implementation-status.md', group: 'Evidence', description: "What's verified. Update it when you verify something." },
];

export function draftProjectMap(found: string[]) {
  const entries = found.map(path => known.find(item => item.path === path) ?? { path, group: 'Other', description: 'Describe what this is and when to read it.' });
  const groups = [...new Set(entries.map(entry => entry.group))];
  return [
    '# Project map', '',
    'What each document is and when to read it. Console Connect reads this for every brief. Tag an entry (protected) to warn reviewers when a package changes it.', '',
    ...groups.flatMap(group => [`## ${group}`, ...entries.filter(entry => entry.group === group)
      .map(entry => `- \`${entry.path}\` — ${entry.description}${'protected' in entry && entry.protected ? ' (protected)' : ''}`), '']),
  ].join('\n');
}

export const knownProjectPaths = known.map(item => item.path);

const covers = (entry: MapEntry, path: string) => entry.path.endsWith('/') ? path.startsWith(entry.path) : path === entry.path;

// Deliverables look like "path +3 −1"; the path is everything before the counts.
export function protectedChanges(deliverables: string[], groups: MapGroup[]) {
  const guarded = groups.flatMap(group => group.entries).filter(entry => entry.protected);
  return deliverables.map(item => item.replace(/(\s+[+−-]\d+)+$/, '').trim()).filter(path => guarded.some(entry => covers(entry, path)));
}

export function isProtected(path: string, groups: MapGroup[]) {
  return groups.flatMap(group => group.entries).some(entry => entry.protected && covers(entry, path));
}

export interface KnowledgeInput {
  decisions: Array<{ id: string; title: string; expected: string; actual: string | null }>;
  commits: Array<{ sha: string; subject: string; paths: string[]; pullRequests: string[] }>;
  packagePullRequests: string[];
  commitsChecked: boolean;
}

export function knowledgeFlags(input: KnowledgeInput) {
  const flags = input.decisions.filter(item => item.actual !== null && item.actual !== item.expected)
    .map(item => `docs/decisions/${item.id}.md differs from the approved decision "${item.title}". Use the approved text.`);
  if (!input.commitsChecked) return [...flags, 'Could not check main for protected changes outside packages: the GitHub CLI is not available.'];
  for (const commit of input.commits) {
    if (commit.pullRequests.some(url => input.packagePullRequests.includes(url))) continue;
    const how = commit.pullRequests.length ? `pull request #${commit.pullRequests[0]!.split('/').pop()} has no work package` : 'pushed directly';
    for (const path of commit.paths) flags.push(`${path} changed on main outside a package (commit ${commit.sha.slice(0, 7)}, ${how}).`);
  }
  return flags;
}

export function mapLines(groups: MapGroup[]) {
  return groups.flatMap(group => [`${group.heading}:`, ...group.entries.map(entry => `  ${entry.path}: ${entry.description}${entry.protected ? ' (protected)' : ''}`)]);
}
