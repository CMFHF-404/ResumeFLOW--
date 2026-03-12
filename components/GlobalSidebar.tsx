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
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = React.useState(false);
  const mobileAvatarMenuRef = React.useRef<HTMLDivElement | null>(null);
  const desktopAvatarMenuRef = React.useRef<HTMLDivElement | null>(null);
  const displayName = resolveDisplayName(profile?.full_name, DEFAULT_PROFILE_NAME);
  const avatarInitial = resolveAvatarInitial(profile?.full_name, DEFAULT_AVATAR_PLACEHOLDER);

  const getButtonClass = (view: ViewState) => {
    const baseClass = "flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2 transition-all relative group md:p-3";
    if (currentView === view) {
      return `${baseClass} bg-primary text-white shadow-lg shadow-primary/30`;
    }
    return `${baseClass} text-slate-300 hover:text-white hover:bg-slate-800`;
  };
  const mobileTabButtonClass = (view: ViewState) => {
    const baseClass = "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-3 transition-all";
    if (currentView === view) {
      return `${baseClass} bg-primary text-white shadow-lg shadow-primary/30`;
    }
    return `${baseClass} bg-slate-950/40 text-slate-300 hover:bg-slate-800 hover:text-white`;
  };

  const handleSignOut = async () => {
    // 注销并跳转回首页(登录页)
    // 注意: 需要在 Logto 控制台将 http://localhost:5173 添加到 "Post Sign-out Redirect URI"
    setIsAvatarMenuOpen(false);
    await signOut(window.location.origin);
  };

  const handleSignIn = async () => {
    setIsAvatarMenuOpen(false);
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
    setIsAvatarMenuOpen(false);
  };

  React.useEffect(() => {
    if (!isAvatarMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node;
      const isInsideMobileMenu = mobileAvatarMenuRef.current?.contains(targetNode);
      const isInsideDesktopMenu = desktopAvatarMenuRef.current?.contains(targetNode);

      if (!isInsideMobileMenu && !isInsideDesktopMenu) {
        setIsAvatarMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAvatarMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAvatarMenuOpen]);

  const handleAvatarClick = () => {
    setIsAvatarMenuOpen((open) => !open);
  };

  const handleOpenFeedback = () => {
    setIsAvatarMenuOpen(false);
    onOpenFeedback();
  };

  const renderAvatarMenu = (isDesktop = false) => (
    <div
      className={`absolute z-[60] min-w-[176px] overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 p-2 shadow-2xl shadow-slate-950/40 backdrop-blur ${
        isDesktop ? 'left-full top-1/2 ml-3 -translate-y-1/2' : 'left-0 top-full mt-3'
      }`}
      role="menu"
      aria-label="头像工具栏"
    >
      <div className="border-b border-slate-800 px-3 pb-2 pt-1">
        <div className="text-sm font-semibold text-white">{displayName}</div>
        <div className="text-xs text-slate-400">{isAuthenticated ? '账户工具' : '快速入口'}</div>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <button
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
          onClick={handleToggleTheme}
          type="button"
          role="menuitem"
        >
          {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{isDarkMode ? '切换浅色' : '切换深色'}</span>
        </button>
        <button
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
          onClick={handleOpenFeedback}
          type="button"
          role="menuitem"
        >
          <MessageSquare className="h-4 w-4" />
          <span>反馈</span>
        </button>
        {isAuthenticated ? (
          <button
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-red-300 transition hover:bg-red-950/40 hover:text-red-200"
            onClick={handleSignOut}
            type="button"
            role="menuitem"
          >
            <LogOut className="h-4 w-4" />
            <span>登出</span>
          </button>
        ) : (
          <button
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-emerald-300 transition hover:bg-emerald-950/40 hover:text-emerald-200"
            onClick={handleSignIn}
            type="button"
            role="menuitem"
          >
            <LogIn className="h-4 w-4" />
            <span>登录</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <nav className="w-full shrink-0 border-b border-slate-800 bg-slate-900 z-50 md:flex md:h-full md:w-[72px] md:flex-col md:items-center md:border-b-0 md:border-r">
      <div className="px-3 py-3 md:hidden">
        <div className="flex items-center gap-3">
          <div ref={mobileAvatarMenuRef} className="relative shrink-0">
            <button
              className="group relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-base font-bold text-white shadow-lg ring-2 ring-slate-800 transition-all hover:ring-slate-700"
              onClick={handleAvatarClick}
              type="button"
              aria-label="打开头像工具栏"
              aria-expanded={isAvatarMenuOpen}
              aria-haspopup="menu"
            >
              {avatarInitial}
            </button>
            {isAvatarMenuOpen ? renderAvatarMenu() : null}
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            <button
              className={mobileTabButtonClass(ViewState.DASHBOARD)}
              onClick={() => setView(ViewState.DASHBOARD)}
              type="button"
            >
              <FolderOpen className="h-5 w-5 shrink-0" />
              <span className="truncate text-xs font-medium">我的简历</span>
            </button>
            <button
              className={mobileTabButtonClass(ViewState.EXPERIENCE_BANK)}
              onClick={() => setView(ViewState.EXPERIENCE_BANK)}
              type="button"
            >
              <Database className="h-5 w-5 shrink-0" />
              <span className="truncate text-xs font-medium">经历库</span>
            </button>
            <button
              className={mobileTabButtonClass(ViewState.EDITOR)}
              onClick={() => setView(ViewState.EDITOR)}
              type="button"
            >
              <Wand2 className="h-5 w-5 shrink-0" />
              <span className="truncate text-xs font-medium">简历工厂</span>
            </button>
          </div>
        </div>
      </div>

      <div className="hidden items-center justify-between px-4 py-4 md:flex md:flex-col md:justify-start md:gap-8 md:px-0 md:py-6">
        <div ref={desktopAvatarMenuRef} className="relative">
          <button
            className="group relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold shadow-lg ring-2 ring-slate-800 transition-all hover:ring-slate-700"
            onClick={handleAvatarClick}
            type="button"
            aria-label="打开头像工具栏"
            aria-expanded={isAvatarMenuOpen}
            aria-haspopup="menu"
          >
            {avatarInitial}
            <div className="nav-tooltip hidden md:block">{displayName}</div>
          </button>
          {isAvatarMenuOpen ? renderAvatarMenu(true) : null}
        </div>
      </div>

      <div className="hidden grid-cols-3 gap-2 px-3 pb-3 md:flex md:w-full md:flex-col md:items-center md:gap-6 md:px-0 md:pb-0">
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
    </nav>
  );
};

export default GlobalSidebar;
