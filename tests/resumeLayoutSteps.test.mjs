import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['views/ResumeEditor/layoutUtils.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const layout = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

const builders = [
  layout.buildLineHeightSteps,
  layout.buildFontSizeSteps,
  layout.buildTopPaddingSteps,
  layout.buildItemSpacingSteps,
];

test('layout steps preserve ascending, descending and equal endpoints', () => {
  for (const buildSteps of builders) {
    assert.deepEqual(buildSteps(1, 2, 0.5), [1, 1.5, 2]);
    assert.deepEqual(buildSteps(2, 1, 0.5), [2, 1.5, 1]);
    assert.deepEqual(buildSteps(1.5, 1.5, 0.5), [1.5]);
  }
});

test('layout steps append an unreachable endpoint exactly once', () => {
  for (const buildSteps of builders) {
    assert.deepEqual(buildSteps(1, 2, 0.4), [1, 1.4, 1.8, 2]);
    assert.deepEqual(buildSteps(2, 1, 0.4), [2, 1.6, 1.2, 1]);
    assert.deepEqual(buildSteps(1, 1.5, 2), [1, 1.5]);
    assert.deepEqual(buildSteps(1.5, 1, 2), [1.5, 1]);
  }
});

test('typography steps retain fractional precision and existing default candidates', () => {
  assert.deepEqual(layout.buildLineHeightSteps(1.6, 1.35, 0.05), [1.6, 1.55, 1.5, 1.45, 1.4, 1.35]);
  assert.deepEqual(layout.buildLineHeightSteps(1.35, 1.6, 0.05), [1.35, 1.4, 1.45, 1.5, 1.55, 1.6]);
  assert.deepEqual(layout.LINE_HEIGHT_SHRINK_STEPS, [1.6, 1.55, 1.5, 1.45, 1.4, 1.35]);
  assert.deepEqual(layout.FONT_SIZE_SHRINK_STEPS, [16, 15.5, 15, 14.5, 14, 13.5, 13]);
  assert.deepEqual(layout.LINE_HEIGHT_OPTIONS.map(({ value }) => value), [1.75, 1.7, 1.65, 1.6, 1.55, 1.5, 1.45, 1.4, 1.35]);
  assert.deepEqual(layout.FONT_SIZE_OPTIONS.map(({ value }) => value), [18, 17.5, 17, 16.5, 16, 15.5, 15, 14.5, 14, 13.5, 13]);
});

test('font steps keep one decimal while spacing and line height keep two', () => {
  assert.deepEqual(layout.buildFontSizeSteps(1.26, 1.34, 0.04), [1.3, 1.3, 1.3]);
  for (const buildSteps of [layout.buildLineHeightSteps, layout.buildTopPaddingSteps, layout.buildItemSpacingSteps]) {
    assert.deepEqual(buildSteps(1.26, 1.34, 0.04), [1.26, 1.3, 1.34]);
  }
});

test('reduction from an existing smaller spacing never expands to the minimum', () => {
  assert.deepEqual(layout.buildReductionStepsFromCurrent(0.13, 0.25, 0.25), [0.13]);
  assert.deepEqual(layout.buildReductionStepsFromCurrent(0.25, 0.25, 0.25), [0.25]);
  assert.deepEqual(layout.buildReductionStepsFromCurrent(1, 0.25, 0.25), [1, 0.75, 0.5, 0.25]);
});
