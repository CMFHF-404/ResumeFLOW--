import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

test('fixed page bounds reserve space and reject invalid measurements', async () => {
  const result = await build({entryPoints:['utils/resumePageGeometry.ts'], bundle:true, format:'esm', write:false});
  const {fitsSinglePageBounds} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const common = {capacityBottomPx:1000, safetyInsetPx:2, measurementEpsilonPx:0.1};
  for (const [flowBottomPx, expected] of [[998,true],[998.1,true],[998.5,false],[1000,false],[1001,false],[NaN,false],[Infinity,false]]) {
    assert.equal(fitsSinglePageBounds({...common,flowBottomPx}),expected);
  }
  assert.equal(fitsSinglePageBounds({...common,flowBottomPx:0,safetyInsetPx:-1}),false);
  assert.equal(fitsSinglePageBounds({...common,flowBottomPx:0,measurementEpsilonPx:3}),false);
  assert.equal(fitsSinglePageBounds({...common,flowBottomPx:0,measurementEpsilonPx:-1}),false);
});
