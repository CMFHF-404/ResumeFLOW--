import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('experience action handlers do not import contract types from the entry hook', () => {
  for (const file of [
    'hooks/experienceActionHandlers/experienceHandlers.ts',
    'hooks/experienceActionHandlers/educationCertificationHandlers.ts',
    'hooks/experienceActionHandlers/skillHandlers.ts',
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /from\s+['"]\.\.\/useExperienceActions['"]/,
      `${file} should import shared contracts from ./types instead of ../useExperienceActions`,
    );
    assert.match(
      source,
      /from\s+['"]\.\/types['"]/,
      `${file} should depend on the handler-local contract module`,
    );
  }
});

test('useExperienceActions keeps legacy type exports while leaving handler-only dependencies in handlers', () => {
  const source = read('hooks/useExperienceActions.ts');
  const reExportMatch = source.match(
    /export\s+type\s+\{([\s\S]*?)\}\s+from\s+['"]\.\/experienceActionHandlers\/types['"]/,
  );

  assert.ok(reExportMatch, 'useExperienceActions should re-export shared contracts for existing callers');
  const reExportBlock = reExportMatch[1];
  for (const name of [
    'CertificationDomain',
    'CertificationState',
    'ConfirmCopy',
    'DraftPrefixes',
    'EducationDomain',
    'EducationState',
    'ExperienceDefaults',
    'ExperienceDomain',
    'ExperienceHelpers',
    'ExperienceState',
    'MatchScoreDomain',
    'SkillDomain',
    'SkillState',
    'ToastApi',
  ]) {
    assert.match(reExportBlock, new RegExp(`\\b${name}\\b`), `${name} should remain exported from useExperienceActions`);
  }
  for (const forbidden of [
    '../services/aiService',
    '../utils/richText',
    '../utils/aiThought',
    '../utils/analyticsTracker',
    './experienceActionHandlers/collectionUtils',
    './experienceActionHandlers/starPayload',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`from\\s+['"]${forbidden.replaceAll('/', '\\/')}['"]`),
      `useExperienceActions should not import handler-only dependency ${forbidden}`,
    );
  }
});
