import { commandSchema, type Command } from './coordination/_internal/protocol';

const KEY = 'console-connect.pending-commands';
export interface PendingCommand { workspaceId: string; memberId: string; command: Command }

export function loadPending(storage: Storage): PendingCommand[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.flatMap(item => {
      if (typeof item?.workspaceId !== 'string' || typeof item?.memberId !== 'string') return [];
      const parsed = commandSchema.safeParse(item.command);
      return parsed.success ? [{ workspaceId: item.workspaceId, memberId: item.memberId, command: parsed.data }] : [];
    });
  } catch { return []; }
}

export function savePending(storage: Storage, pending: PendingCommand[]) {
  storage.setItem(KEY, JSON.stringify(pending));
}

export async function flushPending(storage: Storage, workspaceId: string, memberId: string,
  send: (command: Command) => Promise<unknown>) {
  const pending = loadPending(storage);
  for (const item of pending) {
    if (item.workspaceId !== workspaceId || item.memberId !== memberId) continue;
    await send(item.command);
    pending.splice(pending.indexOf(item), 1);
    savePending(storage, pending);
  }
}
