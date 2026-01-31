import React, { useState, useEffect, useCallback } from 'react';
import AuthGuard from './components/AuthGuard';
import GlobalSidebar from './components/GlobalSidebar';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import Dashboard from './views/Dashboard';
import ExperienceBank from './views/ExperienceBank';
import ResumeEditor from './views/ResumeEditor';
import Callback from './views/Callback';
import { ViewState, Resume } from './types';

const VIEW_STORAGE_KEY = 'resumeFlow.currentView';

const resolveStoredView = (value: string | null): ViewState | null => {
  if (!value) {
    return null;
  }
  const validViews = new Set(Object.values(ViewState));
  return validViews.has(value as ViewState) ? (value as ViewState) : null;
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);

  // 全局简历数据缓存，避免每次切换视图都重新请求
  const [cachedResumes, setCachedResumes] = useState<Resume[]>([]);

  // 经历库数据缓存，存储个人资料、工作经历、教育背景等
  const [profileCache, setProfileCache] = useState<any>(null);

  // 恢复上次停留的视图
  useEffect(() => {
    const storedView = resolveStoredView(localStorage.getItem(VIEW_STORAGE_KEY));
    if (storedView) {
      setCurrentView(storedView);
    }
  }, []);

  // 如果是callback路径,只渲染Callback组件
  if (window.location.pathname === '/callback') {
    return <Callback />;
  }

  const handleSetView = useCallback((view: ViewState) => {
    setCurrentView(view);
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, []);

  const handleResetView = useCallback(() => {
    setCurrentView(ViewState.DASHBOARD);
    localStorage.setItem(VIEW_STORAGE_KEY, ViewState.DASHBOARD);
  }, []);

  // 处理简历数据更新的回调
  const handleResumesUpdate = useCallback((resumes: Resume[]) => {
    console.log('[App] 更新全局简历缓存，共', resumes.length, '份简历');
    setCachedResumes(resumes);
  }, []);

  // 处理经历库数据更新的回调
  const handleProfileUpdate = useCallback((data: any) => {
    console.log('[App] 更新经历库缓存');
    setProfileCache(data);
  }, []);

  const renderView = () => {
    switch (currentView) {
      case ViewState.DASHBOARD:
        return <Dashboard setView={handleSetView} cachedResumes={cachedResumes} onResumesUpdate={handleResumesUpdate} />;
      case ViewState.EXPERIENCE_BANK:
        return <ExperienceBank cachedProfile={profileCache} onProfileUpdate={handleProfileUpdate} />;
      case ViewState.EDITOR:
        return <ResumeEditor />;
      default:
        return <Dashboard setView={handleSetView} cachedResumes={cachedResumes} onResumesUpdate={handleResumesUpdate} />;
    }
  };

  return (
    <AuthGuard>
      <div className="flex w-full h-screen">
        <GlobalSidebar currentView={currentView} setView={handleSetView} />
        <ViewErrorBoundary onReset={handleResetView} viewName={currentView}>
          {renderView()}
        </ViewErrorBoundary>
      </div>
    </AuthGuard>
  );
};

export default App;
