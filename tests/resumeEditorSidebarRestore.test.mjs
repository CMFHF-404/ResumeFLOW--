import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('ResumeEditor.tsx', readFileSync(new URL('../views/ResumeEditor/index.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, state) {
  let target;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) target = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(target, `${name} exists`);
  const body = ts.transpileModule(`const handler = ${target.getText(source)};`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function('state', `
    const {workspaceLayout,rightSidebarSurface,analysisResult,isAssistantSidebarMounted,isResumeOptimizationBusy,
      lastRightSidebarSurfaceRef,workspaceLayoutRequestRef,resumeOptimizationFlow} = state;
    const resumeOptimizationShouldRestoreReportRef = {current:false};
    const resumeOptimizationReturnFocusRef = {current:null};
    const setWorkspaceLayout = value => state.workspaceLayout = value;
    const setRightSidebarSurface = value => state.rightSidebarSurface = value;
    const openResumeAssistantSidebar = () => {state.assistantLaunches++; state.rightSidebarSurface='assistant';};
    ${body}
    return handler;
  `)(state);
}

const createState = (overrides={}) => ({workspaceLayout:'ai',rightSidebarSurface:'analysis',analysisResult:{},
  isAssistantSidebarMounted:true,isResumeOptimizationBusy:false,assistantLaunches:0,workspaceLayoutRequestRef:{current:0},lastRightSidebarSurfaceRef:{current:'analysis'},
  resumeOptimizationFlow:{closeWorkspace:async()=>true,canResumeLatestRun:true,reopenLatestRun:async()=>({id:'run-a'})},...overrides});

test('closing a report then reopening AI layout restores the report, even with an assistant underneath', async () => {
  const state=createState();
  callback('handleCloseJDAnalysisDetailsSidebar',state)();
  assert.equal(state.workspaceLayout,'list'); assert.equal(state.rightSidebarSurface,null);
  await callback('handleWorkspaceLayoutChange',state)('ai');
  assert.equal(state.rightSidebarSurface,'analysis'); assert.equal(state.assistantLaunches,0);
});

test('list/triple toggles restore the last surface without launching another assistant conversation', async () => {
  for (const surface of ['analysis','assistant']) {
    const state=createState({rightSidebarSurface:surface});
    await callback('handleWorkspaceLayoutChange',state)('list');
    assert.equal(state.lastRightSidebarSurfaceRef.current,surface);
    await callback('handleWorkspaceLayoutChange',state)('triple');
    assert.equal(state.rightSidebarSurface,surface); assert.equal(state.assistantLaunches,0);
  }
});

test('unavailable history falls back safely; a resumable optimization reopens without creating a plan', async () => {
  const state=createState({rightSidebarSurface:null,workspaceLayout:'list',analysisResult:null,isAssistantSidebarMounted:false});
  await callback('handleWorkspaceLayoutChange',state)('ai');
  assert.equal(state.assistantLaunches,1);
  const optimization=createState({rightSidebarSurface:null,workspaceLayout:'list',lastRightSidebarSurfaceRef:{current:'optimization'}});
  let reads=0; optimization.resumeOptimizationFlow.reopenLatestRun=async()=>{reads++;return {id:'run-a'};};
  await callback('handleWorkspaceLayoutChange',optimization)('ai');
  assert.equal(optimization.rightSidebarSurface,'optimization'); assert.equal(reads,1); assert.equal(optimization.assistantLaunches,0);
});

test('busy or declined optimization close keeps the current page intact', async () => {
  for (const busy of [true,false]) {
    const state=createState({rightSidebarSurface:'optimization',isResumeOptimizationBusy:busy});
    state.resumeOptimizationFlow.closeWorkspace=async()=>false;
    await callback('handleWorkspaceLayoutChange',state)('list');
    assert.equal(state.rightSidebarSurface,'optimization'); assert.equal(state.workspaceLayout,'ai');
  }
});


test('a delayed optimization restore cannot reopen a sidebar the user has closed again', async () => {
  const state=createState({rightSidebarSurface:null,workspaceLayout:'list',lastRightSidebarSurfaceRef:{current:'optimization'}});
  let finish; state.resumeOptimizationFlow.reopenLatestRun=()=>new Promise(resolve=>{finish=resolve;});
  const opening=callback('handleWorkspaceLayoutChange',state)('ai');
  await callback('handleWorkspaceLayoutChange',state)('list');
  finish({id:'run-a'}); await opening;
  assert.equal(state.workspaceLayout,'list'); assert.equal(state.rightSidebarSurface,null);
});
