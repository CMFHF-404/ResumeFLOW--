import React, { useState, useEffect } from 'react';
import AuthGuard from './components/AuthGuard';
import GlobalSidebar from './components/GlobalSidebar';
import Dashboard from './views/Dashboard';
import ExperienceBank from './views/ExperienceBank';
import ResumeEditor from './views/ResumeEditor';
import Callback from './views/Callback';
import { ViewState } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);

  // 检测是否是callback路由
  useEffect(() => {
    if (window.location.pathname === '/callback') {
      // callback页面不需要渲染主应用
      return;
    }
  }, []);

  // 如果是callback路径,只渲染Callback组件
  if (window.location.pathname === '/callback') {
    return <Callback />;
  }

  const renderView = () => {
    switch (currentView) {
      case ViewState.DASHBOARD:
        return <Dashboard setView={setCurrentView} />;
      case ViewState.EXPERIENCE_BANK:
        return <ExperienceBank />;
      case ViewState.EDITOR:
        return <ResumeEditor />;
      default:
        return <Dashboard setView={setCurrentView} />;
    }
  };

  return (
    <AuthGuard>
      <div className="flex w-full h-screen">
        <GlobalSidebar currentView={currentView} setView={setCurrentView} />
        {renderView()}
      </div>
    </AuthGuard>
  );
};

export default App;
