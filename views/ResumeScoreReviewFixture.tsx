import React, { useState } from 'react';
import type { ResumePdfRenderSnapshot } from '../types/resume';
import type { ResumeScoreEvaluation } from '../types/ai';
import type { ResumeOptimizationChange, ResumeOptimizationPlan } from '../types/resumeOptimization';
import ResumePdfDocument from './ResumeEditor/components/ResumePdfDocument';
import { ScoreAnnotationProvider } from './ResumeEditor/components/ResumeEvaluationReport/ScoreAnnotations';
import { ResumeEvaluationReport } from './ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport';
import { ResumeOptimizationPreview } from './ResumeEditor/components/ResumeOptimization/ResumeOptimizationPreview';

export default function ResumeScoreReviewFixture({ snapshot }: { snapshot: ResumePdfRenderSnapshot }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [calls, setCalls] = useState(0);
  const [answer, setAnswer] = useState('');
  const [stage, setStage] = useState<'report' | 'question' | 'preview'>('report');
  const [revision, setRevision] = useState(0);
  const report: ResumeScoreEvaluation = {
    evaluationVersion: 'resume_score_v2', scoringVersion: 'single_pass_v1', evaluationScope: 'full_resume', overallScore: 77,
    summary: '经历结构清楚，建议收紧个人总结并明确行动与成果之间的关系。', jdMatch: 82,
    dimensions: ['逻辑清晰', 'STAR应用', '内容可读', '内容完整', '专业表达', '成果量化'].map((dimension, i) => ({ dimension: dimension as any, score: [82, 75, 85, 90, 70, 60][i], comment: '围绕当前材料进一步明确重点。' })),
    suggestions: [
      { suggestionId: 'suggestion-1', moduleType: 'personal_summary', moduleId: 'current_resume', fieldPath: 'personal_summary', dimension: '专业表达', label: '个人总结', problem: '总结可以更聚焦具体工作。', direction: '压缩重复描述，突出产品交付经验。', editable: true },
      { suggestionId: 'suggestion-2', moduleType: 'experience_star', moduleId: snapshot.selectedWorkItems[0].id, fieldPath: 'star.a', dimension: 'STAR应用', label: '第1段经历 · 行动', problem: '行动说明可以更紧凑。', direction: '按行动顺序组织表达，保留关键细节。', editable: true },
      { suggestionId: 'suggestion-3', moduleType: 'read_only', moduleId: 'educations', fieldPath: 'educations', dimension: '内容完整', label: '教育经历', problem: '可以检查教育信息是否完整。', direction: '手动核对教育信息。', editable: false },
    ],
  };
  const changes: ResumeOptimizationChange[] = report.suggestions.filter(s => selected.includes(s.suggestionId)).map(s => ({
    changeId: s.suggestionId, issueIds: [s.suggestionId], dimension: s.dimension, moduleType: s.moduleType as any,
    moduleId: s.moduleId, fieldPath: s.fieldPath, actionKind: 'rewrite_now', scope: 'general',
    beforeValue: s.moduleType === 'personal_summary' ? snapshot.profile.summary : snapshot.selectedWorkItems[0].star.a,
    generalValue: s.moduleType === 'personal_summary' ? '拥有 AI 产品交付经验，负责需求分析、原型设计与跨团队协作。' : '梳理用户需求，设计产品原型，协调团队完成交付。',
    targetedValue: s.moduleType === 'personal_summary' ? '拥有 AI 产品交付经验，负责需求分析、原型设计与跨团队协作。' : '梳理用户需求，设计产品原型，协调团队完成交付。',
    rationale: s.direction, defaultSelected: false, safetyStatus: 'not_reviewed', safetyFindings: [], sourceLabels: [], introducedTerms: [],
  }));
  const plan: ResumeOptimizationPlan = { changes, questions: [], bankSuggestions: [], safetySummary: { allowedChangeIds: [], blockedChangeIds: [], pendingChangeIds: [], findings: [] } };
  const displaySnapshot = structuredClone(snapshot);
  if (applied) for (const c of changes.filter(c => accepted.includes(c.changeId))) {
    if (c.moduleType === 'personal_summary') displaySnapshot.profile.summary = String(c.targetedValue);
    else displaySnapshot.selectedWorkItems[0].star.a = String(c.targetedValue);
  }
  if (new URLSearchParams(location.search).has('scorePrint')) return <ResumePdfDocument snapshot={displaySnapshot} />;
  return <ScoreAnnotationProvider reportKey={`${revision}:${applied}`} suggestions={applied ? [] : report.suggestions}>
    <main className="min-h-screen bg-slate-100 p-3 text-slate-800 sm:p-6" data-score-review-fixture>
      <header className="mb-4"><h1 className="text-xl font-bold">六维评分与模块优化</h1><p className="text-xs text-slate-500">本地模拟数据 · 不调用真实 AI 或写入账户</p><output data-model-calls={calls}>模拟优化调用：{calls}</output></header>
      <div className="mx-auto grid max-w-[1280px] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-auto rounded-xl bg-white p-2" data-score-preview>
          <ResumePdfDocument snapshot={displaySnapshot} previewScope="editor" readOnly={false} optimizationComparison={stage === 'preview' && !applied ? { changes, acceptedChangeIds: accepted, readOnly: false } : undefined} />
        </div>
        <aside className="rounded-xl bg-white p-4">
          {stage === 'report' && <ResumeEvaluationReport evaluation={report} isOutdated={applied} isOptimizationEnabled canStartOptimization={!applied}
            onStartOptimization={ids => { setSelected(ids); setStage('question'); setCalls(n => n + 1); }}
            onGenerate={() => { setApplied(false); setRevision(n => n + 1); }} />}
          {stage === 'question' && <section><h2 className="font-bold">补充相关信息</h2><label className="mt-3 block text-sm">还有哪些相关信息？<textarea className="mt-2 w-full rounded border p-2" value={answer} onChange={e => setAnswer(e.target.value)} /></label>
            <button className="mt-3 min-h-11 rounded-lg bg-emerald-600 px-3 text-white" onClick={() => { if (answer.trim()) setCalls(n => n + 1); setStage('preview'); }}>继续查看改写</button></section>}
          {stage === 'preview' && <><ResumeOptimizationPreview skillNameById={{}} onViewExperience={() => undefined} onOpenAutoAssembly={() => undefined} resumeId="fixture" runId="fixture-run" plan={plan} acceptedChangeIds={accepted} onToggleChange={id => setAccepted(old => old.includes(id) ? old.filter(v => v !== id) : [...old, id])} readOnly={applied} />
            <button disabled={accepted.length === 0 || applied} className="mt-3 min-h-11 rounded-lg bg-emerald-600 px-3 text-white disabled:opacity-50" onClick={() => setApplied(true)}>应用所选修改</button>
            {applied && <p role="status" className="mt-2 text-sm">内容已应用，原评分已过期。</p>}
            <button className="mt-3 block min-h-11 text-sm underline" onClick={() => setStage('report')}>返回评分报告</button></>}
        </aside>
      </div>
    </main>
  </ScoreAnnotationProvider>;
}
