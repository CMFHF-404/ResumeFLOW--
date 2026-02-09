import React from 'react';
import { useLogto } from '@logto/react';
import { FolderOpen, Database, Wand2, LogOut, BarChart3, MessageSquare } from 'lucide-react';
import { ViewState } from '../types';
import { useProfile } from '../hooks/useProfile';
import { useAdmin } from '../hooks/useAdmin';
import { resolveAvatarInitial, resolveDisplayName } from '../utils/profileDisplay';

interface GlobalSidebarProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onOpenFeedback: () => void;
}

const DEFAULT_PROFILE_NAME = '即刻开始';
const DEFAULT_AVATAR_PLACEHOLDER = '?';

const GlobalSidebar: React.FC<GlobalSidebarProps> = ({
  currentView,
  setView,
  onOpenFeedback,
}) => {
  const { signOut } = useLogto();
  const { profile } = useProfile();
  const { isAdmin, loading: isAdminLoading } = useAdmin();
  const displayName = resolveDisplayName(profile?.full_name, DEFAULT_PROFILE_NAME);
  const avatarInitial = resolveAvatarInitial(profile?.full_name, DEFAULT_AVATAR_PLACEHOLDER);
  const showAnalyticsEntry = isAdmin && !isAdminLoading;

  const getButtonClass = (view: ViewState) => {
    const baseClass = "p-3 rounded-xl transition-all relative group";
    if (currentView === view) {
      return `${baseClass} bg-primary text-white shadow-lg shadow-primary/30`;
    }
    return `${baseClass} text-slate-400 hover:text-white hover:bg-slate-800`;
  };

  const handleSignOut = async () => {
    // 注销并跳转回首页(登录页)
    // 注意: 需要在 Logto 控制台将 http://localhost:5173 添加到 "Post Sign-out Redirect URI"
    await signOut(window.location.origin);
  };

  return (
    <nav className="w-[72px] bg-slate-900 flex flex-col items-center py-6 shrink-0 z-50 gap-8 h-full">
      <div className="relative group cursor-pointer" onClick={() => setView(ViewState.DASHBOARD)}>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg ring-2 ring-slate-800 hover:ring-slate-700 transition-all">
          {avatarInitial}
        </div>
        <div className="nav-tooltip">{displayName}</div>
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
        {showAnalyticsEntry ? (
          <button
            className={getButtonClass(ViewState.ANALYTICS)}
            onClick={() => setView(ViewState.ANALYTICS)}
          >
            <BarChart3 className="w-6 h-6" />
            <div className="nav-tooltip">数据分析</div>
          </button>
        ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-6 w-full items-center mb-2">
        <button
          className="p-3 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all relative group"
          onClick={onOpenFeedback}
        >
          <MessageSquare className="w-6 h-6" />
          <div className="nav-tooltip">反馈</div>
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
