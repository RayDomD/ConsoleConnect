import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareWorktree } from '../src/execution';

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
