import { expect, test } from 'vitest';
import { oauthCallbackUrl } from '../src/oauth';
import { receiveOAuthCallback } from '../src/oauth-callback';

test('browser sign-in returns its local callback and releases the listener', async () => {
  const callback = await receiveOAuthCallback(async () => {
    expect((await fetch('http://127.0.0.1:24681/other')).status).toBe(404);
    expect((await fetch(`${oauthCallbackUrl}?code=one-time-code`)).status).toBe(200);
  });
  expect(new URL(callback).searchParams.get('code')).toBe('one-time-code');
  await expect(fetch(oauthCallbackUrl)).rejects.toThrow();
});
