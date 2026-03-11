import React from 'react';
import { useLogto } from '@logto/react';
import { FolderOpen, Database, Wand2, LogOut, MessageSquare, LogIn, Moon, Sun } from 'lucide-react';
import { ViewState } from '../types';
import { useProfile } from '../hooks/useProfile';
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
  const { signOut, signIn, isAuthenticated } = useLogto();
  const { profile } = useProfile();
  const [isDarkMode, setIsDarkMode] = React.useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const displayName = resolveDisplayName(profile?.full_name, DEFAULT_PROFILE_NAME);
  const avatarInitial = resolveAvatarInitial(profile?.full_name, DEFAULT_AVATAR_PLACEHOLDER);

  const getButtonClass = (view: ViewState) => {
    const baseClass = "flex items-center justify-center gap-2 rounded-xl px-3 py-2 transition-all relative group md:p-3";
    if (currentView === view) {
      return `${baseClass} bg-primary text-white shadow-lg shadow-primary/30`;
    }
    return `${baseClass} text-slate-300 hover:text-white hover:bg-slate-800`;
  };
  const actionButtonClass = "flex items-center justify-center rounded-xl p-2.5 text-slate-300 hover:text-white hover:bg-slate-800 transition-all relative group";

  const handleSignOut = async () => {
    // 注销并跳转回首页(登录页)
    // 注意: 需要在 Logto 控制台将 http://localhost:5173 添加到 "Post Sign-out Redirect URI"
    await signOut(window.location.origin);
  };

  const handleSignIn = async () => {
    await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href);
  };

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const handleToggleTheme = () => {
    const nextIsDark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', nextIsDark);
    setIsDarkMode(nextIsDark);
  };

  return (
    <nav className="w-full shrink-0 border-b border-slate-800 bg-slate-900 z-50 md:flex md:h-full md:w-[72px] md:flex-col md:items-center md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-4 md:flex-col md:justify-start md:gap-8 md:px-0 md:py-6">
        <div className="relative group cursor-pointer" onClick={() => setView(ViewState.DASHBOARD)}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold shadow-lg ring-2 ring-slate-800 transition-all hover:ring-slate-700">
            {avatarInitial}
          </div>
          <div className="nav-tooltip hidden md:block">{displayName}</div>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <button
            className={actionButtonClass}
            onClick={handleToggleTheme}
            type="button"
            aria-label="切换主题"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            className={actionButtonClass}
            onClick={onOpenFeedback}
            type="button"
            aria-label="反馈"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          {isAuthenticated ? (
            <button
              className={actionButtonClass}
              onClick={handleSignOut}
              type="button"
              aria-label="登出"
            >
              <LogOut className="w-5 h-5" />
            </button>
          ) : (
            <button
              className={actionButtonClass}
              onClick={handleSignIn}
              type="button"
              aria-label="登录"
            >
              <LogIn className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 pb-3 md:flex md:w-full md:flex-col md:items-center md:gap-6 md:px-0 md:pb-0">
        <button
          className={getButtonClass(ViewState.DASHBOARD)}
          onClick={() => setView(ViewState.DASHBOARD)}
          type="button"
        >
          <FolderOpen className="w-6 h-6" />
          <span className="text-xs font-medium md:hidden">我的简历</span>
          <div className="nav-tooltip hidden md:block">我的简历</div>
        </button>

        <button
          className={getButtonClass(ViewState.EXPERIENCE_BANK)}
          onClick={() => setView(ViewState.EXPERIENCE_BANK)}
          type="button"
        >
          <Database className="w-6 h-6" />
          <span className="text-xs font-medium md:hidden">经历库</span>
          <div className="nav-tooltip hidden md:block">经历库</div>
        </button>

        <button
          className={getButtonClass(ViewState.EDITOR)}
          onClick={() => setView(ViewState.EDITOR)}
          type="button"
        >
          <Wand2 className="w-6 h-6" />
          <span className="text-xs font-medium md:hidden">简历工厂</span>
          <div className="nav-tooltip hidden md:block">简历工厂</div>
        </button>
      </div>

      <div className="mt-auto hidden w-full flex-col items-center gap-6 pb-2 md:flex">
        <button
          className={actionButtonClass}
          onClick={handleToggleTheme}
          type="button"
        >
          {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
          <div className="nav-tooltip">切换主题</div>
        </button>
        <button
          className={actionButtonClass}
          onClick={onOpenFeedback}
          type="button"
        >
          <MessageSquare className="w-6 h-6" />
          <div className="nav-tooltip">反馈</div>
        </button>
        {isAuthenticated ? (
          <button
            className={`${actionButtonClass} hover:bg-red-950/30 hover:text-red-400`}
            onClick={handleSignOut}
            type="button"
          >
            <LogOut className="w-6 h-6" />
            <div className="nav-tooltip">登出</div>
          </button>
        ) : (
          <button
            className={`${actionButtonClass} hover:bg-emerald-950/30 hover:text-emerald-300`}
            onClick={handleSignIn}
            type="button"
          >
            <LogIn className="w-6 h-6" />
            <div className="nav-tooltip">登录</div>
          </button>
        )}
      </div>
    </nav>
  );
};

export default GlobalSidebar;
