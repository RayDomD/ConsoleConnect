import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findLinkedRepositories } from '../src/local-repository';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });

async function repo(path: string, remotes: Record<string, string>) {
  await git('git', ['init', path]);
  for (const [name, url] of Object.entries(remotes)) await git('git', ['-C', path, 'remote', 'add', name, url]);
}

test('finds clones and forks of the linked repository among sibling folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-find-'));
  cleanup.push(root);
  await repo(join(root, 'clone'), { origin: 'https://github.com/example/project.git' });
  await repo(join(root, 'fork'), { origin: 'git@github.com:someone/project.git', upstream: 'https://github.com/example/project' });
  await repo(join(root, 'other'), { origin: 'https://github.com/example/other.git' });
  await mkdir(join(root, 'plain-folder'));

  const found = await findLinkedRepositories([root, join(root, 'missing')], 'https://github.com/example/project');

  expect(found.map(path => path.replace(/\\/g, '/').split('/').pop()).sort()).toEqual(['clone', 'fork']);
});
