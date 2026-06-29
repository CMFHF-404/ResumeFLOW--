import React, { type MouseEvent } from 'react';
import {
  Edit2,
  Trash2,
} from 'lucide-react';
import { type AssistantSession } from '../../services/aiService';
import { formatRelativeTime } from '../../utils/timeUtils';
import { isPendingLatestPreview } from './sessionUtils';

type AssistantSidebarHistoryDropdownProps = {
  sessions: AssistantSession[];
  selectedSessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (event: MouseEvent, session: AssistantSession) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
};

export const AssistantSidebarHistoryDropdown: React.FC<AssistantSidebarHistoryDropdownProps> = ({
  sessions,
  selectedSessionId,
  isOpen,
  onClose,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}) => (
  <>
    <button
      type="button"
      aria-label="关闭对话记录面板"
      aria-hidden={!isOpen}
      tabIndex={isOpen ? 0 : -1}
      onClick={onClose}
      className={`absolute inset-x-0 bottom-0 top-[57px] z-20 bg-slate-950/5 transition-opacity duration-200 dark:bg-slate-950/20 ${
        isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
    />
    <aside
      id="assistant-sidebar-history-panel"
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`absolute left-3 right-3 top-[57px] z-30 origin-top transition-all duration-200 ease-out ${
        isOpen
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none -translate-y-3 opacity-0'
      }`}
    >
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_24px_70px_-34px_rgba(2,6,23,0.95)]">
        <div className="max-h-72 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              还没有历史会话
            </div>
          ) : (
            <div className="space-y-1.5">
              {sessions.map((session) => {
                const isSelected = selectedSessionId === session.id;
                const hasPendingDraft = isPendingLatestPreview(session);
                return (
                  <div
                    key={session.id}
                    className={`group relative flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 transition ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-100'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className="min-w-0 flex-1 text-left outline-none"
                      title={session.title}
                    >
                      <div className="truncate text-sm font-semibold">{session.title}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                        <span>{formatRelativeTime(session.updated_at)}</span>
                        {hasPendingDraft ? <span className="text-emerald-600 dark:text-emerald-300">草稿</span> : null}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={(event) => onRenameSession(event, session)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        title="重命名对话"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => onDeleteSession(event, session.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                        title="删除对话"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  </>
);
