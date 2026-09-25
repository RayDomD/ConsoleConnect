import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { draftProjectMap, knownProjectPaths, parseProjectMap, projectMapPath } from './orchestrator';
import { repositoryIdentity } from './repository';

const run = promisify(execFile);
const recentCommitLimit = 20;
const lookupTimeoutMs = 8_000;
const decisionId = /^[0-9A-Za-z-]{1,80}$/;

const readText = (directory: string, path: string) => readFile(join(directory, path), 'utf8').catch(() => null);

// What the brief needs from the repository (orchestrator ADR Q13). Main-folder reads also look for protected
// documents changed on main, asking the GitHub CLI which pull request each recent commit came from.
export async function readProjectKnowledge(directory: string, input: { workspaceRepository: string; decisionIds: string[]; checkMain: boolean }) {
  const mapText = await readText(directory, projectMapPath);
  const decisionFiles: Record<string, string | null> = {};
  for (const id of input.decisionIds.filter(item => decisionId.test(item))) decisionFiles[id] = await readText(directory, `docs/decisions/${id}.md`);
  const protectedPaths = mapText ? parseProjectMap(mapText).flatMap(group => group.entries).filter(entry => entry.protected).map(entry => entry.path) : [];
  const commits: Array<{ sha: string; subject: string; paths: string[]; pullRequests: string[] }> = [];
  let commitsChecked = !input.checkMain || !protectedPaths.length;
  if (input.checkMain && protectedPaths.length) {
    const log = await run('git', ['-C', directory, 'log', `-n${recentCommitLimit}`, '--format=%x00%H%x09%s', '--name-only', '--', ...protectedPaths])
      .then(result => result.stdout, () => '');
    for (const block of log.split('\0').filter(Boolean)) {
      const [header, ...files] = block.split('\n').map(line => line.trim()).filter(Boolean);
      const [sha, subject = ''] = header!.split('\t');
      commits.push({ sha: sha!, subject, paths: files, pullRequests: [] });
    }
    const identity = repositoryIdentity(input.workspaceRepository);
    const [hostname, owner, name] = identity?.split('/') ?? [];
    commitsChecked = Boolean(hostname && owner && name);
    for (const commit of commits) {
      if (!commitsChecked) break;
      try {
        const { stdout } = await run('gh', ['api', '--hostname', hostname!, `repos/${owner}/${name}/commits/${commit.sha}/pulls`, '--jq', '.[].html_url'],
          { timeout: lookupTimeoutMs, windowsHide: true });
        commit.pullRequests = stdout.split('\n').map(line => line.trim()).filter(Boolean);
      } catch { commitsChecked = false; }
    }
  }
  return { mapText, decisionFiles, commits: commitsChecked ? commits : [], commitsChecked };
}

async function exists(path: string) { return stat(path).then(() => true, () => false); }

// Known project files plus any other docs, for the team to describe. Never overwrites an existing map.
export async function writeDraftProjectMap(root: string) {
  if (await exists(join(root, projectMapPath))) throw new Error('docs/README.md already exists. Edit it in your repository.');
  const found: string[] = [];
  for (const path of knownProjectPaths) if (await exists(join(root, path))) found.push(path);
  const docs = await readdir(join(root, 'docs'), { withFileTypes: true }).catch(() => []);
  for (const item of docs) {
    const path = `docs/${item.name}${item.isDirectory() ? '/' : ''}`;
    if (!found.includes(path) && path !== projectMapPath && (item.isDirectory() || item.name.endsWith('.md'))) found.push(path);
  }
  await writeFile(join(root, projectMapPath), draftProjectMap(found));
  return join(root, projectMapPath);
}
