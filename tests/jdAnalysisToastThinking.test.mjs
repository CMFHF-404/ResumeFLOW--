import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (path) => readFileSync(path, 'utf8');

test('JD analysis streams Gemini thoughts into the inline thinking area', () => {
  const source = readSource('hooks/useJDAnalysis.ts');

  assert.match(
    source,
    /resolveThoughtDisplayEvent/,
    'JD analysis thinking area should use the shared thought event resolver',
  );
  assert.doesNotMatch(source, /JD_ANALYSIS_PROGRESS_NODE_TITLES/);
  assert.match(
    source,
    /resolution\.kind === "model_thought"[\s\S]*appendJDThinkingText\(current,\s*resolution\.text\)/,
    'model thought events should update the inline thinking display area',
  );
  assert.doesNotMatch(source, /resolution\.kind === "status"/);
  assert.match(
    source,
    /resolution\.kind === "reset"[\s\S]*setThinkingText\(""\)/,
    'thought_reset should clear the inline thinking display area',
  );
});

test('JD analysis keeps model thoughts in the inline thinking area instead of toast', () => {
  const toastSource = readSource('views/ResumeEditor/hooks/useJdAnalyzeWithToast.ts');
  const panelSource = readSource('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const editorSource = readSource('views/ResumeEditor/index.tsx');

  assert.match(toastSource, /const result = await handleAnalyze\(\);/);
  assert.doesNotMatch(toastSource, /resolveThoughtDisplayEvent/);
  assert.doesNotMatch(toastSource, /handleAnalyze\(\{\s*onEvent:/);
  assert.doesNotMatch(toastSource, /type:\s*'ai_thinking'/);
  assert.doesNotMatch(toastSource, /showToastLoading/);
  assert.doesNotMatch(toastSource, /updateToast/);
  assert.doesNotMatch(toastSource, /closeToast\(toastId\)/);
  assert.match(panelSource, /thinkingText\?\.trim\(\) \|\| '正在分析岗位要求\.\.\.'/);
  assert.match(panelSource, /思考中：/);
  assert.doesNotMatch(panelSource, /正在思考：/);
  assert.doesNotMatch(panelSource, /JDThinkingTracePanel/);
  assert.doesNotMatch(editorSource, /thinkingNodes=\{thinkingNodes\}/);
});
