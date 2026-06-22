import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../components/Toast.tsx', import.meta.url),
  'utf8'
);

test('AI thinking toast wraps long summaries instead of clipping them', () => {
  assert.match(
    source,
    /items-start/,
    'AI thinking toast should top-align wrapped text with the icon and close button'
  );
  assert.match(
    source,
    /max-w-\[min\(92vw,42rem\)\]/,
    'AI thinking toast should have a responsive readable max width'
  );
  assert.match(
    source,
    /min-w-0/,
    'AI thinking text should be allowed to shrink inside the flex row'
  );
  assert.match(
    source,
    /whitespace-normal/,
    'AI thinking text should allow multiline wrapping'
  );
  assert.match(
    source,
    /break-words/,
    'AI thinking text should break long provider fragments when needed'
  );
  assert.match(
    source,
    /leading-5/,
    'AI thinking text should keep wrapped lines readable'
  );
  assert.match(
    source,
    /<span className="min-w-0 flex-1 whitespace-normal break-words text-sm leading-5 font-medium">/,
    'regular toast text should also wrap instead of overflowing narrow layouts'
  );
});
