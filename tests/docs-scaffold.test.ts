import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { docsScaffoldBranch, planDocsScaffold, scaffoldDocs } from '../src/docs-scaffold';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });
const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-scaffold-'));
  cleanup.push(root);
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  await git('git', ['init', '--bare', remote]);
  await git('git', ['clone', remote, repo]);
  await git('git', ['-C', repo, 'config', 'user.name', 'Test']);
  await git('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  await mkdir(join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Demo\n');
  await writeFile(join(repo, 'docs', 'specs', 'login.md'), '# Login spec\n');
  await git('git', ['-C', repo, 'add', '.']);
  await git('git', ['-C', repo, ...identity, 'commit', '-m', 'Initial']);
  await git('git', ['-C', repo, 'push', 'origin', 'HEAD']);
  return { repo, remote };
}

const exists = (path: string) => stat(path).then(() => true, () => false);

test('the scaffold adds only missing docs on its own branch, pushes it, and leaves the checkout alone', async () => {
  const { repo, remote } = await project();
  await writeFile(join(repo, 'notes.txt'), 'uncommitted work');
  const plan = await planDocsScaffold(repo);
  expect(plan).toEqual(['docs/README.md', 'docs/ideas/', 'docs/plans/', 'docs/decisions/', 'docs/adr/', 'docs/mockups/', 'docs/session-summaries/']);
  const pullRequests: string[] = [];
  const result = await scaffoldDocs(repo, { openPullRequest: async branch => { pullRequests.push(branch); return null; } });
  expect(result).toEqual({ branch: docsScaffoldBranch, added: plan, pushed: true, pullRequestUrl: null });
  expect(pullRequests).toEqual([docsScaffoldBranch]);
  const files = (await git('git', ['-C', remote, 'ls-tree', '-r', '--name-only', docsScaffoldBranch])).stdout.split('\n').filter(Boolean);
  expect(files).toEqual(expect.arrayContaining(['docs/README.md', 'docs/ideas/.gitkeep', 'docs/session-summaries/.gitkeep', 'docs/specs/login.md']));
  expect(files).not.toContain('docs/specs/.gitkeep');
  expect((await git('git', ['-C', remote, 'show', `${docsScaffoldBranch}:docs/specs/login.md`])).stdout).toBe('# Login spec\n');
  expect((await git('git', ['-C', remote, 'show', `${docsScaffoldBranch}:docs/README.md`])).stdout).toContain('`docs/specs/`');
  expect((await git('git', ['-C', repo, 'branch', '--show-current'])).stdout.trim()).not.toBe(docsScaffoldBranch);
  expect(await exists(join(repo, 'docs', 'ideas'))).toBe(false);
  expect(await readFile(join(repo, 'notes.txt'), 'utf8')).toBe('uncommitted work');
  expect((await git('git', ['-C', repo, 'worktree', 'list'])).stdout.trim().split('\n')).toHaveLength(1);
  await expect(scaffoldDocs(repo, { openPullRequest: async () => null })).rejects.toThrow('already exists');
});

test('a project with every docs folder has nothing to scaffold', async () => {
  const { repo } = await project();
  for (const folder of ['ideas', 'plans', 'decisions', 'adr', 'mockups', 'session-summaries']) {
    await mkdir(join(repo, 'docs', folder), { recursive: true });
    await writeFile(join(repo, 'docs', folder, 'keep.md'), '');
  }
  await writeFile(join(repo, 'docs', 'README.md'), '# Our map\n');
  await git('git', ['-C', repo, 'add', '.']);
  await git('git', ['-C', repo, ...identity, 'commit', '-m', 'Docs']);
  expect(await planDocsScaffold(repo)).toEqual([]);
  expect(await scaffoldDocs(repo, { openPullRequest: async () => null })).toEqual({ branch: docsScaffoldBranch, added: [], pushed: false, pullRequestUrl: null });
  expect((await git('git', ['-C', repo, 'branch', '--list', docsScaffoldBranch])).stdout.trim()).toBe('');
});
