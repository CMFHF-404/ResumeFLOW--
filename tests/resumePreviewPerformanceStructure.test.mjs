import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumePreview uses a dashboard-card scale fast path based on A4 constants', () => {
  const source = read('views/ResumeEditor/components/ResumePreview.tsx');

  assert.match(source, /const isDashboardCardPreview = previewScope === 'dashboard-card'/);
  assert.match(source, /A4_PAGE_WIDTH_MM/);
  assert.match(source, /A4_PAGE_HEIGHT_MM/);
  assert.match(source, /const intrinsicWidth = isDashboardCardPreview[\s\S]*?A4_PAGE_WIDTH_MM/);
  assert.match(source, /const intrinsicHeight = isDashboardCardPreview[\s\S]*?A4_PAGE_HEIGHT_MM/);
  assert.match(source, /resizeObserver\.observe\(previewViewportRef\.current\)/);
  assert.match(source, /if \(!isDashboardCardPreview && previewRef\.current\)/);
  assert.match(source, /if \(!isDashboardCardPreview && previewScrollRef\.current\)/);
  assert.match(source, /scrollbarGutter: previewScope === 'editor' && !usePageScrollOnMobile \? 'stable'/);
  assert.match(source, /resizeFrameId = window\.requestAnimationFrame/);
});

test('ResumePreview avoids editor-only interaction listeners outside the editor', () => {
  const source = read('views/ResumeEditor/components/ResumePreview.tsx');

  const interactionEffect = source.match(/React\.useEffect\(\(\) => \{[\s\S]*?const mediaQueries = \[[\s\S]*?\n    \}, \[[^\]]*\]\);/);
  assert.ok(interactionEffect, 'interaction media query effect should exist');
  assert.match(interactionEffect[0], /if \(previewScope !== 'editor' \|\| typeof window === 'undefined'\)/);

  const touchEffect = source.match(/React\.useEffect\(\(\) => \{[\s\S]*?document\.addEventListener\('touchmove'[\s\S]*?\n    \}, \[[^\]]*\]\);/);
  assert.ok(touchEffect, 'global touch drag effect should exist');
  assert.match(touchEffect[0], /if \(isReadOnly \|\| typeof document === 'undefined'\)/);
});

test('ResumeEditor defers hidden print measurement until hydration is complete', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const measurementHook = read('views/ResumeEditor/hooks/useResumePreviewMeasurement.ts');

  assert.match(editor, /useResumePreviewMeasurement\(\{[\s\S]*enabled:\s*!isEditorBusy/);
  assert.match(
    editor,
    /!isEditorBusy\s*\?\s*<ResumeEditorMeasurePreview \{\.\.\.measurePreviewProps\} \/>/,
  );
  assert.match(measurementHook, /if \(!enabled\) \{/);
  assert.match(measurementHook, /createPreviewMeasurementScheduler\(\{/);
  assert.match(measurementHook, /collect: collectPreviewMeasurement/);
  assert.match(measurementHook, /scheduler\.schedule\(\)/);
  assert.match(
    measurementHook,
    /if \(isCancelled\(\)\) \{\s*return null;\s*\}[\s\S]*return measureResumeLayout/,
  );
});

test('ResumeEditor clears stale print measurement while hidden measurement is disabled', () => {
  const measurementHook = read('views/ResumeEditor/hooks/useResumePreviewMeasurement.ts');

  assert.match(
    measurementHook,
    /if \(!enabled\) \{\s*setPreviewPrintMeasurement\(null\);\s*return undefined;\s*\}/,
  );
});
