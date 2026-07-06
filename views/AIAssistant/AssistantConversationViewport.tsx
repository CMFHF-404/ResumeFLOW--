import React from 'react';
import {
  type AssistantMessage,
} from '../../services/aiService';
import {
  readMessageAttachmentPreviews,
} from './attachmentUtils';
import {
  readMessageSelectedExperiences,
  readMessageSelectedResume,
} from './selectionUtils';
import { ActiveThoughtBlock, MessageItem } from './MessageItem';

type AssistantConversationViewportProps = {
  messageViewportRef: React.RefObject<HTMLDivElement | null>;
  messages: AssistantMessage[];
  isSidebarSurface: boolean;
  composerReservedHeight: number;
  shouldShowEmptyAssistantGreeting: boolean;
  isLoadingDetail: boolean;
  activeThought: string;
  isSending: boolean;
};

const ASSISTANT_EMPTY_GREETING = '嗨，我在这里。把零散经历、目标 JD 或想法丢给我，我们一起整理成能投递的表达。';

export const AssistantConversationViewport: React.FC<AssistantConversationViewportProps> = ({
  messageViewportRef,
  messages,
  isSidebarSurface,
  composerReservedHeight,
  shouldShowEmptyAssistantGreeting,
  isLoadingDetail,
  activeThought,
  isSending,
}) => (
  <div
    ref={messageViewportRef}
    className={isSidebarSurface
      ? 'min-w-0 flex-1 overflow-y-auto px-3 pt-4'
      : 'min-w-0 flex-1 overflow-y-auto px-3 pt-4 sm:px-4 md:px-7 md:pt-6'
    }
    style={{ paddingBottom: `${composerReservedHeight}px` }}
  >
    <div className={isSidebarSurface
      ? 'flex w-full min-w-0 flex-col pb-4 pt-1'
      : 'mx-auto flex w-full max-w-3xl min-w-0 flex-col pb-4 pt-2 md:pt-4'
    }>
      {shouldShowEmptyAssistantGreeting ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center px-5 text-center">
          <p className="text-base font-semibold text-slate-700 dark:text-slate-100">
            {ASSISTANT_EMPTY_GREETING}
          </p>
        </div>
      ) : null}
      {messages.map((message) => {
        if (message.message_type === 'draft_card') {
          return null;
        }
        const isUser = message.role === 'user';
        const text = typeof message.content_json?.text === 'string' ? message.content_json.text : '';
        const thinking = typeof message.content_json?.thinking === 'string' ? message.content_json.thinking : '';
        const attachments = readMessageAttachmentPreviews(message);
        const selectedExperiencePreviews = readMessageSelectedExperiences(message);
        const selectedResumePreview = readMessageSelectedResume(message);
        return (
          <MessageItem
            key={message.id}
            isUser={isUser}
            content={text}
            thinking={!isUser ? thinking : undefined}
            attachments={attachments}
            selectedExperiences={selectedExperiencePreviews}
            selectedResume={selectedResumePreview}
            hideSelectedResumeCard={isSidebarSurface}
          />
        );
      })}
      {isLoadingDetail ? (
        <div className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">正在加载会话...</div>
      ) : null}
      {activeThought ? (
        <ActiveThoughtBlock thought={activeThought} />
      ) : null}
      {isSending && !activeThought ? (
        <div className="mb-6 flex justify-start">
          <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-medium text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span>正在生成回复...</span>
          </div>
        </div>
      ) : null}
    </div>
  </div>
);
