import { execFile } from 'node:child_process';
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
