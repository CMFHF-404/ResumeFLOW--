import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Agent API Key UI accepts a secret only from the one-time create response', () => {
  const service = read('services/agentService.ts');
  const modal = read('components/AgentApiPluginConfigModal.tsx');

  assert.match(service, /key\?: null;/);
  assert.doesNotMatch(modal, /resolveActiveFullKey/);
  assert.doesNotMatch(modal, /key\.key/);
  assert.match(modal, /buildAgentInstruction\(revealedKey \|\| '<创建或刷新 API Key 后一次显示>'\)/);
  assert.match(modal, /fullKey = await createAndActivateApiKey\(operation, false\);/);
  assert.match(modal, /expectedActiveKeyId: operation\.expectedActiveKeyId/);
  assert.match(service, /expected_active_key_id: options\.expectedActiveKeyId \?\? null/);
  assert.match(service, /stripNestedAgentApiKeySecret/);
  assert.match(service, /api_key: stripNestedAgentApiKeySecret\(response\.data\.api_key\)/);
  assert.match(modal, /当前 API Key 仅会在创建时显示一次/);
  assert.match(modal, /window\.confirm\('刷新会立即撤销当前 API Key/);
  assert.match(modal, /完整 API Key 仅本次显示，不会保存到当前账号；关闭后无法再次查看。/);
  assert.match(modal, /完整 Key 不会由列表接口返回。/);
});
