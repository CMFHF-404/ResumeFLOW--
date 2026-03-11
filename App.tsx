import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AuthGuard from './components/AuthGuard';
import FeedbackModal from './components/FeedbackModal';
import GlobalSidebar from './components/GlobalSidebar';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import Dashboard from './views/Dashboard';
import ExperienceBank from './views/ExperienceBank';
import ResumeEditor from './views/ResumeEditor';
import Callback from './views/Callback';
import { ViewState, Resume } from './types';
import { trackPageView } from './utils/analyticsTracker';
import { resumeService } from './services/resumeService';
import { profileService } from './services/profileService';
import { experienceService } from './services/experienceService';
import { clearActiveResumeId } from './views/resumeStorage';
import { useAuthUserKey } from './hooks/useAuthUserKey';

const VIEW_STORAGE_KEY = 'yuanzijianli.currentView';
const AUTH_USER_KEY_STORAGE_KEY = 'yuanzijianli.authUserKey';

const readStoredAuthUserKey = () => {
  try {
    return localStorage.getItem(AUTH_USER_KEY_STORAGE_KEY);
  } catch (error) {
    return null;
  }
};

const writeStoredAuthUserKey = (value: string | null) => {
  try {
    if (value) {
      localStorage.setItem(AUTH_USER_KEY_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(AUTH_USER_KEY_STORAGE_KEY);
    }
  } catch (error) {
    // ignore storage errors (private mode, etc.)
  }
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
  const authUserKey = useAuthUserKey();
  const authUserKeyRef = useRef<string | null>(null);

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
        resetUserScopedState();
      }
      authUserKeyRef.current = authUserKey;
      writeStoredAuthUserKey(authUserKey);
      return;
    }

    if (!previousKey) {
      return;
    }

    resetUserScopedState();
    authUserKeyRef.current = null;
    writeStoredAuthUserKey(null);
  }, [authUserKey, resetUserScopedState]);

  // 处理简历数据更新的回调
  const handleResumesUpdate = useCallback((resumes: Resume[]) => {
    console.log('[App] 更新全局简历缓存，共', resumes.length, '份简历');
    setCachedResumes(resumes);
    setCachedResumesOwnerKey(authUserKey ?? null);
  }, [authUserKey]);

  // 处理经历库数据更新的回调
  const handleProfileUpdate = useCallback((data: any) => {
    console.log('[App] 更新经历库缓存');
    setProfileCache(data);
  }, []);
  const handleOpenFeedback = useCallback(() => {
    setIsFeedbackOpen(true);
  }, []);
  const handleCloseFeedback = useCallback(() => {
    setIsFeedbackOpen(false);
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
          />
        );
      case ViewState.EXPERIENCE_BANK:
        return <ExperienceBank cachedProfile={profileCache} onProfileUpdate={handleProfileUpdate} shouldOpenResumeUpload={shouldOpenResumeUpload} />;
      case ViewState.EDITOR:
        return (
          <ResumeEditor
            cachedResumes={cachedResumes}
            cachedResumesOwnerKey={cachedResumesOwnerKey}
            authUserKey={authUserKey}
            onResumesUpdate={handleResumesUpdate}
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
          />
        );
    }
  };
  const viewScopeKey = authUserKey ?? 'anonymous';

  return (
    <AuthGuard>
      <div key={viewScopeKey} className="flex min-h-screen w-full flex-col md:h-screen md:flex-row">
        <GlobalSidebar
          currentView={currentView}
          setView={handleSetView}
          onOpenFeedback={handleOpenFeedback}
        />
        <ViewErrorBoundary onReset={handleResetView} viewName={currentView}>
          {renderView()}
        </ViewErrorBoundary>
        <FeedbackModal
          isOpen={isFeedbackOpen}
          context={feedbackContext}
          onClose={handleCloseFeedback}
        />
      </div>
    </AuthGuard>
  );
};

export default App;
