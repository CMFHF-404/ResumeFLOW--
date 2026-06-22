import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../components/ResumeUploadModal/PreviewPanels.tsx', import.meta.url),
  'utf8'
);
const stateHookSource = readFileSync(
  new URL('../../components/ResumeUploadModal/stateHooks.ts', import.meta.url),
  'utf8'
);

test('ParseModeCard removes the hidden card face from keyboard navigation', () => {
  assert.match(
    source,
    /aria-hidden=\{enableThinking\}/,
    'quick-mode face should be hidden from assistive tech when expert mode is active'
  );
  assert.match(
    source,
    /tabIndex=\{enableThinking \? -1 : 0\}/,
    'quick-mode button should not be tabbable when expert mode is active'
  );
  assert.match(
    source,
    /aria-hidden=\{!enableThinking\}/,
    'expert-mode face should be hidden from assistive tech when quick mode is active'
  );
  assert.match(
    source,
    /tabIndex=\{enableThinking \? 0 : -1\}/,
    'expert-mode button should not be tabbable when quick mode is active'
  );
});

test('ParseModeCard thinking UI is provider-neutral and reset-aware', () => {
  assert.doesNotMatch(
    source,
    /Gemini|Qwen|DashScope|百炼/i,
    'thinking UI should not expose provider branding'
  );
  assert.match(
    stateHookSource,
    /event\.type === 'thought_reset'[\s\S]*setThinkingNodes\(buildEmptyThinkingNodes\(\)\)/,
    'resume parse stream should clear visible thinking nodes on thought_reset'
  );
  assert.match(
    stateHookSource,
    /event\.type === 'thought'[\s\S]*appendThinkingDelta\(prev, event\.summary\)/,
    'resume parse stream should still append thought summaries'
  );
});
