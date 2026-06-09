import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importPendingActions = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceBank/pendingActionStorage.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

test('pending resume upload and assistant launch flags round-trip through session storage', async () => {
  const {
    readPendingAssistantLaunch,
    readPendingResumeUpload,
    writePendingAssistantLaunch,
    writePendingResumeUpload,
  } = await importPendingActions();
  const storage = createStorage();

  assert.equal(readPendingResumeUpload(storage), false);
  writePendingResumeUpload(true, storage);
  assert.equal(readPendingResumeUpload(storage), true);
  writePendingResumeUpload(false, storage);
  assert.equal(readPendingResumeUpload(storage), false);

  assert.equal(readPendingAssistantLaunch(storage), false);
  writePendingAssistantLaunch(true, storage);
  assert.equal(readPendingAssistantLaunch(storage), true);
  writePendingAssistantLaunch(false, storage);
  assert.equal(readPendingAssistantLaunch(storage), false);
});

test('pending action helpers ignore unavailable or failing storage', async () => {
  const {
    readPendingAssistantLaunch,
    readPendingResumeUpload,
    writePendingAssistantLaunch,
    writePendingResumeUpload,
  } = await importPendingActions();
  const failingStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };

  assert.equal(readPendingResumeUpload(undefined), false);
  assert.equal(readPendingAssistantLaunch(failingStorage), false);
  assert.doesNotThrow(() => writePendingResumeUpload(true, undefined));
  assert.doesNotThrow(() => writePendingAssistantLaunch(false, failingStorage));
});

test('pending action helpers ignore sessionStorage getter failures', async () => {
  const {
    readPendingAssistantLaunch,
    readPendingResumeUpload,
    writePendingAssistantLaunch,
    writePendingResumeUpload,
  } = await importPendingActions();
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.defineProperty({}, 'sessionStorage', {
      get() {
        throw new Error('blocked getter');
      },
    }),
  });

  try {
    assert.equal(readPendingResumeUpload(), false);
    assert.equal(readPendingAssistantLaunch(), false);
    assert.doesNotThrow(() => writePendingResumeUpload(true));
    assert.doesNotThrow(() => writePendingAssistantLaunch(false));
  } finally {
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});
