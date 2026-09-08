import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeResumeScore, SCORE_DIMENSIONS, groupScoreSuggestions } from '../utils/resumeScore.mjs';

const report = () => ({ evaluationVersion: 'resume_score_v2', scoringVersion: 'single_pass_v1', summary: '简历评语',
  dimensions: SCORE_DIMENSIONS.map(dimension => ({ dimension, score: 80, comment: '模块评语' })),
  suggestions: [{ suggestionId: 'suggestion-1', moduleType: 'personal_summary', moduleId: 'current_resume', fieldPath: 'personal_summary',
    dimension: '专业表达', problem: '表达过于笼统', direction: '描述具体工作', label: '个人总结', editable: true }] });

test('score shape checks accept extra fields and new facts without rubric or evidence', () => {
  const raw = report(); raw.unused = 'ignored'; raw.dimensions[0].score = 83;
  raw.suggestions[0].direction = '300% / 新工具 / 不同表达';
  const normalized = normalizeResumeScore(raw);
  assert.equal(normalized.overallScore, 81);
  assert.equal(normalized.suggestions[0].direction, raw.suggestions[0].direction);
  assert.equal(normalized.auditReceipt, undefined);
  assert.deepEqual(normalizeResumeScore({ ...raw, suggestions: undefined }).suggestions, []);
});

test('invalid required fields are rejected without coercion or invented scores', () => {
  for (const change of [r => r.dimensions.pop(), r => r.dimensions[0].score = '80', r => r.dimensions[0].score = NaN,
    r => r.dimensions[0] = r.dimensions[1], r => r.suggestions[0].editable = 'true', r => r.summary = {}]) {
    const raw = report(); change(raw); assert.equal(normalizeResumeScore(raw), undefined);
  }
  assert.equal(normalizeResumeScore({ evaluationVersion: 'guidance_audit_v1' }), undefined);
});

test('same experience groups its STAR suggestions without merging different experiences', () => {
  const first = report().suggestions[0];
  assert.equal(groupScoreSuggestions([first, {...first, suggestionId:'suggestion-2'}, {...first, moduleId:'other'}]).length, 2);
});

test('report starts unselected and annotations are absent from read-only export', async () => {
  const dir = mkdtempSync('tests/.tmp-score-');
  const output = `${dir}/components.mjs`;
  try {
    await build({ stdin: { contents: `export {ResumeScoreReport} from './views/ResumeEditor/components/ResumeEvaluationReport/ResumeScoreReport';
      export {ScoreAnnotationProvider, ModuleScoreNote} from './views/ResumeEditor/components/ResumeEvaluationReport/ScoreAnnotations';
      export {ResumeEvaluationReport} from './views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport';`, resolveDir: process.cwd(), loader: 'tsx' },
      bundle:true, format:'esm', platform:'node', outfile:output, external:['react','react-dom','react/jsx-runtime','lucide-react'], logLevel:'silent' });
    const { ResumeScoreReport, ScoreAnnotationProvider, ModuleScoreNote, ResumeEvaluationReport } = await import(pathToFileURL(`${process.cwd()}/${output}`));
    const raw = normalizeResumeScore(report());
    const render = readOnly => renderToStaticMarkup(React.createElement(ScoreAnnotationProvider, {suggestions:raw.suggestions, reportKey:'r1'},
      React.createElement(ModuleScoreNote, {moduleType:'personal_summary',moduleId:'current_resume',readOnly}),
      React.createElement(ResumeScoreReport, {report:raw, outdated:false,enabled:true,busy:false,canStart:true,generating:false,onStart:()=>{throw Error('render must not optimize');}})));
    const editor = render(false), exported = render(true);
    assert.match(editor, /六维简历评估雷达图/);
    assert.match(editor, /优化所选模块（0）/);
    assert.match(editor, /disabled=""/);
    assert.doesNotMatch(editor, /checked=""/);
    assert.match(editor, /data-score-module/);
    assert.doesNotMatch(exported, /data-score-module/);
    assert.doesNotMatch(editor, /自动规则未发现风险|审核通过/);
    const historical = renderToStaticMarkup(React.createElement(ResumeEvaluationReport, {
      evaluation: { evaluationVersion: 'guidance_audit_v1', overallBand: 'strong', confidence: 'medium',
        dimensionGuidance: SCORE_DIMENSIONS.map(dimension => ({dimension, status:'strong', strengths:[],issues:[],actions:[]})) },
      isOptimizationEnabled:true, canStartOptimization:true,
      onGenerate: () => { throw Error('must not automatically spend tokens'); },
      onStartOptimization: () => { throw Error('must not optimize a historical report'); },
    }));
    assert.match(historical, /六维简历评分/);
    assert.match(historical, /六维评分雷达图，尚未评分/);
    assert.match(historical, /生成六维评分/);
    assert.match(historical, /查看历史文字指导（无数值评分）/);
    assert.doesNotMatch(historical, /<details[^>]* open|根据指导优化|RESUME GUIDANCE|0 分|fill="rgba/);

  } finally { rmSync(dir,{recursive:true,force:true}); }
});
