import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const buildHarness = async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { useResumeOptimizationWorkspaceNavigation } from './views/ResumeEditor/hooks/useResumeOptimizationWorkspaceNavigation';

        const events = [];
        const config = { authUserKey: 'owner-a', resumeId: 'resume-a', analysisResult: {}, canPersist: true };
        const flow = {
          uiState: 'preview', run: { status: 'preview_ready' }, canResumeLatestRun: false,
          startOptimization: async options => { events.push(['start', options]); return { id: 'started' }; },
          reopenLatestRun: async () => { events.push(['reopen']); return { id: 'reopened' }; },
          getLatestUiState: () => flow.uiState,
          closeWorkspace: async () => { events.push(['close']); return true; },
          revertRun: async () => { events.push(['revert']); return { status: 'reverted' }; },
        };
        const mobileEditorDrawer = {
          open: page => events.push(['mobile-open', page]),
          setReportTab: tab => events.push(['mobile-tab', tab]),
        };
        let latest, update;
        const Harness = () => {
          const [, rerender] = useState(0);
          update = () => flushSync(() => rerender(value => value + 1));
          const [workspaceLayout, setWorkspaceLayout] = useState('list');
          const [rightSidebarSurface, setRightSidebarSurface] = useState(null);
          const [isAssistantSidebarMounted, setIsAssistantSidebarMounted] = useState(true);
          const navigation = useResumeOptimizationWorkspaceNavigation({
            ...config, resumeOptimizationFlow: flow, canPersistCurrentJDAnalysis: () => config.canPersist,
            rightSidebarSurface, setWorkspaceLayout, setRightSidebarSurface, setIsAssistantSidebarMounted,
            mobileEditorDrawer, showToastError: message => { events.push(['error', message]); return 'toast'; },
          });
          latest = { ...navigation, workspaceLayout, rightSidebarSurface, isAssistantSidebarMounted };
          return <>
            <button id="origin">Optimize</button>
            <div inert><button data-resume-optimization-focus-return="true" aria-label="返回 AI 助手">Hidden report</button></div>
            <button id="report-return" data-resume-optimization-focus-return="true" aria-label="返回 AI 助手">Report</button>
            <button id="resume-report-tab" onClick={() => events.push(['report-tab'])}>Resume report</button>
          </>;
        };
        const root = createRoot(document.getElementById('root'));
        flushSync(() => root.render(<Harness />));
        window.navigationTest = {
          config, flow, events, update,
          get hook() { return latest; },
          snapshot: () => ({
            layout: latest.workspaceLayout, surface: latest.rightSidebarSurface,
            mounted: latest.isAssistantSidebarMounted, busy: latest.isResumeOptimizationBusy,
            transitioning: latest.isResumeOptimizationLayoutTransitioning,
            suppress: latest.resumeOptimizationSuppressReturnFocusRef.current,
            restoreReport: latest.resumeOptimizationShouldRestoreReportRef.current,
            returnFocus: latest.resumeOptimizationReturnFocusRef.current?.id ?? null,
          }),
          settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        };
      `,
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
  });
  return result.outputFiles[0].text;
};

test('mounted optimization workspace navigation preserves transition and focus boundaries', async t => {
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(existsSync) : [];
  let browser;
  for (const executablePath of [undefined, ...candidates]) {
    try {
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      break;
    } catch { /* Try an installed Chromium runtime. */ }
  }
  if (!browser) return t.skip('A Chromium runtime is required for mounted navigation checks.');
  t.after(() => browser.close());
  const harness = await buildHarness();
  const withPage = async (run, width = 1200) => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    try {
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: harness });
      await run(page);
    } finally { await page.close(); }
  };

  await t.test('empty selection and both persistence gates avoid starting provider work', () => withPage(async page => {
    const result = await page.evaluate(async () => {
      const api = window.navigationTest;
      await api.hook.handleStartResumeOptimization();
      await api.settle();
      const empty = api.snapshot();
      api.config.canPersist = false;
      await api.hook.handleStartResumeOptimization(['suggestion-a']);
      api.config.canPersist = true;
      const pending = api.hook.handleStartResumeOptimization(['suggestion-a']);
      api.config.canPersist = false;
      await pending;
      await api.settle();
      return { empty, final: api.snapshot(), events: api.events };
    });
    assert.equal(result.empty.surface, 'analysis');
    assert.equal(result.final.surface, 'analysis');
    assert.equal(result.final.transitioning, false);
    assert.deepEqual(result.events.map(event => event[0]), ['error', 'error']);
  }));

  await t.test('start captures focus and reopening an existing plan does not create another plan', () => withPage(async page => {
    const result = await page.evaluate(async () => {
      const api = window.navigationTest;
      document.getElementById('origin').focus();
      await api.hook.handleStartResumeOptimization(['suggestion-a']);
      await api.settle();
      const started = api.snapshot();
      api.flow.canResumeLatestRun = true;
      api.update();
      await api.hook.handleStartResumeOptimization();
      api.flow.run.status = 'planning';
      api.update();
      await api.hook.handleStartResumeOptimization();
      await api.settle();
      return { started, events: api.events };
    });
    assert.equal(result.started.returnFocus, 'origin');
    assert.equal(result.started.surface, 'optimization');
    assert.equal(result.started.layout, 'ai');
    assert.equal(result.started.transitioning, false);
    assert.deepEqual(result.events, [
      ['start', { selectedSuggestionIds: ['suggestion-a'] }], ['reopen'], ['start', { selectedSuggestionIds: [] }],
    ]);
  }));

  await t.test('refused close preserves the workspace; successful close restores the visible desktop report', () => withPage(async page => {
    const result = await page.evaluate(async () => {
      const api = window.navigationTest;
      await api.hook.handleStartResumeOptimization(['suggestion-a']);
      await api.settle();
      api.flow.closeWorkspace = async () => false;
      api.update();
      const refused = await api.hook.handleCloseResumeOptimization();
      const afterRefusal = api.snapshot();
      api.flow.closeWorkspace = async () => true;
      api.update();
      const closed = await api.hook.handleCloseResumeOptimization();
      await api.settle();
      return { refused, afterRefusal, closed, final: api.snapshot(), focused: document.activeElement.id };
    });
    assert.equal(result.refused, false);
    assert.equal(result.afterRefusal.surface, 'optimization');
    assert.equal(result.afterRefusal.suppress, false);
    assert.equal(result.afterRefusal.restoreReport, true);
    assert.equal(result.closed, true);
    assert.equal(result.final.surface, 'analysis');
    assert.equal(result.final.mounted, true);
    assert.equal(result.final.restoreReport, false);
    assert.equal(result.focused, 'report-return');
  }));

  await t.test('finishing on mobile restores the resume tab before opening its report', () => withPage(async page => {
    const events = await page.evaluate(async () => {
      const api = window.navigationTest;
      await api.hook.handleFinishResumeOptimization();
      await api.settle();
      return api.events;
    });
    assert.deepEqual(events, [['close'], ['mobile-tab', 'resume'], ['mobile-open', 'analysis'], ['report-tab']]);
  }, 390));

  await t.test('pending navigation closes once and restores its guard after rejection or destination failure', () => withPage(async page => {
    const result = await page.evaluate(async () => {
      const api = window.navigationTest;
      let release;
      api.flow.closeWorkspace = () => {
        api.events.push(['close']);
        return new Promise(resolve => { release = resolve; });
      };
      api.update();
      const first = api.hook.runResumeOptimizationNavigation(() => api.events.push(['navigate']));
      const repeated = await api.hook.runResumeOptimizationNavigation(() => api.events.push(['duplicate']));
      const during = api.snapshot();
      release(true);
      await first;
      await api.settle();
      const afterSuccess = api.snapshot();
      api.flow.closeWorkspace = async () => { throw Error('close failure'); };
      api.update();
      let closeError;
      try { await api.hook.runResumeOptimizationNavigation(() => api.events.push(['unexpected'])); }
      catch (error) { closeError = error.message; }
      const afterError = api.snapshot();
      api.flow.closeWorkspace = async () => true;
      api.update();
      let destinationError;
      try { await api.hook.runResumeOptimizationNavigation(() => { throw Error('destination failure'); }); }
      catch (error) { destinationError = error.message; }
      const afterDestinationError = api.snapshot();
      const retry = await api.hook.runResumeOptimizationNavigation(() => api.events.push(['retry']));
      return { repeated, during, afterSuccess, closeError, afterError, destinationError, afterDestinationError, retry, events: api.events };
    });
    assert.equal(result.repeated, false);
    assert.equal(result.during.suppress, true);
    assert.equal(result.afterSuccess.layout, 'list');
    assert.equal(result.afterSuccess.mounted, false);
    assert.equal(result.afterSuccess.returnFocus, null);
    assert.equal(result.closeError, 'close failure');
    assert.equal(result.afterError.suppress, false);
    assert.equal(result.destinationError, 'destination failure');
    assert.equal(result.afterDestinationError.suppress, true);
    assert.equal(result.retry, true);
    assert.deepEqual(result.events, [['close'], ['navigate'], ['retry']]);
  }));

  await t.test('revert only closes a reverted run and failed reopen restores the available destination', () => withPage(async page => {
    const result = await page.evaluate(async () => {
      const api = window.navigationTest;
      api.flow.revertRun = async () => null;
      api.update();
      await api.hook.handleRevertResumeOptimization();
      const refused = [...api.events];
      api.flow.revertRun = async () => ({ status: 'reverted' });
      api.update();
      await api.hook.handleRevertResumeOptimization();
      api.flow.uiState = 'closed';
      api.flow.reopenLatestRun = async () => null;
      api.update();
      api.hook.handleResumeOptimizationReturnToPlan();
      await api.settle();
      const withReport = api.snapshot();
      api.config.analysisResult = null;
      api.update();
      api.hook.handleResumeOptimizationReturnToPlan();
      await api.settle();
      return { refused, events: api.events, withReport, withoutReport: api.snapshot() };
    });
    assert.deepEqual(result.refused, []);
    assert.deepEqual(result.events, [['close']]);
    assert.equal(result.withReport.surface, 'analysis');
    assert.equal(result.withReport.layout, 'ai');
    assert.equal(result.withoutReport.surface, null);
    assert.equal(result.withoutReport.layout, 'list');
  }));

  await t.test('owner changes clear transition state while the existing flow owns pending provider work', () => withPage(async page => {
    const result = await page.evaluate(async () => {
      const api = window.navigationTest;
      let resolveStart;
      api.flow.startOptimization = () => new Promise(resolve => { resolveStart = resolve; });
      api.update();
      const pending = api.hook.handleStartResumeOptimization(['suggestion-a']);
      await api.settle();
      const before = api.snapshot();
      api.config.authUserKey = 'owner-b';
      api.config.resumeId = 'resume-b';
      api.update();
      await api.settle();
      const after = api.snapshot();
      resolveStart(null);
      await pending;
      return { before, after };
    });
    assert.equal(result.before.transitioning, true);
    assert.equal(result.before.busy, true);
    assert.equal(result.after.transitioning, false);
  }));
});
