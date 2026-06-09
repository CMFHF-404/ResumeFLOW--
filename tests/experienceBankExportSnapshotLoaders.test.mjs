import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ExperienceBank delegates export snapshot loading to focused loader module', () => {
  const page = read('views/ExperienceBank.tsx');
  const loaders = read('views/ExperienceBank/exportSnapshotLoaders.ts');

  assert.match(page, /from '\.\/ExperienceBank\/exportSnapshotLoaders'/);
  assert.doesNotMatch(page, /profileService\.getProfile/);
  assert.doesNotMatch(page, /certificationsService\.list/);
  assert.doesNotMatch(page, /skillsService\.list/);
  assert.match(loaders, /export const loadExperienceBankExportSnapshot/);
  assert.match(loaders, /export const loadExperienceBankValidationSnapshot/);
  assert.match(loaders, /profileService\.getProfile\(\{ force: true \}\)/);
  assert.match(loaders, /experienceService\.list\('work', \{ force: true \}\)/);
  assert.match(loaders, /experienceService\.peekListForCurrentUser\('education', \{ allowStale: true \}\)/);
  assert.match(loaders, /return null/);
});
