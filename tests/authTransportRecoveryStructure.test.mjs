import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('all authenticated transports delegate 401 and auth 503 handling to one coordinator', () => {
  const apiClient = read('services/apiClient.ts');
  const aiStream = read('services/aiStreamUtils.ts');
  const parser = read('services/parserService.ts');

  assert.match(apiClient, /handleAuthFailure\(\{/);
  assert.doesNotMatch(apiClient, /status === 401[\s\S]{0,160}dispatchLoginRequired/);

  for (const source of [aiStream, parser]) {
    assert.match(source, /handleFetchAuthFailure\(/);
    assert.match(source, /response\.status === 401 \|\| response\.status === 503/);
    assert.doesNotMatch(source, /response\.status === 401\)[\s\S]{0,120}dispatchLoginRequired/);
  }
});

test('auth recovery never retries write requests and clears only on the profile probe', () => {
  const apiClient = read('services/apiClient.ts');
  const coordinator = read('services/authRecoveryCoordinator.ts');

  assert.match(apiClient, /markProtectedAuthSuccess\(/);
  assert.match(
    coordinator,
    /markProtectedAuthSuccess[\s\S]*profile[\s\S]*resetAuthRecoveryCycle/,
  );
  assert.doesNotMatch(apiClient, /apiClient\(error\.config\)/);
  assert.doesNotMatch(aiOrParserSources(), /fetch\([^)]*\)[\s\S]{0,300}fetch\(/);
});

test('AuthGuard keeps a bounded protected profile probe alive while dependency UI replaces children', () => {
  const authGuard = read('components/AuthGuard.tsx');
  assert.match(authGuard, /scheduleAuthDependencyProbe\(/);
  assert.match(authGuard, /apiClient\.get\(['"]\/profile['"]/);
  assert.match(authGuard, /suppressAuthRecovery: true/);
  assert.match(authGuard, /recoveryIssue\?\.kind !== 'dependency-unavailable'/);
  assert.match(authGuard, /return cancelProbe/);
});

const aiOrParserSources = () => [
  read('services/aiStreamUtils.ts'),
  read('services/parserService.ts'),
].join('\n');
