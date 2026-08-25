import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLogto } from '@logto/react';
import AuthGuard from './components/AuthGuard';
import GlobalSidebar from './components/GlobalSidebar';
import QuotaPurchasePrompt from './components/QuotaPurchasePrompt';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import type { AssistantLaunchRequest, AssistantOpenSessionRequest } from './views/AIAssistant/types';
import Callback from './views/Callback';
import GuestResumeEditorPreview from './views/GuestResumeEditorPreview';
import { ViewState, Resume } from './types';
import {
  consumeJustLoggedIn,
  trackLoginStart,
  trackAuthenticatedVisit,
  trackPageView,
} from './utils/analyticsTracker';
import { resumeService, type Resume as ResumeRecord } from './services/resumeService';
import { profileService, type Profile } from './services/profileService';
import { experienceService } from './services/experienceService';
import { billingService, type TokenQuotaSummary } from './services/billingService';
import {
  DEFAULT_QUOTA_PURCHASE_MESSAGE,
  subscribeQuotaPurchaseRequired,
} from './services/quotaPurchasePrompt';
import type { AssistantDraftApplyNavigation } from './services/aiService';
import { devLog } from './services/devLogger';
import {
  clearActiveResumeId,
  clearLegacyActiveResumeId,
  setActiveResumeId,
} from './services/resumeStorage';
import {
  readStoredAuthUserKey,
  useAuthUserKey,
  writeStoredAuthUserKey,
} from './hooks/useAuthUserKey';
import { replaceDashboardResumeFromServer } from './utils/dashboardResumeMapper';
import {
  clearJDAnalysisCachesForOwner,
  clearLegacyJDAnalysisCaches,
} from './services/jdAnalysisStorage';
import {
  clearLegacyAssistantManualSaveDrafts,
  clearPendingAssistantManualSaveDraftsForOwner,
} from './views/assistantManualSaveStorage';
import {
  bindOwnerScopedValue,
  readOwnerScopedValue,
  type OwnerScopedValue,
} from './utils/ownerScopedValue';
import { readAuthSessionSnapshot } from './services/authTokenProvider';

const VIEW_STORAGE_KEY = 'yuanzijianli.currentView';

const clearOwnerScopedSensitiveLocalState = (ownerKey: string | null | undefined) => {
  clearActiveResumeId(ownerKey);
  clearJDAnalysisCachesForOwner(ownerKey);
  clearPendingAssistantManualSaveDraftsForOwner(ownerKey);
};

const Dashboard = lazy(() => import('./views/Dashboard'));
const ExperienceBank = lazy(() => import('./views/ExperienceBank'));
const ResumeEditor = lazy(() => import('./views/ResumeEditor'));
const AIAssistant = lazy(() => import('./views/AIAssistant'));
const FeedbackModal = lazy(() => import('./components/FeedbackModal'));
const AgentApiPluginConfigModal = lazy(() => import('./components/AgentApiPluginConfigModal'));
const TokenQuotaModal = lazy(() => import('./components/TokenQuotaModal'));

type ExperienceFocusRequest = {
  requestId: number;
  category?: AssistantDraftApplyNavigation['category'];
  targetId?: string;
};

type ResumeEditorFocusRequest = {
  requestId: number;
  targetId?: string;
};

const resolveStoredView = (value: string | null): ViewState | null => {
  if (!value) {
    return null;
  }
  const validViews = new Set(Object.values(ViewState));
  return validViews.has(value as ViewState) ? (value as ViewState) : null;
};

const buildFeedbackContext = (view: ViewState) => {
  if (typeof window === 'undefined') {
    return {
      view,
      path: '',
      url: '',
      userAgent: '',
    };
  }
  return {
    view,
    path: window.location.pathname,
    url: window.location.href,
    userAgent: window.navigator.userAgent,
  };
};

