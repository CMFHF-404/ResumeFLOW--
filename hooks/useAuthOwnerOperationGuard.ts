import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import {
  assertAuthCacheKey,
  AuthContextChangedError,
  captureAuthCacheKey,
} from '../services/apiClient';

export type AuthOwnerOperation = {
  expectedAuthCacheKey: string;
  generation: number;
};

export type AuthOwnerOperationGuard = {
  authUserKey: string | null;
  beginOperation: () => Promise<AuthOwnerOperation>;
  assertOperationCurrent: (operation: AuthOwnerOperation) => Promise<void>;
  isOperationCurrent: (operation: AuthOwnerOperation) => boolean;
};

export const useAuthOwnerOperationGuard = (
  authUserKey: string | null,
): AuthOwnerOperationGuard => {
  const committedOwnerRef = useRef(authUserKey);
  const generationRef = useRef(0);

  useLayoutEffect(() => {
    if (committedOwnerRef.current !== authUserKey) {
      committedOwnerRef.current = authUserKey;
      generationRef.current += 1;
    }
  }, [authUserKey]);

  useEffect(() => () => {
    generationRef.current += 1;
  }, []);

  const isOperationCurrent = useCallback((operation: AuthOwnerOperation) => (
    generationRef.current === operation.generation
    && committedOwnerRef.current === operation.expectedAuthCacheKey
  ), []);

  const assertOperationCurrent = useCallback(async (operation: AuthOwnerOperation) => {
    if (!isOperationCurrent(operation)) {
      throw new AuthContextChangedError();
    }
    await assertAuthCacheKey(operation.expectedAuthCacheKey);
    if (!isOperationCurrent(operation)) {
      throw new AuthContextChangedError();
    }
  }, [isOperationCurrent]);

  const beginOperation = useCallback(async () => {
    if (
      !authUserKey
      || authUserKey === 'anonymous'
      || committedOwnerRef.current !== authUserKey
    ) {
      throw new AuthContextChangedError();
    }
    const expectedAuthCacheKey = await captureAuthCacheKey(authUserKey);
    const operation = {
      expectedAuthCacheKey,
      generation: generationRef.current,
    };
    await assertOperationCurrent(operation);
    return operation;
  }, [assertOperationCurrent, authUserKey]);

  return useMemo(() => ({
    authUserKey,
    beginOperation,
    assertOperationCurrent,
    isOperationCurrent,
  }), [authUserKey, beginOperation, assertOperationCurrent, isOperationCurrent]);
};
