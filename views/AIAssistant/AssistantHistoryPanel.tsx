import React, { type Dispatch, type MouseEvent, type SetStateAction } from 'react';
import {
  Edit2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  X,
} from 'lucide-react';

type AssistantHistorySession = {
  id: string;
  title: string;
};

type AssistantHistoryPanelProps = {
  sessions: AssistantHistorySession[];
  selectedSessionId: string | null;
  isDesktopHistoryCollapsed: boolean;
  setIsDesktopHistoryCollapsed: Dispatch<SetStateAction<boolean>>;
  isMobileHistoryOpen: boolean;
  setIsMobileHistoryOpen: Dispatch<SetStateAction<boolean>>;
  onNewChat: () => void;
  onSelectDesktopSession: (sessionId: string) => void;
  onSelectMobileSession: (sessionId: string) => void;
  onRenameSession: (event: MouseEvent, session: AssistantHistorySession) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
};

type SessionListProps = {
  sessions: AssistantHistorySession[];
  selectedSessionId: string | null;
  surface: 'desktop' | 'mobile';
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (event: MouseEvent, session: AssistantHistorySession) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
};

const HistoryEmptyState = () => (
  <div className="rounded-3xl border border-dashed border-white/12 px-4 py-6 text-center text-sm leading-6 text-slate-400">
    还没有历史会话。新建一个对话，AI 助理就会开始帮你整理素材。
  </div>
);

const AssistantHistorySessionList: React.FC<SessionListProps> = ({
  sessions,
  selectedSessionId,
  surface,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}) => {
  if (sessions.length === 0) {
    return <HistoryEmptyState />;
  }

  const isMobile = surface === 'mobile';

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const isSelected = selectedSessionId === session.id;
        return (
          <div
            key={session.id}
            className={`group relative flex w-full items-center justify-between ${isMobile ? 'rounded-2xl' : 'rounded-xl'} px-4 py-3 text-left transition ${
              isSelected ? 'bg-white text-slate-950 shadow-lg' : 'bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectSession(session.id)}
              className={`flex-1 truncate text-left text-sm font-semibold outline-none ${isMobile ? 'pr-16' : 'pr-8'}`}
              title={session.title}
            >
              {session.title}
            </button>
            <div className={`absolute right-3 flex items-center gap-1 ${
              isMobile
                ? ''
                : 'md:pointer-events-none md:opacity-0 md:transition md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100'
            }`}
            >
              <button
                type="button"
                onClick={(event) => onRenameSession(event, session)}
                className={`rounded-md p-1.5 transition ${
                  isSelected
                    ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    : 'text-slate-400 hover:bg-white/20 hover:text-white'
                }`}
                title="重命名对话"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(event) => onDeleteSession(event, session.id)}
                className={`rounded-md p-1.5 transition ${
                  isSelected
                    ? 'text-slate-400 hover:bg-red-50 hover:text-red-500'
                    : 'text-slate-400 hover:bg-red-500/20 hover:text-red-400'
                }`}
                title="删除对话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const AssistantHistoryPanel: React.FC<AssistantHistoryPanelProps> = ({
  sessions,
  selectedSessionId,
  isDesktopHistoryCollapsed,
  setIsDesktopHistoryCollapsed,
  isMobileHistoryOpen,
  setIsMobileHistoryOpen,
  onNewChat,
  onSelectDesktopSession,
  onSelectMobileSession,
  onRenameSession,
  onDeleteSession,
}) => (
  <>
    <aside
      className={`hidden shrink-0 border-r border-white/60 bg-slate-950 text-slate-100 shadow-[18px_0_50px_-34px_rgba(15,23,42,0.85)] transition-[width] duration-300 md:flex md:flex-col ${
        isDesktopHistoryCollapsed ? 'w-[68px]' : 'w-[320px]'
      }`}
    >
      {isDesktopHistoryCollapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 py-5">
          <button
            type="button"
            onClick={() => setIsDesktopHistoryCollapsed(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
            title="展开对话记录"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
            title="新建综合会话"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <>
          <div className="border-b border-white/10 px-5 pb-5 pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">AI Assistant</div>
                <div className="mt-2 truncate text-xl font-semibold text-white">AI 助理</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onNewChat}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
                  title="新建综合会话"
                >
                  <MessageSquarePlus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsDesktopHistoryCollapsed(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
                  title="收起对话记录"
                >
                  <PanelLeftClose className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <AssistantHistorySessionList
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              surface="desktop"
              onSelectSession={onSelectDesktopSession}
              onRenameSession={onRenameSession}
              onDeleteSession={onDeleteSession}
            />
          </div>
        </>
      )}
    </aside>

    <>
      <button
        type="button"
        aria-label="关闭对话记录"
        onClick={() => setIsMobileHistoryOpen(false)}
        className={`fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[1px] transition-opacity duration-300 md:hidden ${
          isMobileHistoryOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-[71] flex w-[82vw] max-w-[320px] flex-col border-r border-white/12 bg-slate-950 text-slate-100 transition-all duration-300 ease-out md:hidden ${
          isMobileHistoryOpen
            ? 'translate-x-0 opacity-100 shadow-[24px_0_70px_-28px_rgba(15,23,42,0.95)]'
            : 'pointer-events-none -translate-x-[calc(100%+64px)] opacity-0 shadow-none'
        }`}
      >
        <div className="border-b border-white/10 px-4 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-300/80">对话记录</div>
              <div className="mt-2 text-lg font-semibold text-white">AI 助理</div>
            </div>
            <button
              type="button"
              onClick={() => setIsMobileHistoryOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-white transition hover:bg-white/12"
              title="关闭对话记录"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onNewChat}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-28px_rgba(16,185,129,0.85)] transition hover:bg-emerald-400"
          >
            <MessageSquarePlus className="h-4 w-4" />
            新建对话
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <AssistantHistorySessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            surface="mobile"
            onSelectSession={onSelectMobileSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        </div>
      </aside>
    </>
  </>
);