const App: React.FC = () => {
  const logto = useLogto();
  const { isAuthenticated, signIn } = logto;
  const isAuthLoading = logto.isLoading;
  const [currentView, setCurrentView] = useState<ViewState>(() => {
    const storedView = resolveStoredView(localStorage.getItem(VIEW_STORAGE_KEY));
    return storedView ?? ViewState.DASHBOARD;
  });

  // 全局简历数据缓存，避免每次切换视图都重新请求
  const [cachedResumes, setCachedResumes] = useState<Resume[]>([]);
  const [cachedResumesOwnerKey, setCachedResumesOwnerKey] = useState<string | null>(null);

  // 经历库数据缓存，存储个人资料、工作经历、教育背景等
  const [profileCache, setProfileCache] = useState<OwnerScopedValue<Profile> | null>(null);

  // 标记是否需要在ExperienceBank中自动打开简历上传弹窗
  const [shouldOpenResumeUpload, setShouldOpenResumeUpload] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isAgentPluginConfigOpen, setIsAgentPluginConfigOpen] = useState(false);
  const [isTokenQuotaOpen, setIsTokenQuotaOpen] = useState(false);
  const [tokenQuotaInitialView, setTokenQuotaInitialView] = useState<'overview' | 'purchase'>('overview');
  const [tokenQuotaReturnFocusElement, setTokenQuotaReturnFocusElement] = useState<HTMLElement | null>(null);
  const [quotaSummaryCache, setQuotaSummaryCache] = useState<OwnerScopedValue<TokenQuotaSummary> | null>(null);
  const [quotaPurchasePromptMessage, setQuotaPurchasePromptMessage] = useState<string | null>(null);
  const [returnedPaymentOrderId, setReturnedPaymentOrderId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('payment_order');
  });
  const [assistantLaunchRequest, setAssistantLaunchRequest] = useState<AssistantLaunchRequest | null>(null);
  const [assistantOpenSessionRequest, setAssistantOpenSessionRequest] = useState<AssistantOpenSessionRequest | null>(null);
  const [assistantDraftInput, setAssistantDraftInput] = useState('');
  const [editorMobileDrawerOpenRequest, setEditorMobileDrawerOpenRequest] = useState(0);
  const [experienceBankFocusRequest, setExperienceBankFocusRequest] = useState<ExperienceFocusRequest | null>(null);
  const [resumeEditorFocusRequest, setResumeEditorFocusRequest] = useState<ResumeEditorFocusRequest | null>(null);
  const authUserKey = useAuthUserKey();
  const authUserKeyRef = useRef<string | null>(null);
  const authVisitSourceRef = useRef<'post_login' | 'session_restore'>('session_restore');
  const authVisitAwaitingResetRef = useRef(false);
  const assistantLaunchRequestIdRef = useRef(0);
  const assistantOpenSessionRequestIdRef = useRef(0);
  const focusRequestIdRef = useRef(0);

  const handleRequireAuth = useCallback(async () => {
    if (isAuthLoading) {
      return;
    }
    await trackLoginStart('guest_preview');
    await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href);
  }, [isAuthLoading, signIn]);

  const resetUserScopedState = useCallback(() => {
    resumeService.clearListCache();
    profileService.clearProfileCache();
    experienceService.clearListCache();
    billingService.clearBillingCache();

    setCachedResumes([]);
    setCachedResumesOwnerKey(null);
    setProfileCache(null);
    setShouldOpenResumeUpload(false);
    setIsFeedbackOpen(false);
    setIsAgentPluginConfigOpen(false);
    setIsTokenQuotaOpen(false);
    setTokenQuotaInitialView('overview');
    setTokenQuotaReturnFocusElement(null);
    setQuotaSummaryCache(null);
    setQuotaPurchasePromptMessage(null);
    setReturnedPaymentOrderId(null);
    setAssistantLaunchRequest(null);
    setAssistantOpenSessionRequest(null);
    setAssistantDraftInput('');
    setEditorMobileDrawerOpenRequest(0);
    setExperienceBankFocusRequest(null);
    setResumeEditorFocusRequest(null);
    setCurrentView(ViewState.DASHBOARD);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.DASHBOARD);
  }, []);

  // 如果是callback路径,只渲染Callback组件
  if (window.location.pathname === '/callback') {
    return <Callback />;
  }

  const handleSetView = useCallback((view: ViewState, options?: { shouldOpenResumeUpload?: boolean }) => {
    setCurrentView(view);
    localStorage.setItem(VIEW_STORAGE_KEY, view);

    // 如果需要自动打开简历上传弹窗
    if (options?.shouldOpenResumeUpload) {
      setShouldOpenResumeUpload(true);
    } else {
      setShouldOpenResumeUpload(false);
    }
  }, []);

  const handleResetView = useCallback(() => {
    setCurrentView(ViewState.DASHBOARD);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.DASHBOARD);
  }, []);

  const handleLaunchAssistant = useCallback((request: AssistantLaunchRequest) => {
    const nextRequestId = assistantLaunchRequestIdRef.current + 1;
    assistantLaunchRequestIdRef.current = nextRequestId;
    setAssistantLaunchRequest({
      ...request,
      requestId: `launch-${nextRequestId}`,
    });
    setAssistantOpenSessionRequest(null);
    setCurrentView(ViewState.AI_ASSISTANT);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.AI_ASSISTANT);
  }, []);

  const handleConsumeAssistantLaunchRequest = useCallback((requestId?: string) => {
    setAssistantLaunchRequest((current) => {
      if (!current) {
        return current;
      }
      if (requestId && current.requestId !== requestId) {
        return current;
      }
      return null;
    });
  }, []);

  const handleOpenAssistantSession = useCallback((sessionId: string) => {
    const nextRequestId = assistantOpenSessionRequestIdRef.current + 1;
    assistantOpenSessionRequestIdRef.current = nextRequestId;
    setAssistantOpenSessionRequest({
      requestId: `open-${nextRequestId}`,
      sessionId,
    });
    setAssistantLaunchRequest(null);
    setCurrentView(ViewState.AI_ASSISTANT);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.AI_ASSISTANT);
  }, []);

  const handleConsumeAssistantOpenSessionRequest = useCallback((requestId?: string) => {
    setAssistantOpenSessionRequest((current) => {
      if (!current) {
        return current;
      }
      if (requestId && current.requestId !== requestId) {
        return current;
      }
      return null;
    });
  }, []);

  const handleJumpToResumeEditor = useCallback((resumeId?: string, targetId?: string) => {
    if (resumeId) {
      setActiveResumeId(authUserKey, resumeId);
    }
    if (targetId) {
      focusRequestIdRef.current += 1;
      setResumeEditorFocusRequest({
        requestId: focusRequestIdRef.current,
        targetId,
      });
    }
    setEditorMobileDrawerOpenRequest((current) => current + 1);
    setCurrentView(ViewState.EDITOR);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.EDITOR);
  }, [authUserKey]);

  const handleJumpToExperienceBank = useCallback((category?: AssistantDraftApplyNavigation['category'], targetId?: string) => {
    experienceService.clearListCache();
    focusRequestIdRef.current += 1;
    setExperienceBankFocusRequest({
      requestId: focusRequestIdRef.current,
      category,
      targetId,
    });
    setCurrentView(ViewState.EXPERIENCE_BANK);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.EXPERIENCE_BANK);
  }, []);

  const handleConsumeEditorMobileDrawerOpenRequest = useCallback(() => {
    setEditorMobileDrawerOpenRequest(0);
  }, []);

  const handleConsumeResumeEditorFocusRequest = useCallback((requestId: number) => {
    setResumeEditorFocusRequest((current) => (
      current?.requestId === requestId ? null : current
    ));
  }, []);

  useEffect(() => {
    if (currentView !== ViewState.EDITOR) {
      setResumeEditorFocusRequest(null);
    }
  }, [currentView]);

  useEffect(() => {
    trackPageView(currentView);
  }, [currentView]);

  useEffect(() => {
    const previousKey = authUserKeyRef.current;
    if (authUserKey) {
      if (previousKey === authUserKey) {
        return;
      }
      const storedKey = readStoredAuthUserKey();
      const shouldReset =
        (storedKey && storedKey !== authUserKey) ||
        (previousKey && previousKey !== authUserKey);
      if (shouldReset) {
        clearOwnerScopedSensitiveLocalState(previousKey ?? storedKey);
        authVisitAwaitingResetRef.current = true;
        resetUserScopedState();
      } else {
        authVisitAwaitingResetRef.current = false;
      }
      authUserKeyRef.current = authUserKey;
      writeStoredAuthUserKey(authUserKey);
      authVisitSourceRef.current = consumeJustLoggedIn() ? 'post_login' : 'session_restore';
      return;
    }

    if (!previousKey) {
      const storedKey = readStoredAuthUserKey();
      if (!isAuthLoading && !isAuthenticated && storedKey) {
        clearOwnerScopedSensitiveLocalState(storedKey);
        resetUserScopedState();
        authVisitSourceRef.current = 'session_restore';
        authVisitAwaitingResetRef.current = false;
        writeStoredAuthUserKey(null);
      }
      return;
    }

    clearOwnerScopedSensitiveLocalState(previousKey);
    resetUserScopedState();
    authUserKeyRef.current = null;
    authVisitSourceRef.current = 'session_restore';
    authVisitAwaitingResetRef.current = false;
    writeStoredAuthUserKey(null);
  }, [authUserKey, isAuthenticated, isAuthLoading, resetUserScopedState]);

  useEffect(() => {
    clearLegacyActiveResumeId();
    clearLegacyJDAnalysisCaches();
    clearLegacyAssistantManualSaveDrafts();
  }, []);

  useEffect(() => {
    if (!authUserKey) {
      return;
    }
    if (authVisitAwaitingResetRef.current) {
      if (currentView !== ViewState.DASHBOARD) {
        return;
      }
      authVisitAwaitingResetRef.current = false;
    }
    trackAuthenticatedVisit(authUserKey, authVisitSourceRef.current, currentView);
    if (authVisitSourceRef.current === 'post_login') {
      authVisitSourceRef.current = 'session_restore';
    }
  }, [authUserKey, currentView]);

  // 处理简历数据更新的回调
  const handleResumesUpdate = useCallback((resumes: Resume[]) => {
    if (!authUserKey || readAuthSessionSnapshot().ownerKey !== authUserKey) {
      return;
    }
    devLog('[App] 更新全局简历缓存，共', resumes.length, '份简历');
    setCachedResumes(resumes);
    setCachedResumesOwnerKey(authUserKey);
  }, [authUserKey]);

  const handleResumeRecordUpdate = useCallback((updated: ResumeRecord) => {
    if (!authUserKey || readAuthSessionSnapshot().ownerKey !== authUserKey) {
      return;
    }
    setCachedResumes((current) => replaceDashboardResumeFromServer(current, updated, authUserKey));
    setCachedResumesOwnerKey(authUserKey);
  }, [authUserKey]);

  // 处理经历库数据更新的回调
  const handleProfileUpdate = useCallback((data: Profile) => {
    if (!authUserKey || readAuthSessionSnapshot().ownerKey !== authUserKey) {
      return;
    }
    const scopedProfile = bindOwnerScopedValue(
      authUserKey,
      authUserKey,
      data.user_id,
      data,
    );
    if (!scopedProfile) {
      return;
    }
    devLog('[App] 更新经历库缓存');
    setProfileCache(scopedProfile);
  }, [authUserKey]);
  const handleQuotaSummaryChange = useCallback((summary: TokenQuotaSummary) => {
    if (!authUserKey || readAuthSessionSnapshot().ownerKey !== authUserKey) {
      return;
    }
    const scopedSummary = bindOwnerScopedValue(
      authUserKey,
      authUserKey,
      summary.user_id,
      summary,
    );
    if (scopedSummary) {
      setQuotaSummaryCache(scopedSummary);
    }
  }, [authUserKey]);
  const handleOpenFeedback = useCallback(() => {
    setIsFeedbackOpen(true);
  }, []);
  const handleCloseFeedback = useCallback(() => {
    setIsFeedbackOpen(false);
  }, []);
  const handleOpenAgentPluginConfig = useCallback(() => {
    setIsAgentPluginConfigOpen(true);
  }, []);
  const handleCloseAgentPluginConfig = useCallback(() => {
    setIsAgentPluginConfigOpen(false);
  }, []);
  const handleOpenTokenQuota = useCallback((returnFocusElement?: HTMLElement | null) => {
    setQuotaPurchasePromptMessage(null);
    setTokenQuotaInitialView('overview');
    setTokenQuotaReturnFocusElement(returnFocusElement ?? null);
    setIsTokenQuotaOpen(true);
  }, []);
  const handleOpenTokenPurchase = useCallback((returnFocusElement?: HTMLElement | null) => {
    setQuotaPurchasePromptMessage(null);
    setTokenQuotaInitialView('purchase');
    setTokenQuotaReturnFocusElement(returnFocusElement ?? null);
    setIsTokenQuotaOpen(true);
  }, []);
  const handleCloseTokenQuota = useCallback(() => {
    setIsTokenQuotaOpen(false);
    setTokenQuotaInitialView('overview');
    setTokenQuotaReturnFocusElement(null);
  }, []);
  const handlePaymentOrderHandled = useCallback(() => {
    const url = new URL(window.location.href);
    [
      'payment_order',
      'pid',
      'trade_no',
      'out_trade_no',
      'api_trade_no',
      'type',
      'trade_status',
      'addtime',
      'endtime',
      'name',
      'money',
      'param',
      'buyer',
      'timestamp',
      'sign',
      'sign_type',
    ].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setReturnedPaymentOrderId(null);
  }, []);
  const feedbackContext = useMemo(() => buildFeedbackContext(currentView), [currentView]);

  useEffect(() => {
    return subscribeQuotaPurchaseRequired(({ message }) => {
      setQuotaPurchasePromptMessage(message?.trim() || DEFAULT_QUOTA_PURCHASE_MESSAGE);
    });
  }, []);

  useEffect(() => {
    if (!authUserKey || !isAuthenticated) {
      setQuotaSummaryCache(null);
      billingService.clearBillingCache();
      return;
    }
    const expectedOwnerKey = authUserKey;
    setQuotaSummaryCache((current) => (
      current?.ownerKey === expectedOwnerKey ? current : null
    ));
    let cancelled = false;
    billingService.getSummary({
      force: true,
      expectedAuthCacheKey: expectedOwnerKey,
    })
      .then((summary) => {
        if (!cancelled) {
          const scopedSummary = bindOwnerScopedValue(
            expectedOwnerKey,
            readAuthSessionSnapshot().ownerKey,
            summary.user_id,
            summary,
          );
          if (scopedSummary) {
            setQuotaSummaryCache(scopedSummary);
          }
        }
      })
      .catch((error) => {
        console.warn('Failed to load token quota summary', error);
      });
    return () => {
      cancelled = true;
    };
  }, [authUserKey, isAuthenticated]);

  const visibleProfileCache = readOwnerScopedValue(authUserKey, profileCache);
  const visibleQuotaSummary = readOwnerScopedValue(authUserKey, quotaSummaryCache);

  useEffect(() => {
    if (!isAuthenticated) return;
    const paymentOrderId = new URLSearchParams(window.location.search).get('payment_order');
    if (!paymentOrderId) return;
    setReturnedPaymentOrderId(paymentOrderId);
    setTokenQuotaInitialView('purchase');
    setTokenQuotaReturnFocusElement(null);
    setIsTokenQuotaOpen(true);
  }, [isAuthenticated]);

  const renderView = () => {
    switch (currentView) {
      case ViewState.DASHBOARD:
        return (
          <Dashboard
            setView={handleSetView}
            cachedResumes={cachedResumes}
            cachedResumesOwnerKey={cachedResumesOwnerKey}
            authUserKey={authUserKey}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleRequireAuth}
            onResumesUpdate={handleResumesUpdate}
            onLaunchAssistant={handleLaunchAssistant}
            onOpenAgentPluginConfig={handleOpenAgentPluginConfig}
          />
        );
      case ViewState.EXPERIENCE_BANK:
        return (
          <ExperienceBank
            authUserKey={authUserKey}
            cachedProfile={visibleProfileCache}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleRequireAuth}
            onProfileUpdate={handleProfileUpdate}
            onResumeUpdate={handleResumeRecordUpdate}
            shouldOpenResumeUpload={shouldOpenResumeUpload}
            onLaunchAssistant={handleLaunchAssistant}
            onOpenAssistantSession={handleOpenAssistantSession}
            onJumpToResumeEditor={handleJumpToResumeEditor}
            focusRequest={experienceBankFocusRequest}
          />
        );
      case ViewState.EDITOR:
        return isAuthenticated ? (
          <ResumeEditor
            cachedResumes={cachedResumes}
            cachedResumesOwnerKey={cachedResumesOwnerKey}
            authUserKey={authUserKey}
            onResumesUpdate={handleResumesUpdate}
            onLaunchAssistant={handleLaunchAssistant}
            onOpenAssistantSession={handleOpenAssistantSession}
            onOpenAgentPluginConfig={handleOpenAgentPluginConfig}
            mobileDrawerOpenRequest={editorMobileDrawerOpenRequest}
            onMobileDrawerOpenRequestConsumed={handleConsumeEditorMobileDrawerOpenRequest}
            focusExperienceRequest={resumeEditorFocusRequest}
            onFocusExperienceRequestHandled={handleConsumeResumeEditorFocusRequest}
          />
        ) : (
          <GuestResumeEditorPreview onRequireAuth={handleRequireAuth} />
        );
      case ViewState.AI_ASSISTANT:
        return (
          <AIAssistant
            authUserKey={authUserKey}
            pendingLaunchRequest={assistantLaunchRequest}
            pendingOpenSessionRequest={assistantOpenSessionRequest}
            onConsumeLaunchRequest={handleConsumeAssistantLaunchRequest}
            onConsumeOpenSessionRequest={handleConsumeAssistantOpenSessionRequest}
            onJumpToResumeEditor={handleJumpToResumeEditor}
            onJumpToExperienceBank={handleJumpToExperienceBank}
            draftInput={assistantDraftInput}
            onDraftInputChange={setAssistantDraftInput}
          />
        );
      default:
        return (
          <Dashboard
            setView={handleSetView}
            cachedResumes={cachedResumes}
            cachedResumesOwnerKey={cachedResumesOwnerKey}
            authUserKey={authUserKey}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleRequireAuth}
            onResumesUpdate={handleResumesUpdate}
            onLaunchAssistant={handleLaunchAssistant}
          />
        );
    }
  };
  const viewScopeKey = authUserKey ?? 'anonymous';

  return (
    <AuthGuard authUserKey={authUserKey}>
      <div key={viewScopeKey} className="flex h-[100dvh] min-h-[100dvh] w-full flex-col md:h-screen md:min-h-screen md:flex-row">
        <GlobalSidebar
          currentView={currentView}
          setView={handleSetView}
          onOpenFeedback={handleOpenFeedback}
          onOpenAgentPluginConfig={handleOpenAgentPluginConfig}
          quotaSummary={visibleQuotaSummary}
          onOpenTokenQuota={handleOpenTokenQuota}
          onOpenTokenPurchase={handleOpenTokenPurchase}
        />
        <div className="flex min-h-0 min-w-0 flex-1">
          <ViewErrorBoundary onReset={handleResetView} viewName={currentView}>
            <Suspense fallback={null}>
              {renderView()}
            </Suspense>
          </ViewErrorBoundary>
        </div>
        {quotaPurchasePromptMessage && !isTokenQuotaOpen && (
          <QuotaPurchasePrompt
            message={quotaPurchasePromptMessage}
            onOpenPurchase={() => handleOpenTokenPurchase()}
            onDismiss={() => setQuotaPurchasePromptMessage(null)}
          />
        )}
        {isFeedbackOpen ? (
          <Suspense fallback={null}>
            <FeedbackModal
              isOpen
              authUserKey={authUserKey}
              context={feedbackContext}
              onClose={handleCloseFeedback}
            />
          </Suspense>
        ) : null}
        {isAgentPluginConfigOpen ? (
          <Suspense fallback={null}>
            <AgentApiPluginConfigModal
              isOpen
              authUserKey={authUserKey}
              onClose={handleCloseAgentPluginConfig}
            />
          </Suspense>
        ) : null}
        {isTokenQuotaOpen ? (
          <Suspense fallback={null}>
            <TokenQuotaModal
              isOpen
              authUserKey={authUserKey}
              onClose={handleCloseTokenQuota}
              summary={visibleQuotaSummary}
              onSummaryChange={handleQuotaSummaryChange}
              initialView={tokenQuotaInitialView}
              returnFocusElement={tokenQuotaReturnFocusElement}
              returnedPaymentOrderId={returnedPaymentOrderId}
              onPaymentOrderHandled={handlePaymentOrderHandled}
            />
          </Suspense>
        ) : null}
      </div>
    </AuthGuard>
  );
};

export default App;
