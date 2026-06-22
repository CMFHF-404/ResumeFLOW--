import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importApiStreamUtils = async () => {
  const result = await build({
    entryPoints: ['services/apiStreamUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_LOGTO_APP_ID': 'undefined',
    },
    plugins: [
      {
        name: 'stub-api-client',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^\.\/apiClient$/ }, () => ({
            path: 'api-client-stub',
            namespace: 'stub',
          }));
          buildContext.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export const getApiBaseUrl = () => "https://api.example.com/root/";',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('resolveApiUrl joins configured API base and normalized paths', async () => {
  const { resolveApiUrl } = await importApiStreamUtils();

  assert.equal(resolveApiUrl('/parser/parse/stream'), 'https://api.example.com/root/parser/parse/stream');
  assert.equal(resolveApiUrl('api/analyze-jd/stream'), 'https://api.example.com/root/api/analyze-jd/stream');
});

test('parseNdjsonChunk preserves incomplete trailing records until flush', async () => {
  const { parseNdjsonChunk } = await importApiStreamUtils();

  assert.deepEqual(parseNdjsonChunk('{"a":1}\n{"b"', false), {
    lines: ['{"a":1}'],
    remainder: '{"b"',
  });
  assert.deepEqual(parseNdjsonChunk('{"b":2}', true), {
    lines: ['{"b":2}'],
    remainder: '',
  });
});
