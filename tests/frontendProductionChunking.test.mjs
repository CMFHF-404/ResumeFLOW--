import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build as viteBuild } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const MAX_PRODUCTION_CHUNK_BYTES = 500_000;

const normalizePath = (value) => value.replaceAll('\\', '/');

const collectChunks = (buildResult) => {
  const outputs = Array.isArray(buildResult) ? buildResult : [buildResult];
  return outputs.flatMap((output) => output.output)
    .filter((entry) => entry.type === 'chunk');
};

const findChunkContainingModule = (chunks, moduleSuffix) => chunks.find((chunk) => (
  chunk.moduleIds.some((moduleId) => normalizePath(moduleId).endsWith(moduleSuffix))
));

const collectStaticEntryDependencies = (entryChunk, chunkByFileName) => {
  const reachable = new Set();
  const visit = (fileName) => {
    if (reachable.has(fileName)) return;
    reachable.add(fileName);
    const chunk = chunkByFileName.get(fileName);
    chunk?.imports.forEach(visit);
  };
  visit(entryChunk.fileName);
  return reachable;
};

const findStaticImportCycle = (chunks, chunkByFileName) => {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  const visit = (fileName) => {
    if (visiting.has(fileName)) {
      return [...stack.slice(stack.indexOf(fileName)), fileName];
    }
    if (visited.has(fileName)) return null;
    visiting.add(fileName);
    stack.push(fileName);
    const chunk = chunkByFileName.get(fileName);
    for (const dependency of chunk?.imports ?? []) {
      if (!chunkByFileName.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(fileName);
    visited.add(fileName);
    return null;
  };

  for (const chunk of chunks) {
    const cycle = visit(chunk.fileName);
    if (cycle) return cycle;
  }
  return null;
};

test('production entry keeps deferred UI out of the static graph and below the chunk budget', {
  timeout: 120_000,
}, async () => {
  const buildResult = await viteBuild({
    root: repoRoot,
    configFile: path.join(repoRoot, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'silent',
    build: {
      write: false,
    },
  });
  const chunks = collectChunks(buildResult);
  const chunkByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const entryChunk = chunks.find((chunk) => chunk.isEntry);
  assert.ok(entryChunk, 'production entry chunk is missing');

  const oversized = chunks
    .map((chunk) => ({
      bytes: Buffer.byteLength(chunk.code),
      fileName: chunk.fileName,
    }))
    .filter(({ bytes }) => bytes > MAX_PRODUCTION_CHUNK_BYTES);
  assert.deepEqual(oversized, [], `production chunks exceed ${MAX_PRODUCTION_CHUNK_BYTES} bytes`);

  const staticEntryDependencies = collectStaticEntryDependencies(entryChunk, chunkByFileName);
  for (const moduleSuffix of [
    '/components/FeedbackModal.tsx',
    '/components/AgentApiPluginConfigModal.tsx',
    '/components/TokenQuotaModal.tsx',
    '/node_modules/react-datepicker/dist/index.es.js',
  ]) {
    const ownerChunk = findChunkContainingModule(chunks, moduleSuffix);
    assert.ok(ownerChunk, `missing production module: ${moduleSuffix}`);
    assert.equal(
      staticEntryDependencies.has(ownerChunk.fileName),
      false,
      `${moduleSuffix} must not be loaded by the static entry graph`,
    );
  }

  assert.equal(
    findStaticImportCycle(chunks, chunkByFileName),
    null,
    'production chunks contain a static import cycle',
  );
});
