import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ExperienceBank delegates PDF export orchestration to a focused hook', () => {
  const page = read('views/ExperienceBank.tsx');
  const hook = read('views/ExperienceBank/useExperienceBankPdfExport.ts');

  assert.match(page, /from '\.\/ExperienceBank\/useExperienceBankPdfExport'/);
  assert.match(page, /useExperienceBankPdfExport\(\{\s*buildCurrentProfileDraftSnapshot,\s*loading,\s*updateToast,/s);
  assert.match(page, /onClick=\{handleExportAll\}/);
  assert.match(page, /disabled=\{isExportingPdf \|\| isLoadingProfile\}/);
  assert.doesNotMatch(page, /from '\.\.\/services\/exportService'/);
  assert.doesNotMatch(page, /from '\.\.\/utils\/downloadUrlFile'/);
  assert.doesNotMatch(page, /buildExperienceBankPdfRenderSnapshot/);
  assert.doesNotMatch(page, /trackExperienceBankExported/);

  assert.match(hook, /const \[isExportingPdf, setIsExportingPdf\] = useState\(false\)/);
  assert.match(hook, /if \(isExportingPdf\) \{\s*return;\s*\}/);
  assert.match(hook, /loadExperienceBankExportSnapshot\(\)/);
  assert.match(hook, /buildCurrentProfileDraftSnapshot\(latestSnapshot\.profile\)/);
  assert.match(hook, /buildExperienceBankExportTitle\(exportDate\)/);
  assert.match(hook, /buildExperienceBankExportDateLabel\(exportDate\)/);
  assert.match(hook, /exportService\.createExperienceBankPdfDownloadLink/);
  assert.match(hook, /downloadUrlFile\(downloadUrl, fileName\)/);
  assert.match(hook, /trackExperienceBankExported\(\{/);
  assert.match(hook, /message: 'PDF 已生成，开始下载。'/);
  assert.match(hook, /message: error instanceof Error \? error\.message : '导出失败，请稍后重试'/);
  assert.match(hook, /setIsExportingPdf\(false\)/);
});
