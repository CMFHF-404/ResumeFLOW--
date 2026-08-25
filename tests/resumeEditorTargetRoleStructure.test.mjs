import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('personal profile edits the current resume target role above the link field', () => {
  const profileTab = read('views/ResumeEditor/components/ProfileTab.tsx');
  const roleLabelIndex = profileTab.indexOf('意向岗位');
  const linkLabelIndex = profileTab.indexOf('链接');

  assert.ok(roleLabelIndex >= 0, 'the target role field should be rendered');
  assert.ok(linkLabelIndex > roleLabelIndex, 'the target role field should appear above the link field');
  assert.match(profileTab, /value=\{targetRole\}/);
  assert.match(profileTab, /setTargetRole\(event\.target\.value\)/);
});

test('profile save persists target_role and updates editor and Dashboard resume state', () => {
  const actions = read('views/ResumeEditor/hooks/useProfileEditActions.ts');
  const editor = read('views/ResumeEditor/index.tsx');
  const dashboardSync = read('views/ResumeEditor/hooks/useDashboardResumeSync.ts');

  assert.match(actions, /resumeService\.update\(\s*resumeId,\s*\{ target_role: normalizedTargetRole \},\s*\{ expectedAuthCacheKey: operation\.expectedAuthCacheKey \}/);
  assert.match(actions, /else \{\s*await flushResumeConfig\(\);\s*await ownerGuard\.assertOperationCurrent\(operation\);\s*\}/);
  assert.match(actions, /applyResumeDetail\(/);
  assert.match(actions, /updateDashboardCache\(updatedResume\)/);
  assert.match(
    dashboardSync,
    /replaceDashboardResumeFromServer\(cachedResumes, updated, authUserKey\)/,
  );
  assert.match(editor, /targetRole,\s*setTargetRole/);
  assert.match(editor, /updateDashboardCache,\s*flushResumeConfig,/);
  assert.match(editor, /profileTabProps: \{[\s\S]*?targetRole,[\s\S]*?setTargetRole/);

  const saveAction = actions.slice(actions.indexOf('const handleSaveProfile'));
  const globalProfileSaveIndex = saveAction.indexOf('profileService.updateProfile');
  const versionDrainIndex = saveAction.indexOf('await waitForResumeMutations(resumeId)');
  const versionRefreshIndex = saveAction.indexOf('await resumeService.get(resumeId, {');
  const configSaveIndex = saveAction.indexOf('await flushResumeConfig()');
  assert.ok(
    globalProfileSaveIndex >= 0
      && globalProfileSaveIndex < versionDrainIndex
      && versionDrainIndex < versionRefreshIndex,
    'an already-global profile save should refresh the resume token after backend synchronization'
  );
  assert.match(
    actions,
    /profileSyncMode === PROFILE_SYNC_MODES\.global\s*&& originalProfileSyncMode === PROFILE_SYNC_MODES\.global\s*&& resumeId/
  );
  assert.match(actions, /latestResumeDetail = await resumeService\.get\(resumeId, \{[\s\S]*expectedAuthCacheKey[\s\S]*await ownerGuard\.assertOperationCurrent\(operation\);\s*applyResumeDetail\(latestResumeDetail\);/);
  assert.ok(
    versionRefreshIndex < configSaveIndex,
    'local and sync-mode transition saves should use the config flush fallback branch'
  );
  assert.ok(
    versionRefreshIndex < saveAction.indexOf('resumeService.update(\n                    resumeId')
      && configSaveIndex < saveAction.indexOf('resumeService.update(\n                    resumeId'),
    'both resume preparation branches should finish before target_role persistence can conflict'
  );
  assert.match(actions, /个人信息已保存，但简历同步设置保存失败/);
  assert.match(actions, /个人信息已保存，但简历状态刷新失败/);
  assert.match(
    saveAction.slice(saveAction.indexOf('}, [')),
    /originalProfileSyncMode,/
  );
});

test('preview, Dashboard snapshot, and PDF export use target role instead of the internal resume title', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const preview = read('views/ResumeEditor/components/ResumePreview.tsx');
  const deepHireHeader = read('views/ResumeEditor/components/ResumePreview/sections/DeepHireHeaderBlock.tsx');
  const dashboardState = read('views/Dashboard/resumePreviewState.ts');
  const pdfDocument = read('views/ResumeEditor/components/ResumePdfDocument.tsx');
  const pdfBuilder = read('utils/resumePdf.ts');

  assert.match(editor, /const sharedPreviewProps:[\s\S]*?targetRole,/);
  assert.match(preview, /targetRole\?: string/);
  assert.match(deepHireHeader, /targetRole\?: string/);
  assert.match(deepHireHeader, /\{targetRole\}/);
  assert.doesNotMatch(deepHireHeader, /resumeDisplayTitle/);
  assert.match(dashboardState, /targetRole: detail\.resume\.target_role\?\.trim\(\) \?\? ''/);
  assert.match(pdfDocument, /targetRole=\{snapshot\.targetRole\}/);
  assert.match(pdfBuilder, /targetRole: targetRole\.trim\(\)/);
});
