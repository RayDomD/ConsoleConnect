export function repositoryIdentity(value: string) {
  const ssh = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/.exec(value);
  if (ssh) return `${ssh[1]}/${ssh[2]}/${ssh[3]}`.toLowerCase();
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || parts.length < 2) return null;
    return `${url.hostname}/${parts[0]}/${parts[1]!.replace(/\.git$/, '')}`.toLowerCase();
  } catch { return null; }
}
