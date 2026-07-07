import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../components/Toast.tsx', import.meta.url),
  'utf8'
);

test('AI thinking toast requests are sanitized before rendering', () => {
  assert.match(
    source,
    /AI_THINKING_FALLBACK_MESSAGE\s*=\s*'正在处理\.\.\.'/,
    'AI thinking toast requests should use a generic fallback message'
  );
  assert.match(
    source,
    /type === 'ai_thinking'[\s\S]*type:\s*'loading'/,
    'AI thinking toast requests should be downgraded to ordinary loading toasts'
  );
  assert.match(
    source,
    /updates\.type === 'ai_thinking'[\s\S]*message:\s*toast\.message/,
    'AI thinking updates should keep the previous generic toast message'
  );
  assert.match(
    source,
    /const safeMessage = type === 'ai_thinking' \? AI_THINKING_FALLBACK_MESSAGE : message;/,
    'direct AI thinking toast props should not render provider thought text'
  );
  assert.match(
    source,
    /<span className="min-w-0 flex-1 whitespace-normal break-words text-sm leading-5 font-medium">\{safeMessage\}<\/span>/,
    'regular toast text should still wrap instead of overflowing narrow layouts'
  );
  assert.doesNotMatch(source, /思考中：\{message\}/);
  assert.doesNotMatch(source, /toast-ai-gradient/);
});
