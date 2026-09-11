import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('resume print policy protects short headings and permits body fragmentation',()=>{
  const css=readFileSync('index.html','utf8');
  assert.match(css,/\[data-rf-print-heading\][\s\S]*?break-after: avoid-page/);
  assert.match(css,/\[data-rf-item-id\]\s*\{\s*break-inside: auto/);
  assert.match(css,/\.rf-break-avoid\s*\{\s*break-inside: avoid;/);
  assert.match(css,/orphans: 2/);
});
