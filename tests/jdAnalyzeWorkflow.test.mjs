import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importWorkflow = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/jdAnalyzeWorkflow.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('concurrent JD UI workflows upgrade intent without replacing the starting JD context', async () => {
  const { createJDAnalyzeWorkflowCoordinator } = await importWorkflow();
  const coordinator = createJDAnalyzeWorkflowCoordinator();
  let resolveAnalysis;
  const analysisGate = new Promise((resolve) => {
    resolveAnalysis = resolve;
  });
  let workflowCalls = 0;
  let toastCalls = 0;
  let autoNameCalls = 0;
  const workflow = async () => {
    workflowCalls += 1;
    await analysisGate;
    toastCalls += 1;
    return 'done';
  };
  const startingAutoName = async (_result, context) => {
    autoNameCalls += 1;
    assert.equal(context, 'starting JD text');
  };
  const lateAutoName = async () => {
    throw new Error('late trigger must not replace the starting analysis context');
  };

  const automaticTrigger = coordinator.run(workflow, {
    requestAutoName: false,
    autoNameContext: 'starting JD text',
    applyAutoName: startingAutoName,
  });
  const manualTrigger = coordinator.run(async () => 'stale-workflow', {
    requestAutoName: true,
    autoNameContext: 'edited JD text',
    applyAutoName: lateAutoName,
  });

  assert.equal(automaticTrigger, manualTrigger);
  assert.equal(workflowCalls, 1);
  resolveAnalysis();
  assert.equal(await manualTrigger, 'done');
  assert.equal(toastCalls, 1);
  assert.equal(autoNameCalls, 1);
});

test('invalidating a stopped workflow allows immediate retry without stale cleanup', async () => {
  const { createJDAnalyzeWorkflowCoordinator } = await importWorkflow();
  const coordinator = createJDAnalyzeWorkflowCoordinator();
  const deferred = () => {
    let resolve;
    const promise = new Promise((nextResolve) => {
      resolve = nextResolve;
    });
    return { promise, resolve };
  };
  const oldGate = deferred();
  const retryGate = deferred();
  let workflowCalls = 0;
  const options = {
    requestAutoName: false,
    autoNameContext: '',
    applyAutoName: async () => undefined,
  };

  const stopped = coordinator.run(async () => {
    workflowCalls += 1;
    await oldGate.promise;
    return 'stopped';
  }, options);
  coordinator.invalidate();
  const retry = coordinator.run(async () => {
    workflowCalls += 1;
    await retryGate.promise;
    return 'retry';
  }, options);

  assert.notEqual(stopped, retry);
  assert.equal(workflowCalls, 2);
  oldGate.resolve();
  await stopped;
  assert.equal(coordinator.run(async () => 'unexpected', options), retry);
  retryGate.resolve();
  assert.equal(await retry, 'retry');
});
