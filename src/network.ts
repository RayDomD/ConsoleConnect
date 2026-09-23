import type { NetworkInterfaceInfo } from 'node:os';

const vpnName = /tailscale|wireguard|zerotier|netbird|openvpn|hamachi|vpn/i;

function privateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127);
}

export function privateVpnAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!vpnName.test(name)) continue;
    const found = addresses?.find(item => item.family === 'IPv4' && !item.internal && privateIpv4(item.address));
    if (found) return found.address;
  }
  return null;
}
