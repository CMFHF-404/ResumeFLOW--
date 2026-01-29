import React, { useState } from 'react';
import GlobalSidebar from './components/GlobalSidebar';
import Dashboard from './views/Dashboard';
import ExperienceBank from './views/ExperienceBank';
import ResumeEditor from './views/ResumeEditor';
import { ViewState } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);

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
    <div className="flex w-full h-full">
      <GlobalSidebar currentView={currentView} setView={setCurrentView} />
      {renderView()}
    </div>
  );
};

export default App;
