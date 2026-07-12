import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('manual adjustment after smart one-page keeps optimized spacing values', () => {
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(editor, /const previousLayoutDensityRef = useRef\(density\);/);

  const layoutDensityEffect = editor.match(
    /useEffect\(\(\) => \{\s*const hasDensityChanged = previousLayoutDensityRef\.current !== density;[\s\S]*?\}, \[density, isSmartPageApplied\]\);/
  )?.[0] ?? '';

  assert.match(layoutDensityEffect, /if \(!hasDensityChanged\) \{\s*return;\s*\}/);
  assert.match(layoutDensityEffect, /previousLayoutDensityRef\.current = density;/);
  assert.match(layoutDensityEffect, /setSectionSpacingKey\(resolveDefaultSectionSpacingKey\(density\)\);/);
  assert.match(layoutDensityEffect, /setItemSpacingEm\(resolveDefaultItemSpacingEm\(density\)\);/);
});
