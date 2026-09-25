import { connect } from 'node:net';
import type { CliReply, CliRequest } from './pipe';

// Sends one request and waits for one reply. Resolves null when no app is listening.
export function sendCliRequest(path: string, request: CliRequest, timeoutMs = 60_000): Promise<CliReply | null> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let body = '';
    let connected = false;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Console Connect did not answer in time.')); }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => { connected = true; socket.write(`${JSON.stringify(request)}\n`); });
    socket.on('data', chunk => { body += chunk; });
    socket.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(body) as CliReply); }
      catch { reject(new Error('Console Connect sent an unreadable reply.')); }
    });
    socket.on('error', error => {
      clearTimeout(timer);
      if (!connected) resolve(null);
      else reject(error);
    });
  });
}
