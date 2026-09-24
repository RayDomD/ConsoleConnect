import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveLinkedRepository } from './local-repository';

const run = promisify(execFile);

export async function prepareWorktree(repositoryPath: string, workspaceRepository: string, taskId: string, directory: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('Choose a valid task.');
  const root = await resolveLinkedRepository(repositoryPath, workspaceRepository);
  const target = join(directory, taskId);
  const branch = `console-connect/${taskId}`;
  await mkdir(directory, { recursive: true });
  try {
    const existing = await run('git', ['-C', target, 'branch', '--show-current']);
    if (existing.stdout.trim() === branch) return target;
    throw new Error('This task folder belongs to another Git branch.');
  } catch (error) {
    if ((error as Error).message.includes('belongs to another Git branch')) throw error;
  }
  const branchExists = await run('git', ['-C', root, 'show-ref', '--verify', `refs/heads/${branch}`]).then(() => true, () => false);
  await run('git', ['-C', root, 'worktree', 'add', ...(branchExists ? [] : ['-b', branch]), target, ...(branchExists ? [branch] : [])]);
  return target;
}

export interface ChangedFile { path: string; added: number | null; removed: number | null }

// Everything the task changed since its branch began: commits, edits, and new files.
// Line counts are null for binary files and for new files Git does not track yet.
export async function worktreeChanges(directory: string): Promise<ChangedFile[]> {
  const branch = (await run('git', ['-C', directory, 'branch', '--show-current'])).stdout.trim();
  const history = await run('git', ['-C', directory, 'reflog', 'show', '--format=%H', `refs/heads/${branch}`])
    .then(result => result.stdout.trim().split('\n').filter(Boolean), () => []);
  const base = history.at(-1) ?? 'HEAD';
  const [{ stdout: diff }, { stdout: untracked }] = await Promise.all([
    run('git', ['-C', directory, 'diff', '--numstat', base]),
    run('git', ['-C', directory, 'ls-files', '--others', '--exclude-standard']),
  ]);
  const count = (value: string | undefined) => value === undefined || value === '-' ? null : Number(value);
  const files = diff.split('\n').filter(Boolean).map(line => {
    const [added, removed, ...path] = line.split('\t');
    return { path: path.join('\t'), added: count(added), removed: count(removed) };
  });
  for (const path of untracked.split('\n').filter(Boolean)) files.push({ path, added: null, removed: null });
  return files;
}
