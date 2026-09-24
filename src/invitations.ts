export type Invitation = { mode: 'supabase'; projectUrl: string; publishableKey: string; code: string }
  | { mode: 'local'; url: string; code: string };

export function invitationLink(invitation: Invitation) {
  const link = new URL(`consoleconnect://invite/${invitation.mode}`);
  if (invitation.mode === 'supabase') {
    link.searchParams.set('project', invitation.projectUrl);
    link.searchParams.set('key', invitation.publishableKey);
  } else link.searchParams.set('host', invitation.url);
  link.searchParams.set('code', invitation.code);
  return link.toString();
}

export function parseInvitationLink(value: string): Invitation {
  let link: URL;
  try { link = new URL(value.trim()); }
  catch { throw new Error('Paste a Console Connect invitation link.'); }
  if (link.protocol !== 'consoleconnect:' || link.hostname !== 'invite') throw new Error('Paste a Console Connect invitation link.');
  const code = link.searchParams.get('code');
  if (!code) throw new Error('This invitation link has no invitation code.');
  if (link.pathname === '/supabase') {
    const projectUrl = link.searchParams.get('project');
    const publishableKey = link.searchParams.get('key');
    if (!projectUrl || !publishableKey) throw new Error('This hosted invitation link is incomplete.');
    const project = new URL(projectUrl);
    if (project.protocol !== 'https:' && !(project.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(project.hostname))) {
      throw new Error('This hosted invitation has an invalid project address.');
    }
    return { mode: 'supabase', projectUrl: project.origin, publishableKey, code };
  }
  if (link.pathname === '/local') {
    const host = link.searchParams.get('host');
    if (!host) throw new Error('This computer-host invitation link is incomplete.');
    const url = new URL(host);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('This invitation has an invalid host address.');
    return { mode: 'local', url: url.origin, code };
  }
  throw new Error('This invitation link has an unknown workspace type.');
}
