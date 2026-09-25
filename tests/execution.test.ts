import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareWorktree, worktreeChanges, worktreeFacts } from '../src/execution';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });

test('a coding task gets its own reusable Git worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-git-'));
  cleanup.push(root);
  const repo = join(root, 'repo');
  await git('git', ['init', repo]);
  await git('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
  await git('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
  const taskId = randomUUID();
  const path = await prepareWorktree(repo, 'https://github.com/example/project', taskId, join(root, 'worktrees'));
  expect(path).toBe(join(root, 'worktrees', taskId));
  expect((await git('git', ['-C', path, 'branch', '--show-current'])).stdout.trim()).toBe(`console-connect/${taskId}`);
  expect(await prepareWorktree(repo, 'https://github.com/example/project', taskId, join(root, 'worktrees'))).toBe(path);
});

test('a task cannot launch from a different repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-wrong-repo-'));
  cleanup.push(root);
  const repo = join(root, 'repo');
  await git('git', ['init', repo]);
  await git('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/other.git']);
  await git('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
  await expect(prepareWorktree(repo, 'https://github.com/example/project', randomUUID(), join(root, 'worktrees')))
    .rejects.toThrow('different repository');
});

test('a task can launch from a fork linked through upstream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-fork-'));
  cleanup.push(root);
  const repo = join(root, 'fork');
  await git('git', ['init', repo]);
  await git('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:contributor/project.git']);
  await git('git', ['-C', repo, 'remote', 'add', 'upstream', 'https://github.com/example/project.git']);
  await git('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
  const taskId = randomUUID();
  const path = await prepareWorktree(repo, 'https://github.com/example/project', taskId, join(root, 'worktrees'));
  expect((await git('git', ['-C', path, 'branch', '--show-current'])).stdout.trim()).toBe(`console-connect/${taskId}`);
});

test('a task explains when the selected folder is not a Git repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-plain-folder-'));
  cleanup.push(root);
  await expect(prepareWorktree(root, 'https://github.com/example/project', randomUUID(), join(root, 'worktrees')))
    .rejects.toThrow('Choose a local clone or fork of the linked repository');
});

test('a task worktree lists committed, edited, and new files since the task branch began', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-changes-'));
  cleanup.push(root);
  const repo = join(root, 'repo');
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];
  await git('git', ['init', repo]);
  await git('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
  await writeFile(join(repo, 'kept.txt'), 'one\ntwo\n');
  await git('git', ['-C', repo, 'add', '.']);
  await git('git', ['-C', repo, ...identity, 'commit', '-m', 'Initial']);
  const path = await prepareWorktree(repo, 'https://github.com/example/project', randomUUID(), join(root, 'worktrees'));
  expect(await worktreeChanges(path)).toEqual([]);
  await writeFile(join(path, 'committed.txt'), 'a\nb\nc\n');
  await git('git', ['-C', path, 'add', 'committed.txt']);
  await git('git', ['-C', path, ...identity, 'commit', '-m', 'Work']);
  await writeFile(join(path, 'kept.txt'), 'one\nchanged\n');
  await writeFile(join(path, 'new.txt'), 'fresh\n');
  expect(await worktreeChanges(path)).toEqual([
    { path: 'committed.txt', added: 3, removed: 0 },
    { path: 'kept.txt', added: 1, removed: 1 },
    { path: 'new.txt', added: null, removed: null },
  ]);
});

test('a task worktree reports its branch, commit, and changes for the work package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-facts-'));
  cleanup.push(root);
  const repo = join(root, 'repo');
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];
  await git('git', ['init', repo]);
  await git('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
  await git('git', ['-C', repo, ...identity, 'commit', '--allow-empty', '-m', 'Initial']);
  const taskId = randomUUID();
  const path = await prepareWorktree(repo, 'https://github.com/example/project', taskId, join(root, 'worktrees'));
  await writeFile(join(path, 'retry.ts'), 'export const retry = true;\n');
  await git('git', ['-C', path, 'add', '.']);
  await git('git', ['-C', path, ...identity, 'commit', '-m', 'Retry']);
  const head = (await git('git', ['-C', path, 'rev-parse', 'HEAD'])).stdout.trim();
  const facts = await worktreeFacts(path);
  expect(facts).toMatchObject({ branch: `console-connect/${taskId}`, commit: head, files: [{ path: 'retry.ts', added: 1, removed: 0 }] });
  expect(facts.pullRequestUrl).toBeUndefined();
});
