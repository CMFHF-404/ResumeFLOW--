import {
  useAuthOwnerOperationGuard,
  type AuthOwnerOperation,
  type AuthOwnerOperationGuard,
} from '../../hooks/useAuthOwnerOperationGuard';

export type AssistantOwnerOperation = AuthOwnerOperation;
export type AssistantOwnerGuard = AuthOwnerOperationGuard;
export const useAssistantOwnerGuard = useAuthOwnerOperationGuard;
