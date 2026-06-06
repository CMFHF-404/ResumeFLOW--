import { useEffect, type MutableRefObject } from 'react';

import type {
  AssistantEntryContext,
  AssistantMode,
  AssistantSelectedResume,
  AssistantSession,
} from '../../services/aiService';
import { normalizeSelectedResume } from './selectionUtils';
import type { AssistantApplyDraftHandler, AssistantLaunchRequest } from './types';

type CreateSessionRecord = (
  context?: AssistantEntryContext,
  options?: { callbackOnly?: boolean },
) => Promise<AssistantSession>;

type CommitCreatedSession = (
  created: AssistantSession,
  options?: { selectSession?: boolean; preserveAttachment?: boolean; selectedResumeDraft?: AssistantSelectedResume | null },
) => void;

type SendAssistantMessage = (
  sessionId: string,
  payload: {
    userMessage: string;
    skillId?: AssistantLaunchRequest['initialSkillId'];
    selectedResume?: AssistantSelectedResume | null;
  },
  mode?: AssistantMode,
  options?: { shouldAbort?: () => boolean },
) => Promise<void>;

type UseAssistantLaunchBootstrapParams = {
  pendingLaunchRequest?: AssistantLaunchRequest | null;
  isAuthenticated: boolean;
  suppressAutoSelectSessionRef: MutableRefObject<boolean>;
  applyHandlerMapRef: MutableRefObject<Map<string, AssistantApplyDraftHandler>>;
  callbackOnlySessionIdsRef: MutableRefObject<Set<string>>;
  onConsumeLaunchRequest?: (requestId?: string) => void;
  createSessionRecord: CreateSessionRecord;
  commitCreatedSession: CommitCreatedSession;
  cleanupSupersededSession: (sessionId: string) => Promise<void>;
  sendMessage: SendAssistantMessage;
  resetForDraftLaunch: (
    launchRequest: AssistantLaunchRequest,
    selectedResume: AssistantSelectedResume | null,
  ) => void;
  error: (message: string, duration?: number) => void;
};

export const useAssistantLaunchBootstrap = ({
  pendingLaunchRequest,
  isAuthenticated,
  suppressAutoSelectSessionRef,
  applyHandlerMapRef,
  callbackOnlySessionIdsRef,
  onConsumeLaunchRequest,
  createSessionRecord,
  commitCreatedSession,
  cleanupSupersededSession,
  sendMessage,
  resetForDraftLaunch,
  error,
}: UseAssistantLaunchBootstrapParams) => {
  if (pendingLaunchRequest?.prefillResume && !pendingLaunchRequest.initialUserMessage) {
    suppressAutoSelectSessionRef.current = true;
  }

  useEffect(() => {
    if (!pendingLaunchRequest || !isAuthenticated) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      try {
        const normalizedPrefillResume = normalizeSelectedResume(pendingLaunchRequest.prefillResume);
        if (!pendingLaunchRequest.initialUserMessage) {
          resetForDraftLaunch(pendingLaunchRequest, normalizedPrefillResume);
          return;
        }
        const created = await createSessionRecord(pendingLaunchRequest.context, {
          callbackOnly: pendingLaunchRequest.callbackOnly,
        });
        if (cancelled) {
          await cleanupSupersededSession(created.id);
          return;
        }
        commitCreatedSession(created, {
          selectSession: true,
          selectedResumeDraft: normalizedPrefillResume,
        });
        if (cancelled) {
          await cleanupSupersededSession(created.id);
          return;
        }
        if (pendingLaunchRequest.applyDraftHandler) {
          applyHandlerMapRef.current.set(created.id, pendingLaunchRequest.applyDraftHandler);
        }
        if (pendingLaunchRequest.callbackOnly) {
          callbackOnlySessionIdsRef.current.add(created.id);
        }
        if (pendingLaunchRequest.initialUserMessage) {
          if (cancelled) {
            await cleanupSupersededSession(created.id);
            return;
          }
          await sendMessage(
            created.id,
            {
              userMessage: pendingLaunchRequest.initialUserMessage,
              skillId: pendingLaunchRequest.initialSkillId ?? null,
              selectedResume: pendingLaunchRequest.prefillResume ?? null,
            },
            pendingLaunchRequest.context.mode,
            { shouldAbort: () => cancelled },
          );
          if (cancelled) {
            await cleanupSupersededSession(created.id);
            return;
          }
        }
      } catch (launchError) {
        console.error('[AIAssistant] Failed to bootstrap launch request:', launchError);
        error('打开 AI 助理失败，请稍后重试');
      } finally {
        onConsumeLaunchRequest?.(pendingLaunchRequest.requestId);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    applyHandlerMapRef,
    callbackOnlySessionIdsRef,
    cleanupSupersededSession,
    commitCreatedSession,
    createSessionRecord,
    error,
    isAuthenticated,
    onConsumeLaunchRequest,
    pendingLaunchRequest,
    resetForDraftLaunch,
    sendMessage,
  ]);
};
