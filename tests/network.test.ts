import { expect, test } from 'vitest';
import { privateVpnAddress } from '../src/network';

test('hosting chooses only a private VPN interface, never the first public or LAN address', () => {
  const interfaceAt = (address: string) => ({ address, netmask: '255.255.255.0', family: 'IPv4' as const,
    mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/24` });
  expect(privateVpnAddress({ Ethernet: [interfaceAt('26.207.251.197')],
    'Tailscale Tunnel': [interfaceAt('100.101.102.103')] })).toBe('100.101.102.103');
  expect(privateVpnAddress({ Ethernet: [interfaceAt('192.168.1.20')] })).toBeNull();
  expect(privateVpnAddress({ 'Public VPN': [interfaceAt('26.207.251.197')] })).toBeNull();
  expect(privateVpnAddress({ 'Radmin VPN': [interfaceAt('26.207.251.197')] })).toBe('26.207.251.197');
  expect(privateVpnAddress({ 'Tailscale Tunnel': [interfaceAt('100.101.102.103')],
    'Radmin VPN': [interfaceAt('26.207.251.197')] })).toBe('26.207.251.197');
  expect(privateVpnAddress({ Ethernet: [interfaceAt('26.207.251.197')] })).toBeNull();
});
