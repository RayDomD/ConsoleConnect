import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectMapPath } from './orchestrator';
import { writeDraftProjectMap } from './project-knowledge';

const run = promisify(execFile);
const pullRequestTimeoutMs = 30_000;

// The docs scaffold (guided path ADR, "Docs scaffold"): missing folders and a drafted project map, on a branch with a pull request.
export const docsScaffoldBranch = 'console-connect/docs-scaffold';
const folders = ['docs/ideas/', 'docs/specs/', 'docs/plans/', 'docs/decisions/', 'docs/adr/', 'docs/mockups/', 'docs/session-summaries/'];
const exists = (path: string) => stat(path).then(() => true, () => false);

/** What the scaffold would add to this folder. Existing files and folders are never touched. */
export async function planDocsScaffold(root: string) {
  const missing: string[] = [];
  if (!await exists(join(root, projectMapPath))) missing.push(projectMapPath);
  for (const folder of folders) if (!await exists(join(root, folder))) missing.push(folder);
  return missing;
}

async function openPullRequestWithGh(root: string, branch: string) {
  const body = 'Adds the docs folders Console Connect uses for ideas, specs, plans, and summaries, plus a drafted project map. Nothing existing was changed. Describe each entry in docs/README.md before merging.';
  return run('gh', ['pr', 'create', '--head', branch, '--title', 'docs: set up project docs', '--body', body], { cwd: root, timeout: pullRequestTimeoutMs, windowsHide: true })
    .then(result => result.stdout.trim().split('\n').find(line => /^https:\/\/\S+\/pull\/\d+$/.test(line)) ?? null, () => null);
}

/**
 * Commits the missing docs on their own branch, built in a temporary worktree so the person's checkout and
 * uncommitted work stay as they are, then pushes it and opens a pull request when the GitHub CLI can.
 */
export async function scaffoldDocs(root: string, options: { openPullRequest?: (branch: string) => Promise<string | null> } = {}) {
  const branch = docsScaffoldBranch;
  if (await run('git', ['-C', root, 'show-ref', '--verify', `refs/heads/${branch}`]).then(() => true, () => false)) {
    throw new Error(`The branch ${branch} already exists. Merge or delete it first.`);
  }
  const temporary = await mkdtemp(join(tmpdir(), 'console-connect-docs-'));
  const worktree = join(temporary, 'docs');
  await run('git', ['-C', root, 'worktree', 'add', '-b', branch, worktree, 'HEAD']);
  let committed = false;
  try {
    const added = await planDocsScaffold(worktree);
    if (!added.length) return { branch, added, pushed: false, pullRequestUrl: null };
    for (const folder of added.filter(path => path.endsWith('/'))) {
      await mkdir(join(worktree, folder), { recursive: true });
      await writeFile(join(worktree, folder, '.gitkeep'), '');
    }
    if (added.includes(projectMapPath)) await writeDraftProjectMap(worktree);
    await run('git', ['-C', worktree, 'add', '--', ...added]);
    await run('git', ['-C', worktree, 'commit', '-m', 'docs: set up project docs']);
    committed = true;
    const pushed = await run('git', ['-C', worktree, 'push', '-u', 'origin', branch]).then(() => true, () => false);
    const pullRequestUrl = pushed ? await (options.openPullRequest ?? (name => openPullRequestWithGh(root, name)))(branch) : null;
    return { branch, added, pushed, pullRequestUrl };
  } finally {
    await run('git', ['-C', root, 'worktree', 'remove', '--force', worktree]).catch(() => {});
    await rm(temporary, { recursive: true, force: true });
    if (!committed) await run('git', ['-C', root, 'branch', '-D', branch]).catch(() => {});
  }
}
