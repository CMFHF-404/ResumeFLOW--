import React from 'react';
import { Square } from 'lucide-react';
import JDAnalysisPanel, { JDAnalysisDetailsContent, useJDStrategyCopyState } from './JDAnalysisPanel';
import { ResumeEvaluationReport } from './ResumeEvaluationReport/ResumeEvaluationReport';

type Props = {
    panel: React.ComponentProps<typeof JDAnalysisPanel>;
    reportTab: 'jd' | 'resume';
    onSelectReport: (tab: 'jd' | 'resume') => void;
};

export default function MobileWorkbenchReports({ panel, reportTab, onSelectReport }: Props) {
    const { strategyCopyStatus, manualStrategyCopyText, handleCopyStrategyText } = useJDStrategyCopyState(panel.onOpenAgentPluginConfig);
    const result = panel.analysisResult;
    const blocked = panel.isAnalyzing || panel.isEvaluating || (!panel.hasJdContext && !panel.jdFile) || panel.hasMissingAttachmentContext;
    return <div className="flex h-full min-h-0 flex-col">
        <div className="grid shrink-0 grid-cols-2 border-b border-border-light px-3 dark:border-border-dark" role="tablist" aria-label="分析报告类型">
            {([['jd', 'JD 分析'], ['resume', '六维诊断']] as const).map(([id, label]) => <button key={id} id={`mobile-${id}-report-tab`} role="tab" aria-selected={reportTab === id} aria-controls={`mobile-${id}-report-panel`} type="button" onClick={() => onSelectReport(id)} className={`min-h-11 border-b-2 text-sm font-medium ${reportTab === id ? 'border-primary text-primary' : 'border-transparent text-gray-500'}`}>{label}</button>)}
        </div>
        <section id="mobile-jd-report-panel" role="tabpanel" aria-labelledby="mobile-jd-report-tab" hidden={reportTab !== 'jd'} inert={reportTab !== 'jd' ? true : undefined} className={`min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 ${reportTab === 'jd' ? 'rf-workbench-page-enter' : ''}`}>
            {panel.isAnalyzing ? <div className="flex items-center justify-between gap-3 text-sm text-primary" role="status">
                <span>正在分析 JD…</span>
                {panel.onStopAnalyze ? <button type="button" onClick={panel.onStopAnalyze} className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm"><Square className="h-3 w-3" />停止</button> : null}
            </div> : null}
            {panel.isAnalyzing && panel.thinkingText ? <p className="max-h-28 overflow-y-auto text-xs leading-5 text-gray-500">{panel.thinkingText}</p> : null}
            {result ? <JDAnalysisDetailsContent reportTab="jd" analysisResult={result} jdText={panel.jdContextText} onAnalyze={panel.onAnalyze} isAnalyzing={panel.isAnalyzing} isAnalyzeDisabled={Boolean(blocked)} isOutdated={Boolean(panel.isOutdated)} isEvaluationOutdated={Boolean(panel.isEvaluationOutdated)} isEvaluating={Boolean(panel.isEvaluating)} isOptimizationEnabled={false} isOptimizationBusy={false} canStartOptimization={false} copyStatus={strategyCopyStatus} manualCopyText={manualStrategyCopyText} onCopyText={handleCopyStrategyText} /> : <p className="px-1 py-4 text-sm leading-6 text-gray-500">在简历页面填写 JD 并开始分析后，可在这里查看报告。</p>}
        </section>
        <section id="mobile-resume-report-panel" role="tabpanel" aria-labelledby="mobile-resume-report-tab" hidden={reportTab !== 'resume'} inert={reportTab !== 'resume' ? true : undefined} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 ${reportTab === 'resume' ? 'rf-workbench-page-enter' : ''}`}>
            <ResumeEvaluationReport evaluation={result?.resumeEvaluation} summary={result?.summary ?? ''} isOutdated={Boolean(panel.isEvaluationOutdated)} isGenerating={Boolean(panel.isEvaluating)} thinkingText={panel.evaluationThinkingText} error={panel.evaluationError} onGenerate={panel.onGenerateEvaluation} onStop={panel.onStopEvaluation} isOptimizationEnabled={Boolean(panel.isOptimizationEnabled)} isOptimizationBusy={Boolean(panel.isOptimizationBusy || panel.isAnalyzing)} canStartOptimization={Boolean(panel.canStartOptimization)} optimizationDisabledReason={panel.optimizationDisabledReason} onStartOptimization={panel.onStartOptimization} />
        </section>
    </div>;
}
