import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useLogto } from '@logto/react';
import {
  resolveAuthUserKeyFromActiveSession,
} from '../services/apiClient';
import {
  readAuthSessionSnapshot,
  requestAuthToken,
  setAuthSessionOwner,
  setAuthSessionOwnerFromClaims,
  subscribeAuthSession,
} from '../services/authTokenProvider';

const LOG_PREFIX = '[useAuthUserKey]';
const AUTH_OWNER_TOKEN_VERIFICATION_DELAYS_MS = [0, 50, 150, 300, 600, 1_200, 2_500, 5_000, 10_000];
const AUTH_OWNER_TOKEN_REQUEST_TIMEOUT_MS = 10_000;
export const AUTH_USER_KEY_STORAGE_KEY = 'yuanzijianli.authUserKey';

export const readStoredAuthUserKey = () => {
  try {
    return localStorage.getItem(AUTH_USER_KEY_STORAGE_KEY);
  } catch (error) {
    return null;
  }
};

export const writeStoredAuthUserKey = (value: string | null) => {
  try {
    if (value) {
      localStorage.setItem(AUTH_USER_KEY_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(AUTH_USER_KEY_STORAGE_KEY);
    }
  } catch (error) {
    // ignore storage errors (private mode, etc.)
  }
};

const resolveUserKey = (claims: unknown): string | null => {
  if (!claims || typeof claims !== 'object') {
    return null;
  }
  const record = claims as { sub?: unknown };
  return typeof record.sub === 'string' ? record.sub : null;
};

export const useAuthUserKey = () => {
  const { isAuthenticated, isLoading, getIdTokenClaims } = useLogto();
  const requestGenerationRef = useRef(0);
  const claimsOwnerKeyRef = useRef<string | null | undefined>(undefined);
  const lastClaimsAttemptRef = useRef<{
    getter: typeof getIdTokenClaims;
    sessionEpoch: number;
  } | null>(null);
  const claimsRequestInFlightRef = useRef<{
    getter: typeof getIdTokenClaims;
    sessionEpoch: number;
    generation: number;
  } | null>(null);
  const pendingVerificationWaitRef = useRef<{
    timerId: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null>(null);
  const pendingVerificationRequestRef = useRef<{
    ownerKey: string;
    promise: Promise<{
      ownerKey: string;
      status: 'resolved' | 'timed-out' | 'cancelled';
    }>;
    cancel: () => void;
  } | null>(null);
  const cancelPendingVerificationWait = useCallback(() => {
    const pendingWait = pendingVerificationWaitRef.current;
    if (!pendingWait) {
      return;
    }
    pendingVerificationWaitRef.current = null;
    clearTimeout(pendingWait.timerId);
    pendingWait.resolve();
  }, []);
  const cancelPendingVerificationRequest = useCallback(() => {
    pendingVerificationRequestRef.current?.cancel();
  }, []);
  const requestPendingVerificationToken = useCallback((expectedOwnerKey: string) => {
    const existingRequest = pendingVerificationRequestRef.current;
    if (existingRequest) {
      return existingRequest.promise;
    }

    let finishEntry: (
      status: 'resolved' | 'timed-out' | 'cancelled',
    ) => void = () => undefined;
    const promise = new Promise<{
      ownerKey: string;
      status: 'resolved' | 'timed-out' | 'cancelled';
    }>((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => finishEntry('timed-out'), AUTH_OWNER_TOKEN_REQUEST_TIMEOUT_MS);
      finishEntry = (status) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        if (pendingVerificationRequestRef.current?.promise === promise) {
          pendingVerificationRequestRef.current = null;
        }
        resolve({ ownerKey: expectedOwnerKey, status });
      };
    });
    const entry = {
      ownerKey: expectedOwnerKey,
      promise,
      cancel: () => finishEntry('cancelled'),
    };
    pendingVerificationRequestRef.current = entry;
    void requestAuthToken().then(
      () => finishEntry('resolved'),
      (error) => {
        console.warn(`${LOG_PREFIX} 验证切换后的 token 请求失败`, error);
        finishEntry('resolved');
      },
    );
    return promise;
  }, []);
  const authSessionSnapshot = useSyncExternalStore(
    subscribeAuthSession,
    readAuthSessionSnapshot,
    readAuthSessionSnapshot,
  );

  useEffect(() => {
    cancelPendingVerificationWait();
    requestGenerationRef.current += 1;
    lastClaimsAttemptRef.current = null;
    claimsRequestInFlightRef.current = null;
  }, [cancelPendingVerificationWait, getIdTokenClaims, isAuthenticated]);

  useEffect(() => {
    let requestGeneration = requestGenerationRef.current;
    const isCurrent = () => requestGenerationRef.current === requestGeneration;
    const commitUserKey = (nextKey: string | null) => {
      const previousClaimsOwnerKey = claimsOwnerKeyRef.current;
      claimsOwnerKeyRef.current = nextKey;
      setAuthSessionOwnerFromClaims(nextKey, previousClaimsOwnerKey);
      const committedSnapshot = readAuthSessionSnapshot();
      lastClaimsAttemptRef.current = {
        getter: getIdTokenClaims,
        sessionEpoch: committedSnapshot.epoch,
      };
      return committedSnapshot;
    };

    const verifyPendingClaimsOwner = async (expectedOwnerKey: string) => {
      let attemptIndex = 0;
      while (isCurrent()) {
        const delayMs = AUTH_OWNER_TOKEN_VERIFICATION_DELAYS_MS[
          Math.min(attemptIndex, AUTH_OWNER_TOKEN_VERIFICATION_DELAYS_MS.length - 1)
        ];
        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            const timerId = setTimeout(() => {
              if (pendingVerificationWaitRef.current?.timerId === timerId) {
                pendingVerificationWaitRef.current = null;
              }
              resolve();
            }, delayMs);
            pendingVerificationWaitRef.current = { timerId, resolve };
          });
        }
        if (!isCurrent()) {
          return;
        }
        try {
          const requestResult = await requestPendingVerificationToken(expectedOwnerKey);
          if (!isCurrent()) {
            return;
          }
          if (
            requestResult.status === 'cancelled'
            || (
              requestResult.status === 'timed-out'
              && requestResult.ownerKey === expectedOwnerKey
            )
          ) {
            return;
          }
          const verifiedSnapshot = readAuthSessionSnapshot();
          if (verifiedSnapshot.ownerKey === expectedOwnerKey) {
            return;
          }
          if (verifiedSnapshot.ownerKey !== null) {
            return;
          }
        } catch (error) {
          console.warn(`${LOG_PREFIX} 验证切换后的用户标识失败`, error);
        }
        attemptIndex += 1;
      }
    };

    if (!isAuthenticated) {
      cancelPendingVerificationWait();
      cancelPendingVerificationRequest();
      claimsOwnerKeyRef.current = null;
      lastClaimsAttemptRef.current = null;
      setAuthSessionOwner(null);
      return;
    }

    if (authSessionSnapshot.ownerKey !== null) {
      cancelPendingVerificationWait();
      cancelPendingVerificationRequest();
    }

    // A routine Logto loading pulse must not erase an already established
    // owner. The guard remains fail-closed only when the shared authority is
    // actually unresolved.
    if (isLoading) {
      // A stable Logto getter can point at a different account after a loading
      // pulse. Invalidate the completed/in-flight claims attempt so the false
      // transition performs one fresh read without clearing the known owner.
      cancelPendingVerificationWait();
      requestGenerationRef.current += 1;
      lastClaimsAttemptRef.current = null;
      claimsRequestInFlightRef.current = null;
      return;
    }
    if (!getIdTokenClaims) {
      return;
    }

    const previousAttempt = lastClaimsAttemptRef.current;
    if (
      previousAttempt?.getter === getIdTokenClaims
      && previousAttempt.sessionEpoch === authSessionSnapshot.epoch
    ) {
      return;
    }
    const inFlightAttempt = claimsRequestInFlightRef.current;
    if (
      inFlightAttempt?.getter === getIdTokenClaims
      && inFlightAttempt.sessionEpoch === authSessionSnapshot.epoch
      && inFlightAttempt.generation === requestGenerationRef.current
    ) {
      return;
    }
    cancelPendingVerificationWait();
    requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const attempt = {
      getter: getIdTokenClaims,
      sessionEpoch: authSessionSnapshot.epoch,
      generation: requestGeneration,
    };
    claimsRequestInFlightRef.current = attempt;

    const loadUserKey = async () => {
      try {
        const claims = await getIdTokenClaims();
        const nextKey = resolveUserKey(claims);
        if (isCurrent()) {
          const committedSnapshot = commitUserKey(nextKey);
          if (nextKey && committedSnapshot.ownerKey === null) {
            await verifyPendingClaimsOwner(nextKey);
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} 读取用户标识失败`, error);
        try {
          const fallbackUserKey = await resolveAuthUserKeyFromActiveSession();
          if (isCurrent()) {
            commitUserKey(fallbackUserKey);
          }
        } catch (fallbackError) {
          console.warn(`${LOG_PREFIX} 回退读取用户标识失败`, fallbackError);
          if (isCurrent()) {
            commitUserKey(null);
          }
        }
      } finally {
        if (claimsRequestInFlightRef.current === attempt) {
          claimsRequestInFlightRef.current = null;
        }
      }
    };

    void loadUserKey();
  }, [
    authSessionSnapshot.epoch,
    cancelPendingVerificationWait,
    cancelPendingVerificationRequest,
    getIdTokenClaims,
    isAuthenticated,
    isLoading,
    requestPendingVerificationToken,
  ]);

  useEffect(() => () => {
    cancelPendingVerificationWait();
    cancelPendingVerificationRequest();
    requestGenerationRef.current += 1;
  }, [cancelPendingVerificationRequest, cancelPendingVerificationWait]);

  return isAuthenticated ? authSessionSnapshot.ownerKey : null;
};
