import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('offline test preload rejects DNS, TCP, local database, and UDP attempts', () => {
  const guard = new URL('../tools/offline-test-guard.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import dns from 'node:dns';
    import dnsPromises from 'node:dns/promises';
    import net from 'node:net';
    import dgram from 'node:dgram';
    const blocked = /Network connections are disabled/;
    assert.throws(() => dns.lookup('offline.invalid', () => {}), blocked);
    assert.throws(() => dnsPromises.resolve4('offline.invalid'), blocked);
    assert.throws(() => new dns.Resolver().resolve4('offline.invalid', () => {}), blocked);
    assert.throws(() => net.connect({ host: '192.0.2.1', port: 443 }), blocked);
    assert.throws(() => net.connect({ host: '127.0.0.1', port: 5432 }), blocked);
    const udp = dgram.createSocket('udp4');
    assert.throws(() => udp.send('test', 53, '192.0.2.1'), blocked);
    udp.close();
  `], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
