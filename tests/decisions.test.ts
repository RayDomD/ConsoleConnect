import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareDecisionFile, renderDecisionDocument } from '../src/decisions';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });

test('a proposed decision prepares one Markdown file in the matching local repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-connect-decision-'));
  cleanup.push(root);
  const repo = join(root, 'repo');
  await git('git', ['init', repo]);
  await git('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
  const decision = { id: randomUUID(), title: 'Use OAuth', body: 'Use OAuth for sign-in.', proposedBy: randomUUID(),
    createdAt: '2026-09-23T00:00:00Z', status: 'proposed' as const, affectedTaskIds: [] };
  const path = await prepareDecisionFile(repo, 'https://github.com/example/project', decision);
  expect(path).toBe(join(repo, 'docs', 'decisions', `${decision.id}.md`));
  expect(await readFile(path, 'utf8')).toBe(renderDecisionDocument(decision));
  expect(await prepareDecisionFile(repo, 'https://github.com/example/project', decision)).toBe(path);
  await expect(prepareDecisionFile(repo, 'https://github.com/other/project', decision)).rejects.toThrow('different repository');
});
