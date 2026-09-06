import React from 'react';
import { RESUME_TEMPLATE_DEFINITIONS } from '../constants/resumeTemplates';
import ResumePdfDocument from './ResumeEditor/components/ResumePdfDocument';
import { buildResumeTemplatePreviewSnapshot } from './resumeTemplatePreviewFixture';
import { ResumeOptimizationPreview } from './ResumeEditor/components/ResumeOptimization/ResumeOptimizationPreview';
import type { ResumeOptimizationChange, ResumeOptimizationPlan } from '../types/resumeOptimization';

const CSS_BACKGROUND_URL_PATTERN = /url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g;
const OVERFLOW_TOLERANCE_PX = 2;

const waitForNextFrame = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const waitForImage = async (image: HTMLImageElement) => {
  if (!image.complete) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        resolve();
      };
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
      if (image.complete) {
        finish();
      }
    });
  }

  if (typeof image.decode === 'function') {
    await image.decode().catch(() => undefined);
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(`模板预览资源加载失败：${image.currentSrc || image.src}`);
  }
};

const waitForPreviewAssets = async (root: HTMLElement) => {
  const inlineImages = [...root.querySelectorAll<HTMLImageElement>('img')];
  const backgroundUrls = new Set<string>();
  [root, ...root.querySelectorAll<HTMLElement>('*')].forEach((element) => {
    const backgroundImage = window.getComputedStyle(element).backgroundImage;
    for (const match of backgroundImage.matchAll(CSS_BACKGROUND_URL_PATTERN)) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (url) {
        backgroundUrls.add(url);
      }
    }
  });
  const backgroundImages = [...backgroundUrls].map((url) => {
    const image = new Image();
    image.src = url;
    return image;
  });
  await Promise.all([...inlineImages, ...backgroundImages].map(waitForImage));
};

const readRequestedTemplate = () => {
  const requestedId = new URLSearchParams(window.location.search).get('templateId');
  return RESUME_TEMPLATE_DEFINITIONS.find((template) => template.id === requestedId) ?? null;
};

const isOptimizationReviewFixtureRequested = () => (
  new URLSearchParams(window.location.search).get('optimizationReview') === '1'
);

const buildOptimizationReviewChanges = (): ResumeOptimizationChange[] => [
  {
    changeId: 'fixture-change-action',
    issueIds: [],
    dimension: 'STAR应用',
    moduleType: 'experience_star',
    moduleId: 'fixture-work-ai-product-manager',
    fieldPath: 'star.a',
    actionKind: 'rewrite_now',
    scope: 'general',
    beforeValue: '访谈 18 位一线用户，梳理检索、问答与反馈闭环<br>输出 PRD 和交互原型，协同算法、研发完成两轮验证',
    generalValue: null,
    targetedValue: '访谈 18 位一线用户，梳理检索、问答与反馈闭环；输出 PRD 与交互原型，协同算法、研发完成两轮可用性验证。',
    sourceLabels: ['当前简历'],
    introducedTerms: [],
    rationale: '行动描述存在换行标签且协作过程较松散，需要统一表达并突出验证闭环。',
    expectedScoreGain: 6,
    defaultSelected: false,
    safetyStatus: 'allowed',
    safetyFindings: [],
  },
  {
    changeId: 'fixture-change-result',
    issueIds: [],
    dimension: '成果量化',
    moduleType: 'experience_star',
    moduleId: 'fixture-work-ai-product-manager',
    fieldPath: 'star.r',
    actionKind: 'rewrite_now',
    scope: 'jd_targeted',
    beforeValue: '上线后资料检索耗时降低 32%，试点团队周活跃率达到 76%。',
    generalValue: null,
    targetedValue: '首版上线后，资料检索耗时降低 32%，试点团队周活跃率稳定达到 76%。',
    sourceLabels: ['当前简历'],
    introducedTerms: [],
    rationale: '结果已具备量化指标，可补充上线节点并强化结果与行动之间的因果关系。',
    expectedScoreGain: 9,
    defaultSelected: false,
    safetyStatus: 'allowed',
    safetyFindings: [],
  },
];

