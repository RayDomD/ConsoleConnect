import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repositoryIdentity } from './repository';

const run = promisify(execFile);

export async function resolveLinkedRepository(repositoryPath: string, workspaceRepository: string) {
  const { stdout } = await run('git', ['-C', repositoryPath, 'rev-parse', '--show-toplevel'])
    .catch(() => { throw new Error(`${repositoryPath} is not a Git repository. Choose a local clone or fork of the linked repository: ${workspaceRepository}`); });
  const root = stdout.trim();
  const expected = repositoryIdentity(workspaceRepository);
  const remotes = await Promise.all(['origin', 'upstream'].map(name =>
    run('git', ['-C', root, 'remote', 'get-url', name]).then(result => result.stdout.trim(), () => '')));
  if (!expected || !remotes.some(remote => repositoryIdentity(remote) === expected)) {
    throw new Error('This folder belongs to a different repository. Choose its clone or a fork with the linked repository as upstream.');
  }
  return root;
}

// Clones or forks of the linked repository sitting directly inside any of the search roots.
// Only folders with their own .git are asked, so a wide root stays cheap.
export async function findLinkedRepositories(searchRoots: string[], workspaceRepository: string) {
  const candidates = new Set<string>();
  for (const root of searchRoots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory()) candidates.add(join(root, entry.name));
  }
  const checked = await Promise.all([...candidates].map(async folder => {
    try {
      await access(join(folder, '.git'));
      return await resolveLinkedRepository(folder, workspaceRepository);
    } catch { return null; }
  }));
  return [...new Set(checked.filter((path): path is string => path !== null))];
}
