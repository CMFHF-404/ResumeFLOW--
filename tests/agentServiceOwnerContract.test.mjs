import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAgentService = async () => {
  const result = await build({
    entryPoints: ['services/agentService.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_BASE_URL': 'undefined',
    },
    plugins: [{
      name: 'agent-service-api-client-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/apiClient$/ }, () => ({
          path: 'apiClient',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^apiClient$/, namespace: 'stub' }, () => ({
          contents: `
            export const getApiBaseUrl = () => '';
            export default {
              get: (...args) => globalThis.__agentServiceContractTest.get(...args),
              post: (...args) => globalThis.__agentServiceContractTest.post(...args),
              put: (...args) => globalThis.__agentServiceContractTest.put(...args),
              delete: (...args) => globalThis.__agentServiceContractTest.delete(...args),
            };
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
};

test('create sends owner/CAS context and strips the duplicate nested plaintext secret', async () => {
  const calls = [];
  globalThis.__agentServiceContractTest = {
    get: async () => ({ data: [] }),
    put: async () => ({ data: {} }),
    delete: async () => undefined,
    post: async (...args) => {
      calls.push(args);
      return {
        data: {
          key: 'top-level-secret',
          api_key: {
            id: 'replacement-a',
            name: 'Agent',
            key_prefix: 'rfag_replace',
            key: 'nested-secret-must-not-survive',
            created_at: '2026-08-24T00:00:00Z',
            revoked_at: null,
          },
        },
      };
    },
  };

  try {
    const { agentService } = await importAgentService();
    const result = await agentService.createApiKey('Agent', true, {
      expectedAuthCacheKey: 'owner-a',
      expectedActiveKeyId: 'active-a',
    });

    assert.deepEqual(calls[0][1], {
      name: 'Agent',
      rotate: true,
      expected_active_key_id: 'active-a',
    });
    assert.deepEqual(calls[0][2], { expectedAuthCacheKey: 'owner-a' });
    assert.equal(result.key, 'top-level-secret');
    assert.equal(Object.hasOwn(result.api_key, 'key'), false);
  } finally {
    delete globalThis.__agentServiceContractTest;
  }
});

test('legacy callers still omit the CAS field instead of silently asserting null', async () => {
  const calls = [];
  globalThis.__agentServiceContractTest = {
    get: async () => ({ data: [] }),
    put: async () => ({ data: {} }),
    delete: async () => undefined,
    post: async (...args) => {
      calls.push(args);
      return {
        data: {
          key: 'secret',
          api_key: {
            id: 'key-a',
            name: 'Agent',
            key_prefix: 'rfag_key',
            created_at: '2026-08-24T00:00:00Z',
          },
        },
      };
    },
  };

  try {
    const { agentService } = await importAgentService();
    await agentService.createApiKey('Agent');
    assert.equal(Object.hasOwn(calls[0][1], 'expected_active_key_id'), false);
  } finally {
    delete globalThis.__agentServiceContractTest;
  }
});
