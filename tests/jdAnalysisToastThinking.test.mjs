import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (path) => readFileSync(path, 'utf8');

test('JD analysis streams Gemini thoughts into the inline thinking area', () => {
  const source = readSource('hooks/useJDAnalysis.ts');

  assert.match(
    source,
    /import \{ extractThoughtHeadline \} from "\.\.\/utils\/aiThought";/,
    'JD analysis thinking area should use the shared thought headline normalizer',
  );
  assert.match(
    source,
    /import \{ JD_ANALYSIS_PROGRESS_NODE_TITLES \} from "\.\.\/views\/ResumeEditor\/constants";/,
    'JD analysis thinking area should reuse the existing progress node labels',
  );
  assert.match(
    source,
    /let hasThoughtTitle = false;/,
    'JD analysis should track whether real model thought titles have arrived',
  );
  assert.match(
    source,
    /event\.type === "thought"[\s\S]*extractThoughtHeadline\(event\.summary\)[\s\S]*appendJDThinkingText\(current,\s*title\)/,
    'Gemini thought events should update the inline thinking display area',
  );
  assert.match(
    source,
    /event\.type === "progress" && !hasThoughtTitle[\s\S]*JD_ANALYSIS_PROGRESS_NODE_TITLES\[event\.node\][\s\S]*setThinkingText\(progressTitle\)/,
    'progress updates should provide a fallback before real thought titles arrive',
  );
  assert.match(
    source,
    /event\.type === "thought_reset"[\s\S]*hasThoughtTitle = false;[\s\S]*setThinkingText\(""\)/,
    'thought_reset should clear the inline thinking display area',
  );
});

test('JD analysis keeps thought capture out of toast and renders the configured thinking area', () => {
  const toastSource = readSource('views/ResumeEditor/hooks/useJdAnalyzeWithToast.ts');
  const panelSource = readSource('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const editorSource = readSource('views/ResumeEditor/index.tsx');

  assert.doesNotMatch(toastSource, /type:\s*'ai_thinking'/);
  assert.doesNotMatch(toastSource, /extractThoughtHeadline/);
  assert.match(panelSource, /思考中：\{thinkingText \|\| '正在分析岗位要求\.\.\.'\}/);
  assert.doesNotMatch(panelSource, /JDThinkingTracePanel/);
  assert.doesNotMatch(editorSource, /thinkingNodes=\{thinkingNodes\}/);
});