const ResumeTemplatePreviewDevPage: React.FC = () => {
  const [template] = React.useState(readRequestedTemplate);
  const [showOptimizationReview] = React.useState(isOptimizationReviewFixtureRequested);
  const [acceptedChangeIds, setAcceptedChangeIds] = React.useState<string[]>([]);
  const [appliedOptimizationReviewSelectionKey, setAppliedOptimizationReviewSelectionKey] = React.useState('');
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const previewContentRef = React.useRef<HTMLDivElement | null>(null);
  const snapshot = React.useMemo(
    () => template ? buildResumeTemplatePreviewSnapshot(template.id) : null,
    [template]
  );
  const optimizationReviewChanges = React.useMemo(buildOptimizationReviewChanges, []);
  const optimizationReviewPlan = React.useMemo<ResumeOptimizationPlan>(() => ({
    changes: optimizationReviewChanges,
    questions: [],
    bankSuggestions: [],
    safetySummary: {
      allowedChangeIds: optimizationReviewChanges.map((change) => change.changeId),
      blockedChangeIds: [],
      pendingChangeIds: [],
      findings: [],
    },
  }), [optimizationReviewChanges]);
  const toggleOptimizationReviewChange = React.useCallback((changeId: string) => {
    setAppliedOptimizationReviewSelectionKey('');
    setAcceptedChangeIds((current) => current.includes(changeId)
      ? current.filter((id) => id !== changeId)
      : [...current, changeId]);
  }, []);
  const optimizationReviewSelectionKey = React.useMemo(
    () => [...acceptedChangeIds].sort().join('\u0000'),
    [acceptedChangeIds]
  );
  const hasAppliedOptimizationReviewSelection = Boolean(
    acceptedChangeIds.length > 0
    && appliedOptimizationReviewSelectionKey === optimizationReviewSelectionKey
  );
  const handleOptimizationReviewApply = React.useCallback(() => {
    if (!optimizationReviewSelectionKey) return;
    setAppliedOptimizationReviewSelectionKey(optimizationReviewSelectionKey);
  }, [optimizationReviewSelectionKey]);

  React.useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    document.body.style.background = '#ffffff';
    document.body.dataset.rfTemplatePreviewReady = 'false';
    delete document.body.dataset.rfTemplatePreviewError;
    delete document.body.dataset.rfTemplatePreviewOverflowPx;

    return () => {
      document.documentElement.style.colorScheme = '';
      document.body.style.background = '';
      delete document.body.dataset.rfTemplatePreviewReady;
      delete document.body.dataset.rfTemplatePreviewError;
      delete document.body.dataset.rfTemplatePreviewOverflowPx;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const markReady = async () => {
      try {
        if (!template || !snapshot) {
          throw new Error('未知模板 ID，无法生成预览图。');
        }
        await waitForNextFrame();
        await waitForNextFrame();
        if (!previewRef.current || !previewContentRef.current) {
          throw new Error('模板预览排版初始化失败。');
        }
        await Promise.all([
          document.fonts?.ready,
          waitForPreviewAssets(previewRef.current),
        ]);
        await waitForNextFrame();
        if (cancelled) {
          return;
        }

        const pageRect = previewRef.current.getBoundingClientRect();
        const contentRect = previewContentRef.current.getBoundingClientRect();
        const overflowPx = Math.max(
          0,
          previewRef.current.scrollHeight - previewRef.current.clientHeight,
          contentRect.bottom - pageRect.bottom
        );
        document.body.dataset.rfTemplatePreviewOverflowPx = overflowPx.toFixed(2);
        if (!showOptimizationReview && overflowPx > OVERFLOW_TOLERANCE_PX) {
          throw new Error(`${template.id} 的固定预览数据超出 A4 ${overflowPx.toFixed(2)}px。`);
        }

        document.title = showOptimizationReview ? '优化对照预览' : `${template.name}模板预览`;
        document.body.dataset.rfTemplatePreviewReady = 'true';
      } catch (readyError) {
        if (cancelled) {
          return;
        }
        document.body.dataset.rfTemplatePreviewReady = 'false';
        document.body.dataset.rfTemplatePreviewError = readyError instanceof Error
          ? readyError.message
          : '模板预览生成失败。';
      }
    };

    void markReady();
    return () => {
      cancelled = true;
    };
  }, [showOptimizationReview, snapshot, template]);

  if (!snapshot || !template) {
    return <main className="p-6 text-sm text-red-700">未知模板 ID，无法生成预览图。</main>;
  }

  const previewDocument = (
    <ResumePdfDocument
      snapshot={snapshot}
      previewRef={previewRef}
      previewContentRef={previewContentRef}
      className="rf-template-preview-dev-shell"
      previewScope={showOptimizationReview ? 'editor' : 'print'}
      optimizationComparison={showOptimizationReview ? {
        changes: optimizationReviewChanges,
        acceptedChangeIds,
        readOnly: false,
      } : undefined}
    />
  );

  if (showOptimizationReview) {
    return (
      <main className="h-screen overflow-hidden bg-slate-100" data-rf-optimization-review-fixture="true">
        <div className="flex h-full min-h-0">
          <div className="min-w-0 flex-1 overflow-auto py-8">
            {previewDocument}
          </div>
          <aside className="flex h-full w-[390px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl">
            <header className="shrink-0 border-b border-slate-200 px-4 py-3">
              <p className="text-[10px] font-bold tracking-[0.14em] text-emerald-700">RESUME OPTIMIZATION</p>
              <h1 className="mt-1 text-base font-bold text-slate-950">优化方案对照</h1>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ResumeOptimizationPreview
                resumeId="fixture-resume"
                runId="fixture-run"
                plan={optimizationReviewPlan}
                acceptedChangeIds={acceptedChangeIds}
                readOnly={false}
                skillNameById={{}}
                onToggleChange={toggleOptimizationReviewChange}
                onViewExperience={() => undefined}
                onOpenAutoAssembly={() => undefined}
                surface="sidebar"
              />
            </div>
            <footer className="shrink-0 border-t border-slate-200 bg-white/95 p-4">
              <button
                type="button"
                onClick={handleOptimizationReviewApply}
                disabled={acceptedChangeIds.length === 0 || hasAppliedOptimizationReviewSelection}
                className="min-h-[44px] w-full rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {hasAppliedOptimizationReviewSelection
                  ? `已模拟应用 ${acceptedChangeIds.length} 项`
                  : `应用已接受的 ${acceptedChangeIds.length} 项`}
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-500" role="status" aria-live="polite">
                {hasAppliedOptimizationReviewSelection
                  ? '预览夹具已记录本次操作，不会写入真实简历。'
                  : '仅模拟应用，不会写入真实简历。'}
              </p>
            </footer>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white" data-rf-template-preview-page="true">
      {previewDocument}
    </main>
  );
};

export default ResumeTemplatePreviewDevPage;
