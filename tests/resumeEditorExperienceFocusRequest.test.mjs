import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importFocusRequest = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/hooks/useResumeEditorExperienceFocusRequest.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const initialState = {
  handledRequestKey: null,
  openedRequestKey: null,
  missingNoticeRequestKey: null,
};

test('experience focus decision keeps loading requests pending', async () => {
  const { resolveResumeEditorExperienceFocusDecision } = await importFocusRequest();
  const decision = resolveResumeEditorExperienceFocusDecision({
    request: { requestId: 1, targetId: 'experience-1' },
    isLoading: true,
    targetExists: false,
    state: initialState,
  });

  assert.equal(decision.kind, 'pending');
  assert.equal(decision.nextState, initialState);
});

test('missing focus targets open and notify once while remaining pending', async () => {
  const { resolveResumeEditorExperienceFocusDecision } = await importFocusRequest();
  const request = { requestId: 2, targetId: 'experience-2' };
  const first = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: false,
    state: initialState,
  });
  const repeated = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: false,
    state: first.nextState,
  });

  assert.equal(first.kind, 'missing');
  assert.equal(first.shouldOpen, true);
  assert.equal(first.shouldNotifyMissing, true);
  assert.equal(first.nextState.handledRequestKey, null);
  assert.equal(repeated.kind, 'missing');
  assert.equal(repeated.shouldOpen, false);
  assert.equal(repeated.shouldNotifyMissing, false);
  assert.equal(repeated.nextState.handledRequestKey, null);
});

test('a refreshed target is focused once and a new request can run', async () => {
  const { resolveResumeEditorExperienceFocusDecision } = await importFocusRequest();
  const request = { requestId: 3, targetId: 'experience-3' };
  const missing = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: false,
    state: initialState,
  });
  const focused = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: true,
    state: missing.nextState,
  });
  const repeated = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: true,
    state: focused.nextState,
  });
  const nextRequest = resolveResumeEditorExperienceFocusDecision({
    request: { requestId: 4, targetId: 'experience-4' },
    isLoading: false,
    targetExists: true,
    state: focused.nextState,
  });

  assert.equal(focused.kind, 'focus');
  assert.equal(focused.shouldOpen, true);
  assert.equal(focused.nextState.handledRequestKey, '3:experience-3');
  assert.equal(repeated.kind, 'idle');
  assert.equal(nextRequest.kind, 'focus');
  assert.equal(nextRequest.shouldOpen, true);
});

test('clearing a request allows the same id and target to be used again', async () => {
  const { resolveResumeEditorExperienceFocusDecision } = await importFocusRequest();
  const request = { requestId: 5, targetId: 'experience-5' };
  const focused = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: true,
    state: initialState,
  });
  const cleared = resolveResumeEditorExperienceFocusDecision({
    request: null,
    isLoading: false,
    targetExists: false,
    state: focused.nextState,
  });
  const reused = resolveResumeEditorExperienceFocusDecision({
    request,
    isLoading: false,
    targetExists: true,
    state: cleared.nextState,
  });

  assert.equal(cleared.nextState.handledRequestKey, null);
  assert.equal(reused.kind, 'focus');
});

test('App consumes successful requests and drops pending focus when leaving the editor', () => {
  const appSource = readFileSync('App.tsx', 'utf8');
  const editorSource = readFileSync('views/ResumeEditor/index.tsx', 'utf8');

  assert.match(
    appSource,
    /setResumeEditorFocusRequest\(\(current\) => \([\s\S]*current\?\.requestId === requestId \? null : current/,
  );
  assert.match(
    appSource,
    /onFocusExperienceRequestHandled=\{handleConsumeResumeEditorFocusRequest\}/,
  );
  assert.match(
    appSource,
    /if \(currentView !== ViewState\.EDITOR\) \{\s*setResumeEditorFocusRequest\(null\);\s*\}/,
  );
  assert.match(editorSource, /onHandled: onFocusExperienceRequestHandled/);
});
