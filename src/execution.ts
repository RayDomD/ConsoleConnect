import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { repositoryIdentity } from './repository';

const run = promisify(execFile);

export async function prepareWorktree(repositoryPath: string, workspaceRepository: string, taskId: string, directory: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('Choose a valid task.');
  const [{ stdout: rootOutput }, { stdout: remoteOutput }] = await Promise.all([
    run('git', ['-C', repositoryPath, 'rev-parse', '--show-toplevel']),
    run('git', ['-C', repositoryPath, 'remote', 'get-url', 'origin']),
  ]);
  const expected = repositoryIdentity(workspaceRepository);
  if (!expected || repositoryIdentity(remoteOutput.trim()) !== expected) throw new Error('This folder belongs to a different repository.');
  const root = rootOutput.trim();
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
