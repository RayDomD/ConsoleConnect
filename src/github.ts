import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { repositoryIdentity } from './repository';

const run = promisify(execFile);
const statusSchema = z.object({
  url: z.string().url(), state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  reviewDecision: z.string().nullable(), mergedAt: z.string().nullable(),
});
export type PullRequestStatus = z.infer<typeof statusSchema>;

export async function getPullRequestStatus(url: string): Promise<PullRequestStatus> {
  const { stdout } = await run('gh', ['pr', 'view', url, '--json', 'url,state,reviewDecision,mergedAt'],
    { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
  const result = statusSchema.parse(JSON.parse(stdout));
  if (result.url !== url) throw new Error('GitHub returned a different pull request.');
  return result;
}

export async function verifyDecisionDocument(repository: string, decisionId: string, commitSha: string, expected: string) {
  const identity = repositoryIdentity(repository);
  if (!identity) throw new Error('Choose a GitHub repository URL for this workspace.');
  const [hostname, owner, name] = identity.split('/');
  if (!hostname || !owner || !name) throw new Error('The workspace repository is invalid.');
  const endpoint = `repos/${owner}/${name}/contents/docs/decisions/${decisionId}.md?ref=${commitSha}`;
  const { stdout } = await run('gh', ['api', '--hostname', hostname, '--method', 'GET', endpoint],
    { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
  const file = z.object({ type: z.literal('file'), encoding: z.literal('base64'), content: z.string() }).parse(JSON.parse(stdout));
  return Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8') === expected;
}
