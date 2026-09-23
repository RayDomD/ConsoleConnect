import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkspaceState } from './protocol';

export async function openStore(directory: string) {
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, 'host.lock');
  try {
    const prior = Number(await readFile(lockPath, 'utf8'));
    let running = true;
    try { process.kill(prior, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false;
    }
    if (running) throw new Error('This workspace is already hosted by another process.');
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(String(process.pid));
  const statePath = join(directory, 'workspace.json');
  return {
    async read(): Promise<WorkspaceState | null> {
      try {
        const data = JSON.parse(await readFile(statePath, 'utf8')) as WorkspaceState;
        if (!data.workspace?.id || !Array.isArray(data.members) || !Array.isArray(data.tasks) || !data.credentials) {
          throw new Error('Workspace data is invalid. Restore a backup before starting the host.');
        }
        return data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(state: WorkspaceState) {
      const temporary = join(directory, `workspace-${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
      finally { await file.close(); }
      try { await rename(temporary, statePath); }
      catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    },
    async close() { await lock.close(); await unlink(lockPath); },
  };
}
