import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importSectionOrder = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/sectionOrder.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('section order authority filters unknowns, removes duplicates, and restores defaults', async () => {
  const { normalizeSectionOrder } = await importSectionOrder();

  assert.deepEqual(normalizeSectionOrder(), [
    'summary',
    'education',
    'work',
    'project',
    'certifications',
    'skills',
  ]);
  assert.deepEqual(
    normalizeSectionOrder(['skills', 'unknown', 'work', 'skills']),
    ['summary', 'skills', 'work', 'education', 'project', 'certifications'],
  );
});

test('editor helpers preserve their export while template storage imports the authority', () => {
  const helpers = readFileSync('views/ResumeEditor/helpers.ts', 'utf8');
  const storage = readFileSync('views/resumeTemplateStorage.ts', 'utf8');

  assert.match(helpers, /export \{ normalizeSectionOrder \} from '\.\/sectionOrder';/);
  assert.match(storage, /import \{ normalizeSectionOrder \} from '\.\/ResumeEditor\/sectionOrder';/);
  assert.doesNotMatch(helpers, /(?:export )?const normalizeSectionOrder\s*=/);
  assert.doesNotMatch(storage, /(?:export )?const normalizeSectionOrder\s*=/);
});
