import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importTargetRoleUpdate = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceBank/targetRoleUpdate.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('Experience Bank shows the active resume target role before the profile link', () => {
  const view = read('views/ExperienceBank.tsx');
  const roleLabelIndex = view.indexOf('意向岗位');
  const linkLabelIndex = view.indexOf('链接 (LinkedIn/Portfolio)');

  assert.ok(roleLabelIndex >= 0, 'the target role field should be rendered');
  assert.ok(linkLabelIndex > roleLabelIndex, 'the target role field should appear before the link field');
  assert.match(view, /value=\{targetRole\}/);
  assert.match(view, /handleTargetRoleChange\(e\.target\.value\)/);
  assert.match(view, /!activeResumeId/);
});

test('Experience Bank loads and saves target_role through the active resume', () => {
  const hook = read('views/ExperienceBank/useExperienceBankProfile.ts');

  assert.match(hook, /const expectedAuthCacheKey = authUserKey/);
  assert.match(hook, /getActiveResumeId\(expectedAuthCacheKey\)/);
  assert.match(hook, /resumeService\.list\(\{[\s\S]*?expectedAuthCacheKey/);
  assert.match(hook, /if \(!await canCommit\(\)\) return;[\s\S]*?setActiveResumeId\(expectedAuthCacheKey/);
  assert.match(hook, /resumeService\.get\(resumeId, \{\s*expectedAuthCacheKey/);
  assert.match(hook, /detail\.resume\.target_role/);
  assert.match(hook, /updateResumeTargetRoleWithConflictRetry\(\s*activeResumeId,\s*normalizedTargetRole/);
  assert.match(hook, /expectedAuthCacheKey: operation\.expectedAuthCacheKey/);
  assert.match(hook, /setTargetRole\(originalTargetRole\)/);
  assert.match(hook, /onResumeUpdateRef\.current\?\.\(updatedResume\)/);

  const saveHook = hook.slice(hook.indexOf('const handleSaveProfile'));
  const profileCommitIndex = saveHook.indexOf('applyProfileSnapshot(updated)');
  const targetRoleSaveIndex = saveHook.indexOf('updateResumeTargetRoleWithConflictRetry');
  assert.ok(profileCommitIndex >= 0 && profileCommitIndex < targetRoleSaveIndex);
});

test('Experience Bank refreshes the resume version token and retries target_role once after 409', async () => {
  const { updateResumeTargetRoleWithConflictRetry } = await importTargetRoleUpdate();
  const calls = [];
  let updateAttempts = 0;
  const updated = await updateResumeTargetRoleWithConflictRetry('resume-1', '增长产品经理', {
    update: async (resumeId, payload) => {
      calls.push(['update', resumeId, payload.target_role]);
      updateAttempts += 1;
      if (updateAttempts === 1) {
        throw { response: { status: 409 } };
      }
      return {
        id: resumeId,
        user_id: 'user-1',
        title: '主简历',
        target_role: payload.target_role,
        created_at: '2026-08-09T00:00:00.000Z',
        updated_at: '2026-08-09T00:00:02.000Z',
      };
    },
    get: async (resumeId) => {
      calls.push(['get', resumeId]);
      return { resume: {}, experiences: [] };
    },
    waitForMutations: async (resumeId) => {
      calls.push(['wait', resumeId]);
    },
    isConflict: (error) => error?.response?.status === 409,
  });

  assert.equal(updated.target_role, '增长产品经理');
  assert.deepEqual(calls, [
    ['update', 'resume-1', '增长产品经理'],
    ['wait', 'resume-1'],
    ['get', 'resume-1'],
    ['update', 'resume-1', '增长产品经理'],
  ]);
});
