import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const collectTypeScriptFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(absolute);
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });

test('root lower layers do not import UI-owned modules', () => {
  const lowerLayers = ['hooks', 'services', 'utils', 'constants', 'types'];
  const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

  for (const layer of lowerLayers) {
    for (const file of collectTypeScriptFiles(path.join(root, layer))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        const segments = match[1].replaceAll('\\', '/').split('/');
        assert.equal(
          segments.includes('components') || segments.includes('views'),
          false,
          `${path.relative(root, file)} imports UI-owned module ${match[1]}`,
        );
      }
    }
  }
});

test('root hooks do not depend on component-owned debounce helper', () => {
  const source = read('hooks/useResumeData.ts');
  assert.match(source, /from ['"]\.\/useDebounce['"]/);
  assert.doesNotMatch(source, /components[\\/]hooks[\\/]useDebounce/);
  assert.equal(fs.existsSync(path.join(root, 'components/hooks/useDebounce.ts')), false);
});

test('PDF utility uses pure shared layout constants and editor keeps compatibility exports', () => {
  const pdfSource = read('utils/resumePdf.ts');
  const editorConstants = read('views/ResumeEditor/constants.ts');
  assert.match(pdfSource, /from ['"]\.\.\/constants\/resumeLayout['"]/);
  assert.doesNotMatch(pdfSource, /views[\\/]ResumeEditor[\\/]constants/);
  assert.match(editorConstants, /export \{[\s\S]*FONT_SIZE_DEFAULT[\s\S]*LINE_HEIGHT_DEFAULT[\s\S]*\} from ['"]\.\.\/\.\.\/constants\/resumeLayout['"]/);
});
