import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importBundledModule = async (entryPoint) => {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonicalStringify preserves the legacy fingerprint semantics exactly', async () => {
  const { canonicalStringify } = await importBundledModule('utils/canonicalStringify.ts');

  assert.equal(canonicalStringify(undefined), 'null');
  assert.equal(canonicalStringify(null), 'null');
  assert.equal(canonicalStringify('text'), '"text"');
  assert.equal(canonicalStringify(true), 'true');
  assert.equal(canonicalStringify(Number.NaN), 'null');
  assert.equal(
    canonicalStringify({
      z: undefined,
      b: 'value',
      a: [3, undefined, null, { z: 1, a: 2 }],
    }),
    '{"a":[3,null,null,{"a":2,"z":1}],"b":"value"}',
  );

  const sparse = new Array(2);
  assert.equal(canonicalStringify(sparse), '[,]');
  assert.throws(() => canonicalStringify(1n), TypeError);
});

test('JD signature compatibility export and persistence fingerprint share the authority', async () => {
  const value = {
    z: { b: 2, a: 1 },
    a: ['second', 'first'],
    omitted: undefined,
  };
  const authority = await importBundledModule('utils/canonicalStringify.ts');
  const signatures = await importBundledModule('hooks/jdAnalysisSignatureUtils.ts');
  const storage = await importBundledModule('views/jdAnalysisStorage.ts');
  const expected = authority.canonicalStringify(value);

  assert.equal(signatures.canonicalStringify(value), expected);
  assert.equal(storage.buildJDAnalysisPersistenceFingerprint(value), expected);
});

test('fingerprint consumers import the leaf authority instead of defining local variants', () => {
  const consumers = [
    ['hooks/jdAnalysisSignatureUtils.ts', '../utils/canonicalStringify'],
    ['views/jdAnalysisStorage.ts', '../utils/canonicalStringify'],
    ['utils/assistantResumeContext.ts', './canonicalStringify'],
  ];

  for (const [path, importPath] of consumers) {
    const source = read(path);
    assert.match(source, new RegExp(`from ["']${importPath.replace('/', '\\/')}["']`));
    assert.doesNotMatch(source, /(?:const|function)\s+canonicalStringify\b/);
    assert.doesNotMatch(source, /const\s+stringifyValue\s*=/);
  }

  const authority = read('utils/canonicalStringify.ts');
  assert.match(authority, /export const canonicalStringify\s*=/);
  assert.doesNotMatch(authority, /^import\s/m);
});
