import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('useExperienceActions delegates local action state hooks to a dedicated module', () => {
  const source = read('hooks/useExperienceActions.ts');

  assert.match(
    source,
    /from\s+['"]\.\/experienceActionHandlers\/useExperienceActionState['"]/,
    'useExperienceActions should import action state hooks from the handler state module',
  );
  for (const hookName of [
    'useExperienceState',
    'useEducationState',
    'useCertificationState',
    'useSkillState',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`const\\s+${hookName}\\s*=`),
      `${hookName} should not be defined inside useExperienceActions`,
    );
  }
});

test('experience action state module owns all action state hook definitions', () => {
  const source = read('hooks/experienceActionHandlers/useExperienceActionState.ts');

  for (const hookName of [
    'useExperienceState',
    'useEducationState',
    'useCertificationState',
    'useSkillState',
  ]) {
    assert.match(
      source,
      new RegExp(`export\\s+const\\s+${hookName}\\s*=`),
      `${hookName} should be exported by the dedicated action state module`,
    );
  }
});
