// Usage: node --import ./tools/offline-test-guard.mjs --test tests/*.test.mjs
// Keep test fixtures and browser harnesses from reaching configured services.
import net from 'node:net';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import { chromium, firefox, webkit } from 'playwright';

const denyNetwork = () => {
  throw new Error('Network connections are disabled in offline tests');
};

net.Socket.prototype.connect = denyNetwork;
dgram.Socket.prototype.connect = denyNetwork;
dgram.Socket.prototype.send = denyNetwork;
for (const api of [dns, dnsPromises, dns.Resolver.prototype, dnsPromises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(api)) {
    if (/^(?:lookup|resolve|reverse)/.test(name) && typeof api[name] === 'function') {
      api[name] = denyNetwork;
    }
  }
}
syncBuiltinESMExports();

for (const browserType of [chromium, firefox, webkit]) {
  const launch = browserType.launch.bind(browserType);
  browserType.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options = {}) => {
      const context = await newContext({ ...options, offline: true });
      await context.route('**/*', (route) => route.abort());
      return context;
    };
    return browser;
  };
}
