import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { build } from 'esbuild';


const importResumePdfModule = async () => {
  const result = await build({
    entryPoints: ['utils/resumePdf.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('PDF avatar snapshot keeps only bounded raster data URLs', async () => {
  const { normalizeAvatarDataUrlForPdf } = await importResumePdfModule();

  assert.equal(normalizeAvatarDataUrlForPdf(''), '');
  assert.equal(normalizeAvatarDataUrlForPdf('https://example.com/avatar.png'), '');
  assert.equal(normalizeAvatarDataUrlForPdf('file:///etc/passwd'), '');
  assert.equal(normalizeAvatarDataUrlForPdf('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(normalizeAvatarDataUrlForPdf('data:image/png;base64,YWJj'), 'data:image/png;base64,YWJj');
  assert.equal(
    normalizeAvatarDataUrlForPdf(`data:image/png;base64,${'A'.repeat(2_796_208)}`),
    '',
  );
});

test('new PDF flows keep capability tokens and file names out of browser URLs', () => {
  const exportService = readFileSync('services/exportService.ts', 'utf8');
  const resumePage = readFileSync('views/ResumePdfExportPage.tsx', 'utf8');
  const experiencePage = readFileSync('views/ExperienceBankPdfExportPage.tsx', 'utf8');
  const downloadHelper = readFileSync('utils/downloadUrlFile.ts', 'utf8');

  assert.match(exportService, /getRenderSnapshot\(\s*exportId:\s*string,\s*token\?:\s*string/);
  assert.match(exportService, /'X-ResumeFlow-Export-Mode': 'authenticated-v2'/);
  assert.match(exportService, /response = await axios\.get<T>\(path, \{[\s\S]*params: \{ token \}/);
  assert.match(exportService, /response = await apiClient\.get<T>\(path/);
  assert.doesNotMatch(resumePage, /query\.get\(['"]token['"]\)/);
  assert.doesNotMatch(experiencePage, /query\.get\(['"]token['"]\)/);
  assert.match(downloadHelper, /getAuthorizationHeader\(expectedAuthCacheKey\)/);
  assert.match(downloadHelper, /hasSingleLegacyDownloadToken\(url\)/);
  assert.match(downloadHelper, /if \(!isLegacySignedDownload\)[\s\S]*headers\.set\('Authorization', authorization\)/);
  assert.match(downloadHelper, /const requestPath = `\$\{parsedUrl\.pathname\}\$\{parsedUrl\.search\}`/);
  assert.doesNotMatch(downloadHelper, /return parsedUrl \? url : requestPath/);
  assert.match(downloadHelper, /X-ResumeFlow-File-Name/);
  assert.match(downloadHelper, /encodeURIComponent\(fallbackFileName\)/);
});
