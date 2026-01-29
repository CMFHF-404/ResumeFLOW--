import React from 'react';
import { useLogto } from '@logto/react';
import { FolderOpen, Database, Wand2, Settings, LogOut } from 'lucide-react';
import { ViewState } from '../types';

interface GlobalSidebarProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
}

const GlobalSidebar: React.FC<GlobalSidebarProps> = ({ currentView, setView }) => {
  const { signOut } = useLogto();

  const getButtonClass = (view: ViewState) => {
    const baseClass = "p-3 rounded-xl transition-all relative group";
    if (currentView === view) {
      return `${baseClass} bg-primary text-white shadow-lg shadow-primary/30`;
    }
    return `${baseClass} text-slate-400 hover:text-white hover:bg-slate-800`;
  };

  const handleSignOut = () => {
    signOut(window.location.origin);
  };

  return (
    <nav className="w-[72px] bg-slate-900 flex flex-col items-center py-6 shrink-0 z-50 gap-8 h-full">
      <div className="relative group cursor-pointer" onClick={() => setView(ViewState.DASHBOARD)}>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg ring-2 ring-slate-800 hover:ring-slate-700 transition-all">
          XC
        </div>
        <div className="nav-tooltip">陈小象</div>
      </div>

      <div className="flex flex-col gap-6 w-full items-center">
        <button
          className={getButtonClass(ViewState.DASHBOARD)}
          onClick={() => setView(ViewState.DASHBOARD)}
        >
          <FolderOpen className="w-6 h-6" />
          <div className="nav-tooltip">我的简历</div>
        </button>

        <button
          className={getButtonClass(ViewState.EXPERIENCE_BANK)}
          onClick={() => setView(ViewState.EXPERIENCE_BANK)}
        >
          <Database className="w-6 h-6" />
          <div className="nav-tooltip">经历库</div>
        </button>

        <button
          className={getButtonClass(ViewState.EDITOR)}
          onClick={() => setView(ViewState.EDITOR)}
        >
          <Wand2 className="w-6 h-6" />
          <div className="nav-tooltip">简历工厂</div>
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-6 w-full items-center mb-2">
        <button className="p-3 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all relative group">
          <Settings className="w-6 h-6" />
          <div className="nav-tooltip">全局设置</div>
        </button>
        <button
          className="p-3 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-all relative group"
          onClick={handleSignOut}
        >
          <LogOut className="w-6 h-6" />
          <div className="nav-tooltip">登出</div>
        </button>
      </div>
    </nav>
  );
};

export default GlobalSidebar;
