import { expect, test } from 'vitest';
import { invitationLink, parseInvitationLink } from '../src/invitations';

test('one hosted invitation link carries connection details and its one-time code', () => {
  const invitation = { mode: 'supabase' as const, projectUrl: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_example', code: 'invite-code' };
  expect(parseInvitationLink(invitationLink(invitation))).toEqual(invitation);
});

test('one computer-host invitation link carries the host address and code', () => {
  const invitation = { mode: 'local' as const, url: 'http://100.10.20.30:24680', code: 'invite-code' };
  expect(parseInvitationLink(invitationLink(invitation))).toEqual(invitation);
});

test('a damaged invitation link cannot be used to join', () => {
  expect(() => parseInvitationLink('https://example.com')).toThrow('Console Connect invitation link');
  expect(() => parseInvitationLink('consoleconnect://invite/supabase?code=abc')).toThrow('incomplete');
});
