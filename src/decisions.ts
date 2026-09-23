import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Decision } from './coordination';
import { repositoryIdentity } from './repository';
import { renderDecisionDocument } from './decision-document';

export { renderDecisionDocument } from './decision-document';

const run = promisify(execFile);

export async function prepareDecisionFile(repositoryPath: string, workspaceRepository: string, decision: Decision) {
  if (decision.status !== 'proposed') throw new Error('Only proposals can be prepared.');
  const [{ stdout: rootOutput }, { stdout: remoteOutput }] = await Promise.all([
    run('git', ['-C', repositoryPath, 'rev-parse', '--show-toplevel']),
    run('git', ['-C', repositoryPath, 'remote', 'get-url', 'origin']),
  ]);
  const expected = repositoryIdentity(workspaceRepository);
  if (!expected || repositoryIdentity(remoteOutput.trim()) !== expected) throw new Error('This folder belongs to a different repository.');
  const directory = join(rootOutput.trim(), 'docs', 'decisions');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${decision.id}.md`);
  const content = renderDecisionDocument(decision);
  try { await writeFile(path, content, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== content) throw new Error('This decision file already exists with different content.');
  }
  return path;
}
