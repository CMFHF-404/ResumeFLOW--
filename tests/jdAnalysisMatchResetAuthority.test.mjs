import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
};

test('match-state hook owns one stable reset authority for all seven state groups', () => {
  const source = read('hooks/useJDAnalysisMatchState.ts');
  const resetAuthority = sliceBetween(
    source,
    'const resetAllMatchState = useCallback',
    'const applyMatchScoresForResult = useCallback',
  );
  const resetActions = [
    'applyExperienceMatchScores',
    'applyExperienceMatchTrends',
    'applyCertificationMatchScores',
    'applyCertificationMatchTrends',
    'applySkillMatchScores',
    'applySkillMatchTrends',
    'resetStaleExperienceIds',
  ];

  for (const action of resetActions) {
    assert.equal(
      (resetAuthority.match(new RegExp(`${action}\\(\\);`, 'g')) ?? []).length,
      1,
      `${action} should be invoked exactly once by resetAllMatchState`,
    );
    assert.match(
      resetAuthority,
      new RegExp(`\\n\\s+${action},`),
      `${action} should participate in the stable callback dependency list`,
    );
  }
  assert.match(source, /return \{[\s\S]*?resetAllMatchState,[\s\S]*?\};/);
});

test('all four full-reset triggers delegate to resetAllMatchState', () => {
  const source = read('hooks/useJDAnalysis.ts');
  const persistedRestore = sliceBetween(
    source,
    'const applyPersistedAnalysisState = useCallback',
    'const resetJDAnalysisState = useCallback',
  );
  const resumeReset = sliceBetween(
    source,
    'const resetJDAnalysisState = useCallback',
    '  useEffect(() => {',
  );
  const updateAnalysis = sliceBetween(
    source,
    'const updateAnalysisState = useCallback',
    'const persistResumeEvaluation = useCallback',
  );

  assert.match(
    persistedRestore,
    /if \(hasEvaluationWithoutJd\) \{\s*resetAllMatchState\(\);\s*\}/,
  );
  assert.match(resumeReset, /resetAllMatchState\(\);/);
  assert.match(
    source,
    /if \(analysisContext\.jdInputSignature !== jdInputSignature\) \{[\s\S]*?resetAllMatchState\(\);[\s\S]*?setNeedsReanalysis\(true\);/,
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(isAnalysisStateCurrent\) \{\s*return;\s*\}[\s\S]*?invalidateAnalysisRun\(\);[\s\S]*?resetJDAnalysisState\(\{[\s\S]*?resetPersistedJDAnalysis: true,[\s\S]*?setAnalysisStateIdentity\(analysisIdentity\);/,
  );
  assert.match(
    updateAnalysis,
    /if \(result\.resumeEvaluation\?\.jdMatch === null\) \{\s*resetAllMatchState\(\);\s*\}/,
  );
  assert.equal(
    (source.match(/\bresetAllMatchState\(\);/g) ?? []).length,
    4,
    'the four audited reset paths should be the only full-reset callers',
  );

  for (const legacyResetCall of [
    'applyExperienceMatchScores',
    'applyExperienceMatchTrends',
    'applyCertificationMatchScores',
    'applyCertificationMatchTrends',
    'applySkillMatchScores',
    'applySkillMatchTrends',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`${legacyResetCall}\\(\\);`),
      `${legacyResetCall} empty reset calls should remain behind the authority`,
    );
  }
});
