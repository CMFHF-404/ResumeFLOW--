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
    const render = (readOnly, previewVisible = true) => renderToStaticMarkup(React.createElement(ScoreAnnotationProvider, {suggestions:raw.suggestions, reportKey:'r1', previewVisible},
      React.createElement(ModuleScoreNote, {moduleType:'personal_summary',moduleId:'current_resume',readOnly}),
      React.createElement(ResumeScoreReport, {report:raw, outdated:false,enabled:true,busy:false,canStart:true,generating:false,onStart:()=>{throw Error('render must not optimize');}})));
    const editor = render(false), exported = render(true);
    assert.match(editor, /六维简历评估雷达图/);
    assert.match(editor, /优化所选模块（0）/);
    assert.match(editor, /disabled=""/);
    assert.doesNotMatch(editor, /checked=""/);
    assert.match(editor, /data-score-module/);
    assert.doesNotMatch(exported, /data-score-module/);
    const hiddenPreview = render(false, false);
    assert.doesNotMatch(hiddenPreview, /data-score-module/);
    assert.match(hiddenPreview, /六维简历评估雷达图/);
    assert.match(hiddenPreview, /优化所选模块（0）/);
    assert.doesNotMatch(editor, /自动规则未发现风险|审核通过/);
    const actionProps = { report: raw, outdated: false, enabled: true, busy: false, canStart: true,
      onGenerate: () => {}, onStop: () => {}, onStart: () => {} };
    const idle = renderToStaticMarkup(React.createElement(ResumeScoreReport, {...actionProps, generating: false}));
    const staleJdReason = 'JD 匹配已过期，请重新进行 JD 匹配。';
    const staleJd = renderToStaticMarkup(React.createElement(ResumeScoreReport, {
      ...actionProps, generating: false, canStart: false, disabledReason: staleJdReason,
    }));
    assert.ok(staleJd.includes(staleJdReason), 'blocked optimization must explain how to refresh the JD match');
    assert.match(staleJd, /<button[^>]*disabled=""[^>]*>优化所选模块/);
    assert.ok(!idle.includes(staleJdReason), 'current JD reports must not show the stale warning');
    const scoring = renderToStaticMarkup(React.createElement(ResumeScoreReport, {...actionProps, generating: true}));
    const failed = renderToStaticMarkup(React.createElement(ResumeScoreReport, {...actionProps, outdated: true, generating: false, error: '评分失败，请重试'}));
    assert.equal((failed.match(/role="alert"/g) || []).length, 1);
    assert.doesNotMatch(failed, /简历内容已变化，请重新评分后再选择优化/);
    assert.ok(failed.indexOf('评分失败，请重试') < failed.indexOf('六维简历评估雷达图'));
    assert.equal((idle.match(/aria-label="重新评分"/g) || []).length, 1);
    assert.equal((scoring.match(/aria-label="停止生成"/g) || []).length, 1);
    assert.doesNotMatch(scoring, /aria-label="重新评分"|本次优化按实际/);
    const pending = renderToStaticMarkup(React.createElement(ResumeEvaluationReport, {
      evaluation: null, isGenerating: true, onGenerate: () => {}, onStop: () => {},
    }));
    assert.equal((pending.match(/>停止生成<\/button>/g) || []).length, 1);
    assert.doesNotMatch(pending, /<button[^>]* disabled=""/);
    let generated = 0, stopped = 0;
    const findButton = node => {
      if (!node || typeof node !== 'object') return undefined;
      if (node.type === 'button') return node;
      return React.Children.toArray(node.props?.children).map(findButton).find(Boolean);
    };
    for (const isGenerating of [false, true]) {
      const tree = ResumeEvaluationReport({evaluation: null, isGenerating,
        onGenerate: () => generated++, onStop: () => stopped++});
      const button = findButton(tree);
      assert.ok(button);
      assert.equal(button.props.disabled, false);
      button.props.onClick();
    }
    assert.equal(generated, 1);
    assert.equal(stopped, 1);
    const experienceSuggestion = {...raw.suggestions[0], moduleType: 'experience_star', moduleId: 'project-1',
      fieldPath: 'star.r', label: '第2段经历 · 负责人 · 结果'};
    const namedReport = renderToStaticMarkup(React.createElement(ScoreAnnotationProvider, {
      suggestions: [experienceSuggestion], reportKey: 'named', experiences: [{id: 'project-1', company: '校园信息共享平台'}],
    }, React.createElement(ResumeScoreReport, {...actionProps, report: {...raw, suggestions: [experienceSuggestion]}, generating: false})));
    assert.match(namedReport, /校园信息共享平台 · 结果/);
    assert.doesNotMatch(namedReport, /第2段经历|负责人/);

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
