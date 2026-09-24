import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Decision } from './coordination';
import { resolveLinkedRepository } from './local-repository';
import { renderDecisionDocument } from './decision-document';

export { renderDecisionDocument } from './decision-document';

export async function prepareDecisionFile(repositoryPath: string, workspaceRepository: string, decision: Decision) {
  if (decision.status !== 'proposed') throw new Error('Only proposals can be prepared.');
  const root = await resolveLinkedRepository(repositoryPath, workspaceRepository);
  const directory = join(root, 'docs', 'decisions');
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
