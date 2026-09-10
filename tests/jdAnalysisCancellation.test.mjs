import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

// Execute the production callbacks, keeping the asynchronous auth and attachment
// boundaries controllable without mounting the editor or contacting a provider.
const loadCallback = async (name, deps) => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf(`const ${name} = useCallback(`) + `const ${name} = useCallback(`.length;
  const end = name === 'runAnalyze'
    ? source.indexOf('\n    },\n    [', start) + '\n    }'.length
    : source.indexOf('\n  }, [', start) + '\n  }'.length;
  assert.ok(start > 0 && end > start, `production callback ${name} must be found`);
  const compiled = await build({
    stdin: { contents: `export const make = (deps: any) => {
      const { ${Object.keys(deps).join(', ')} } = deps;
      return (${source.slice(start, end)});
    };`, loader: 'ts' },
    write: false, format: 'esm', platform: 'node',
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  return module.make(deps);
};

test('stop during JD owner capture prevents execution and permits a fresh retry', async () => {
  let resolveOwner;
  let current = true;
  let executions = 0;
  let executionParams;
  const deps = {
    canPersistCurrentJDAnalysis: () => true,
    ownerGuard: {
      beginOperation: () => new Promise(resolve => { resolveOwner = resolve; }),
      isOperationCurrent: () => true,
    },
    isAuthContextChangedError: () => false,
    analysisRunIdRef: { current: 0 }, activeAnalysisRunIdRef: { current: 0 },
    abortControllerRef: { current: null },
    activeResumeIdRef: { current: 'resume' }, resumeId: 'resume',
    activeAnalysisIdentityRef: { current: 'owner/resume' }, analysisIdentity: 'owner/resume',
    pendingJDAnalysisConflictRef: { current: null }, authUserKey: 'owner',
    analysisContext: null, analysisResult: null, aiService: {},
    runJDAnalysisExecution: async params => {
      executions += 1;
      executionParams = params;
      return { status: 'success' };
    },
  };
  for (const name of ['setThinkingText', 'setIsAnalyzing', 'buildAnalyzeSnapshot',
    'recordPostAnalyzeDiff', 'updateAnalyzeDiffState', 'updateAnalysisState',
    'applyMatchScoresForResult', 'promoteAttachmentToText', 'clearFullAnalysisDiffState',
    'setIsJDCollapsed', 'setDebugInfo', 'canApplyAnalysisResult', 'resolveThoughtDisplayEvent']) {
    deps[name] = () => {};
  }
  const run = await loadCallback('runAnalyze', deps);
  const stopped = run({ shouldContinue: () => current });
  current = false;
  resolveOwner({ expectedAuthCacheKey: 'owner' });
  assert.deepEqual(await stopped, { status: 'aborted' });
  assert.equal(executions, 0);
  assert.equal(deps.abortControllerRef.current, null);

  current = true;
  const retry = run({ shouldContinue: () => current });
  resolveOwner({ expectedAuthCacheKey: 'owner' });
  assert.equal((await retry).status, 'success');
  assert.equal(executions, 1);
  assert.equal(executionParams.shouldContinue(), true);
  current = false;
  assert.equal(executionParams.shouldContinue(), false);
});

test('stop during attachment preparation never starts the JD run', async () => {
  let resolveSelection;
  let current = true;
  const handle = await loadCallback('handleAnalyze', {
    canPersistCurrentJDAnalysis: () => true,
    analyzeRequestRef: { current: null },
    waitForPendingJdFileSelection: () => new Promise(resolve => { resolveSelection = resolve; }),
    buildAnalyzeSnapshot: () => { throw new Error('cancelled request must not continue'); },
  });
  const request = handle({ shouldContinue: () => current });
  current = false;
  resolveSelection(true);
  assert.deepEqual(await request, { status: 'aborted' });
});

test('rescore authority is forwarded through the editor and JD planner', () => {
  const editor = readFileSync('views/ResumeEditor/index.tsx', 'utf8');
  const hook = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  assert.match(editor, /return handleAnalyze\(\{ shouldContinue: isCurrent \}\)/);
  assert.match(hook, /return runAnalyze\(\{[\s\S]*?shouldContinue: options\?\.shouldContinue/);
});
