import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AuthGuard from './components/AuthGuard';
import FeedbackModal from './components/FeedbackModal';
import AppreciationModal from './components/AppreciationModal';
import AgentApiPluginConfigModal from './components/AgentApiPluginConfigModal';
import GlobalSidebar from './components/GlobalSidebar';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import Dashboard from './views/Dashboard';
import ExperienceBank from './views/ExperienceBank';
import ResumeEditor from './views/ResumeEditor';
import AIAssistant from './views/AIAssistant';
import type { AssistantLaunchRequest } from './views/AIAssistant/types';
import Callback from './views/Callback';
import { ViewState, Resume } from './types';
import {
  consumeJustLoggedIn,
  trackAuthenticatedVisit,
  trackPageView,
} from './utils/analyticsTracker';
import { resumeService } from './services/resumeService';
import { profileService } from './services/profileService';
import { experienceService } from './services/experienceService';
import { clearActiveResumeId, setActiveResumeId } from './views/resumeStorage';
import {
  readStoredAuthUserKey,
  useAuthUserKey,
  writeStoredAuthUserKey,
} from './hooks/useAuthUserKey';

const VIEW_STORAGE_KEY = 'yuanzijianli.currentView';

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
  const [currentView, setCurrentView] = useState<ViewState>(() => {
    const storedView = resolveStoredView(localStorage.getItem(VIEW_STORAGE_KEY));
    return storedView ?? ViewState.DASHBOARD;
  });

  // 全局简历数据缓存，避免每次切换视图都重新请求
  const [cachedResumes, setCachedResumes] = useState<Resume[]>([]);
  const [cachedResumesOwnerKey, setCachedResumesOwnerKey] = useState<string | null>(null);

  // 经历库数据缓存，存储个人资料、工作经历、教育背景等
  const [profileCache, setProfileCache] = useState<any>(null);

  // 标记是否需要在ExperienceBank中自动打开简历上传弹窗
  const [shouldOpenResumeUpload, setShouldOpenResumeUpload] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isAppreciationOpen, setIsAppreciationOpen] = useState(false);
  const [appreciationReturnFocusElement, setAppreciationReturnFocusElement] = useState<HTMLElement | null>(null);
  const [isAgentPluginConfigOpen, setIsAgentPluginConfigOpen] = useState(false);
  const [assistantLaunchRequest, setAssistantLaunchRequest] = useState<AssistantLaunchRequest | null>(null);
  const [assistantDraftInput, setAssistantDraftInput] = useState('');
  const authUserKey = useAuthUserKey();
  const authUserKeyRef = useRef<string | null>(null);
  const authVisitSourceRef = useRef<'post_login' | 'session_restore'>('session_restore');
  const authVisitAwaitingResetRef = useRef(false);
  const assistantLaunchRequestIdRef = useRef(0);

  const resetUserScopedState = useCallback(() => {
    resumeService.clearListCache();
    profileService.clearProfileCache();
    experienceService.clearListCache();
    clearActiveResumeId();

    setCachedResumes([]);
    setCachedResumesOwnerKey(null);
    setProfileCache(null);
    setShouldOpenResumeUpload(false);
    setIsFeedbackOpen(false);
    setIsAppreciationOpen(false);
    setAppreciationReturnFocusElement(null);
    setIsAgentPluginConfigOpen(false);
    setAssistantLaunchRequest(null);
    setAssistantDraftInput('');
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

  const handleJumpToResumeEditor = useCallback((resumeId?: string) => {
    if (resumeId) {
      setActiveResumeId(resumeId);
    }
    setCurrentView(ViewState.EDITOR);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.EDITOR);
  }, []);

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
      return;
    }

    resetUserScopedState();
    authUserKeyRef.current = null;
    authVisitSourceRef.current = 'session_restore';
    authVisitAwaitingResetRef.current = false;
    writeStoredAuthUserKey(null);
  }, [authUserKey, resetUserScopedState]);

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
    if (import.meta.env.DEV) {
      console.log('[App] 更新全局简历缓存，共', resumes.length, '份简历');
    }
    setCachedResumes(resumes);
    setCachedResumesOwnerKey(authUserKey ?? null);
  }, [authUserKey]);

  // 处理经历库数据更新的回调
  const handleProfileUpdate = useCallback((data: any) => {
    if (import.meta.env.DEV) {
      console.log('[App] 更新经历库缓存');
    }
    setProfileCache(data);
  }, []);
  const handleOpenFeedback = useCallback(() => {
    setIsFeedbackOpen(true);
  }, []);
  const handleCloseFeedback = useCallback(() => {
    setIsFeedbackOpen(false);
  }, []);
  const handleOpenAppreciation = useCallback((returnFocusElement?: HTMLElement | null) => {
    setAppreciationReturnFocusElement(returnFocusElement ?? null);
    setIsAppreciationOpen(true);
  }, []);
  const handleCloseAppreciation = useCallback(() => {
    setIsAppreciationOpen(false);
  }, []);
  const handleOpenAgentPluginConfig = useCallback(() => {
    setIsAgentPluginConfigOpen(true);
  }, []);
  const handleCloseAgentPluginConfig = useCallback(() => {
    setIsAgentPluginConfigOpen(false);
  }, []);
  const feedbackContext = useMemo(() => buildFeedbackContext(currentView), [currentView]);

  const renderView = () => {
    switch (currentView) {
      case ViewState.DASHBOARD:
        return (
          <Dashboard
            setView={handleSetView}
            cachedResumes={cachedResumes}
            cachedResumesOwnerKey={cachedResumesOwnerKey}
            authUserKey={authUserKey}
            onResumesUpdate={handleResumesUpdate}
            onLaunchAssistant={handleLaunchAssistant}
            onOpenAgentPluginConfig={handleOpenAgentPluginConfig}
          />
        );
      case ViewState.EXPERIENCE_BANK:
        return (
          <ExperienceBank
            cachedProfile={profileCache}
            onProfileUpdate={handleProfileUpdate}
            shouldOpenResumeUpload={shouldOpenResumeUpload}
            onLaunchAssistant={handleLaunchAssistant}
          />
        );
      case ViewState.EDITOR:
        return (
          <ResumeEditor
            cachedResumes={cachedResumes}
            cachedResumesOwnerKey={cachedResumesOwnerKey}
            authUserKey={authUserKey}
            onResumesUpdate={handleResumesUpdate}
            onLaunchAssistant={handleLaunchAssistant}
            onOpenAgentPluginConfig={handleOpenAgentPluginConfig}
          />
        );
      case ViewState.AI_ASSISTANT:
        return (
          <AIAssistant
            pendingLaunchRequest={assistantLaunchRequest}
            onConsumeLaunchRequest={handleConsumeAssistantLaunchRequest}
            onJumpToResumeEditor={handleJumpToResumeEditor}
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
            onResumesUpdate={handleResumesUpdate}
            onLaunchAssistant={handleLaunchAssistant}
          />
        );
    }
  };
  const viewScopeKey = authUserKey ?? 'anonymous';

  return (
    <AuthGuard>
      <div key={viewScopeKey} className="flex h-[100dvh] min-h-[100dvh] w-full flex-col md:h-screen md:min-h-screen md:flex-row">
        <GlobalSidebar
          currentView={currentView}
          setView={handleSetView}
          onOpenFeedback={handleOpenFeedback}
          onOpenAgentPluginConfig={handleOpenAgentPluginConfig}
          onOpenAppreciation={handleOpenAppreciation}
        />
        <div className="flex min-h-0 min-w-0 flex-1">
          <ViewErrorBoundary onReset={handleResetView} viewName={currentView}>
            {renderView()}
          </ViewErrorBoundary>
        </div>
        <FeedbackModal
          isOpen={isFeedbackOpen}
          context={feedbackContext}
          onClose={handleCloseFeedback}
        />
        <AppreciationModal
          isOpen={isAppreciationOpen}
          onClose={handleCloseAppreciation}
          returnFocusElement={appreciationReturnFocusElement}
        />
        <AgentApiPluginConfigModal
          isOpen={isAgentPluginConfigOpen}
          onClose={handleCloseAgentPluginConfig}
        />
      </div>
    </AuthGuard>
  );
};

export default App;
