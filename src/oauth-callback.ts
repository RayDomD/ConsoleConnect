import { createServer } from 'node:http';
import { oauthCallbackUrl } from './oauth';

export async function receiveOAuthCallback(openBrowser: () => Promise<void>) {
  const callbackAddress = new URL(oauthCallbackUrl);
  let complete: (url: string) => void = () => {};
  const callback = new Promise<string>(resolve => { complete = resolve; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', callbackAddress);
    if (url.pathname !== callbackAddress.pathname) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Console Connect</title><p>Sign-in complete. You can return to Console Connect.</p>');
    complete(url.toString());
  });
  let timer: NodeJS.Timeout | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(callbackAddress.port), callbackAddress.hostname, () => { server.off('error', reject); resolve(); });
    });
    await openBrowser();
    return await Promise.race([callback, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Sign-in timed out. Check the Supabase redirect address and try again.')), 120000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
