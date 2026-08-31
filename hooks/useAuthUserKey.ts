import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useLogto } from '@logto/react';
import {
  resolveAuthUserKeyFromActiveSession,
} from '../services/apiClient';
import {
  type AuthTokenVerificationProbe,
  readAuthSessionSnapshot,
  isAuthSessionInvalidError,
  probeAuthTokenForVerification,
  setAuthSessionPendingClaimsOwner,
  setAuthSessionOwner,
  setAuthSessionOwnerFromClaims,
  subscribeAuthSession,
} from '../services/authTokenProvider';

const LOG_PREFIX = '[useAuthUserKey]';
const AUTH_OWNER_TOKEN_VERIFICATION_DELAYS_MS = [0, 50, 150, 300, 600, 1_200, 2_500, 5_000, 10_000];
const AUTH_OWNER_TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const AUTH_OWNER_TOKEN_TIMED_OUT_REQUEST_LIMIT = 2;
const AUTH_OWNER_TOKEN_VERIFICATION_COOLDOWN_MS = 30_000;
export const AUTH_USER_KEY_STORAGE_KEY = 'yuanzijianli.authUserKey';

type VerificationRequestResult = {
  ownerKey: string;
  status: 'resolved' | 'timed-out' | 'cancelled' | 'session-invalid';
  probe: AuthTokenVerificationProbe | null;
};

type PendingVerificationRequest = {
  ownerKey: string;
  promise: Promise<VerificationRequestResult>;
  cancel: () => void;
};

const verificationTimeoutBudget = new Set<symbol>();
let pendingVerificationRequest: PendingVerificationRequest | null = null;
let verificationCooldown: {
  promise: Promise<void>;
  cancel: () => void;
} | null = null;
let verificationConsumerCount = 0;

const releaseTimedOutVerificationBudget = (requestId: symbol) => {
  verificationTimeoutBudget.delete(requestId);
};

const cancelPendingVerificationRequest = () => {
  pendingVerificationRequest?.cancel();
};

const waitForVerificationCooldown = (): Promise<void> => {
  if (verificationTimeoutBudget.size < AUTH_OWNER_TOKEN_TIMED_OUT_REQUEST_LIMIT) {
    return Promise.resolve();
  }
  if (verificationCooldown) {
    return verificationCooldown.promise;
  }

  let finish: (releaseSlot: boolean) => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    let settled = false;
    const timerId = setTimeout(
      () => finish(true),
      AUTH_OWNER_TOKEN_VERIFICATION_COOLDOWN_MS,
    );
    finish = (releaseSlot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      if (releaseSlot) {
        const oldestTimedOutRequest = verificationTimeoutBudget.values().next().value;
        if (oldestTimedOutRequest) {
          verificationTimeoutBudget.delete(oldestTimedOutRequest);
        }
      }
      if (verificationCooldown?.promise === promise) {
        verificationCooldown = null;
      }
      resolve();
    };
  });
  verificationCooldown = {
    promise,
    cancel: () => finish(false),
  };
  return promise;
};

const resetVerificationCircuit = () => {
  cancelPendingVerificationRequest();
  verificationTimeoutBudget.clear();
  verificationCooldown?.cancel();
  verificationCooldown = null;
};

const requestPendingVerificationToken = (expectedOwnerKey: string) => {
  const existingRequest = pendingVerificationRequest;
  if (existingRequest) {
    return existingRequest.promise;
  }

  const requestId = Symbol(expectedOwnerKey);
  let finishEntry: (
    status: VerificationRequestResult['status'],
    probe?: AuthTokenVerificationProbe | null,
  ) => boolean = () => false;
  let timedOut = false;
  const promise = new Promise<VerificationRequestResult>((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (finishEntry('timed-out')) {
        verificationTimeoutBudget.add(requestId);
      }
    }, AUTH_OWNER_TOKEN_REQUEST_TIMEOUT_MS);
    finishEntry = (status, probe = null) => {
      if (settled) {
        return false;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (pendingVerificationRequest?.promise === promise) {
        pendingVerificationRequest = null;
      }
      resolve({ ownerKey: expectedOwnerKey, status, probe });
      return true;
    };
  });
  const entry: PendingVerificationRequest = {
    ownerKey: expectedOwnerKey,
    promise,
    cancel: () => finishEntry('cancelled'),
  };
  pendingVerificationRequest = entry;
  void probeAuthTokenForVerification().then(
    (probe) => {
      const accepted = finishEntry('resolved', probe);
      if (!accepted && timedOut) {
        releaseTimedOutVerificationBudget(requestId);
      }
      if (!accepted) {
        probe.discard();
      }
    },
    (error) => {
      if (isAuthSessionInvalidError(error)) {
        finishEntry('session-invalid');
        return;
      }
      console.warn(`${LOG_PREFIX} 验证切换后的 token 请求失败`, error);
      const accepted = finishEntry('resolved');
      if (!accepted && timedOut) {
        releaseTimedOutVerificationBudget(requestId);
      }
    },
  );
  return promise;
};

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
  const pendingClaimsVerificationKeyRef = useRef<string | null>(null);
  const forceNextClaimsVerificationRef = useRef(false);
  const lastClaimsAttemptRef = useRef<{
    getter: typeof getIdTokenClaims;
    sessionEpoch: number;
  } | null>(null);
  const claimsRequestInFlightRef = useRef<{
    getter: typeof getIdTokenClaims;
    sessionEpoch: number;
    generation: number;
    phase: 'claims' | 'verification';
    requiresTokenVerification: boolean;
    verificationOwnerKey?: string | null;
  } | null>(null);
  const pendingVerificationWaitRef = useRef<{
    timerId: ReturnType<typeof setTimeout>;
    resolve: () => void;
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
  const authSessionSnapshot = useSyncExternalStore(
    subscribeAuthSession,
    readAuthSessionSnapshot,
    readAuthSessionSnapshot,
  );

  useEffect(() => {
    verificationConsumerCount += 1;
    return () => {
      cancelPendingVerificationWait();
      requestGenerationRef.current += 1;
      verificationConsumerCount = Math.max(0, verificationConsumerCount - 1);
      if (verificationConsumerCount === 0) {
        resetVerificationCircuit();
      }
    };
  }, [cancelPendingVerificationWait]);

  useEffect(() => {
    const shouldRevokePendingAuthority = isAuthenticated && (
      claimsRequestInFlightRef.current?.phase === 'verification'
      || pendingClaimsVerificationKeyRef.current !== null
    );
    cancelPendingVerificationWait();
    requestGenerationRef.current += 1;
    lastClaimsAttemptRef.current = null;
    claimsRequestInFlightRef.current = null;
    if (!isAuthenticated) {
      pendingClaimsVerificationKeyRef.current = null;
      forceNextClaimsVerificationRef.current = false;
      resetVerificationCircuit();
    } else if (shouldRevokePendingAuthority) {
      // A Logto getter replacement can be the only observable account-switch
      // signal. Invalidate shared token authority, while leaving the bounded
      // request wrapper alive so getter churn cannot bypass its timeout budget.
      pendingClaimsVerificationKeyRef.current = null;
      forceNextClaimsVerificationRef.current = true;
      setAuthSessionOwner(null);
    }
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

    const invalidateForFreshClaims = (latestOwnerKey: string | null) => {
      claimsOwnerKeyRef.current = latestOwnerKey;
      pendingClaimsVerificationKeyRef.current = null;
      forceNextClaimsVerificationRef.current = true;
      lastClaimsAttemptRef.current = null;
      requestGenerationRef.current += 1;
      claimsRequestInFlightRef.current = null;
      if (latestOwnerKey === null) {
        setAuthSessionOwner(null);
      } else {
        setAuthSessionPendingClaimsOwner(latestOwnerKey);
      }
    };

    const readLatestClaimsOwner = async () => {
      if (!getIdTokenClaims) {
        return null;
      }
      try {
        return resolveUserKey(await getIdTokenClaims());
      } catch (error) {
        console.warn(`${LOG_PREFIX} 复核用户标识失败`, error);
        return null;
      }
    };

    const verifyPendingClaimsOwner = async (
      expectedOwnerKey: string,
    ): Promise<'confirmed' | 'cancelled'> => {
      let attemptIndex = 0;
      while (isCurrent()) {
        if (verificationTimeoutBudget.size >= AUTH_OWNER_TOKEN_TIMED_OUT_REQUEST_LIMIT) {
          await waitForVerificationCooldown();
          if (!isCurrent()) {
            return 'cancelled';
          }
          attemptIndex = 0;
        }
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
          return 'cancelled';
        }
        try {
          const requestResult = await requestPendingVerificationToken(expectedOwnerKey);
          if (!isCurrent()) {
            requestResult.probe?.discard();
            return 'cancelled';
          }
          if (
            requestResult.status === 'cancelled'
            || requestResult.status === 'session-invalid'
          ) {
            return 'cancelled';
          }
          if (requestResult.status === 'timed-out') {
            attemptIndex += 1;
            continue;
          }
          const probe = requestResult.probe;
          if (!probe || requestResult.ownerKey !== expectedOwnerKey) {
            probe?.discard();
            attemptIndex += 1;
            continue;
          }

          if (probe.ownerKey === expectedOwnerKey) {
            const latestClaimsOwner = await readLatestClaimsOwner();
            if (!isCurrent()) {
              probe.discard();
              return 'cancelled';
            }
            if (latestClaimsOwner !== expectedOwnerKey) {
              probe.discard();
              invalidateForFreshClaims(latestClaimsOwner);
              return 'cancelled';
            }
            if (probe.publish(expectedOwnerKey)) {
              return 'confirmed';
            }
            probe.discard();
            if (readAuthSessionSnapshot().ownerKey === expectedOwnerKey) {
              // Another hook instance may have atomically published this shared
              // proof first. Treat the same verified owner as the shared result
              // instead of hiding it and starting the cycle again.
              return 'confirmed';
            }
            setAuthSessionPendingClaimsOwner(expectedOwnerKey);
            attemptIndex += 1;
            continue;
          }

          const probedOwnerKey = probe.ownerKey;
          probe.discard();
          if (probedOwnerKey !== null) {
            const latestClaimsOwner = await readLatestClaimsOwner();
            if (!isCurrent()) {
              return 'cancelled';
            }
            if (latestClaimsOwner !== expectedOwnerKey) {
              invalidateForFreshClaims(latestClaimsOwner);
              return 'cancelled';
            }
            // Claims still expect this owner while the token belongs elsewhere.
            // Hide any previous authority and keep ordinary token reads blocked
            // until a matching proof can be atomically published.
            setAuthSessionPendingClaimsOwner(expectedOwnerKey);
          }
        } catch (error) {
          console.warn(`${LOG_PREFIX} 验证切换后的用户标识失败`, error);
        }
        attemptIndex += 1;
      }
      return 'cancelled';
    };

    if (!isAuthenticated) {
      cancelPendingVerificationWait();
      resetVerificationCircuit();
      claimsOwnerKeyRef.current = null;
      pendingClaimsVerificationKeyRef.current = null;
      forceNextClaimsVerificationRef.current = false;
      lastClaimsAttemptRef.current = null;
      setAuthSessionOwner(null);
      return;
    }

    if (
      readAuthSessionSnapshot().ownerKey !== null
      && claimsRequestInFlightRef.current === null
      && pendingClaimsVerificationKeyRef.current === null
    ) {
      // A Logto token/claims read toggles the shared loading state and
      // re-renders this hook while its own verification is still active.
      // Reset only once that attempt has fully settled; otherwise each pulse
      // cancels the verifier and the following render starts it again forever.
      cancelPendingVerificationWait();
      resetVerificationCircuit();
    }

    // A routine Logto loading pulse must not erase an already established
    // owner. The guard remains fail-closed only when the shared authority is
    // actually unresolved.
    if (isLoading) {
      const inFlightAttempt = claimsRequestInFlightRef.current;
      if (
        inFlightAttempt?.phase === 'verification'
        && inFlightAttempt.generation === requestGenerationRef.current
      ) {
        // Every Logto ID-token read raises isLoading itself, including the
        // verifier that promotes pending claims from A to B. Cancelling any
        // current verifier here makes that request restart itself forever.
        // A claims recheck after confirmation handles a real account switch
        // that happens to overlap this otherwise indistinguishable pulse.
        return;
      }
      if (
        inFlightAttempt?.getter === getIdTokenClaims
        && inFlightAttempt.generation === requestGenerationRef.current
        && inFlightAttempt.phase === 'claims'
      ) {
        // Logto's proxied getIdTokenClaims() briefly raises the shared loading
        // state for the request that is already in flight. Invalidating that
        // same attempt here makes every initial claims read cancel itself and
        // can leave AuthGuard on its loading screen forever.
        // The pulse can also be a real account switch, so its eventual claims
        // result must be confirmed against the current ID token before commit.
        inFlightAttempt.requiresTokenVerification = true;
        return;
      }
      // A stable Logto getter can point at a different account after a loading
      // pulse. Invalidate the completed/in-flight claims attempt so the false
      // transition performs one fresh read without clearing the known owner.
      const shouldRevokePendingAuthority = inFlightAttempt?.phase === 'verification'
        && authSessionSnapshot.ownerKey === null;
      cancelPendingVerificationWait();
      resetVerificationCircuit();
      requestGenerationRef.current += 1;
      lastClaimsAttemptRef.current = null;
      claimsRequestInFlightRef.current = null;
      pendingClaimsVerificationKeyRef.current = null;
      if (shouldRevokePendingAuthority) {
        // The underlying token promise cannot be cancelled. Advance the shared
        // authority epoch so a late token for the superseded account cannot
        // publish itself before the newest claims request completes.
        forceNextClaimsVerificationRef.current = true;
        setAuthSessionOwner(null);
      }
      return;
    }
    if (!getIdTokenClaims) {
      return;
    }

    const activeVerificationAttempt = claimsRequestInFlightRef.current;
    if (
      activeVerificationAttempt?.phase === 'verification'
      && activeVerificationAttempt.generation === requestGenerationRef.current
      && (
        authSessionSnapshot.ownerKey === null
        || activeVerificationAttempt.verificationOwnerKey === authSessionSnapshot.ownerKey
      )
    ) {
      // The false half of the verifier's own loading pulse can render before
      // the non-publishing probe has completed its claims check and atomic
      // publish. Keep the in-flight attempt while authority is hidden or has
      // just become its verified candidate.
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
    const attempt: NonNullable<typeof claimsRequestInFlightRef.current> = {
      getter: getIdTokenClaims,
      sessionEpoch: authSessionSnapshot.epoch,
      generation: requestGeneration,
      phase: 'claims',
      requiresTokenVerification: forceNextClaimsVerificationRef.current,
    };
    claimsRequestInFlightRef.current = attempt;

    const loadUserKey = async () => {
      try {
        const claims = await getIdTokenClaims();
        attempt.phase = 'verification';
        const nextKey = resolveUserKey(claims);
        attempt.verificationOwnerKey = nextKey;
        if (isCurrent()) {
          if (attempt.requiresTokenVerification && nextKey === null) {
            claimsOwnerKeyRef.current = null;
            pendingClaimsVerificationKeyRef.current = null;
            setAuthSessionOwner(null);
            const hiddenSnapshot = readAuthSessionSnapshot();
            attempt.sessionEpoch = hiddenSnapshot.epoch;
            lastClaimsAttemptRef.current = {
              getter: getIdTokenClaims,
              sessionEpoch: hiddenSnapshot.epoch,
            };
            const fallbackUserKey = await resolveAuthUserKeyFromActiveSession();
            if (!isCurrent()) {
              return;
            }
            commitUserKey(fallbackUserKey);
            forceNextClaimsVerificationRef.current = false;
            return;
          }
          let ownerConfirmed = false;
          if (
            nextKey !== null
            && (
              attempt.requiresTokenVerification
              || pendingClaimsVerificationKeyRef.current !== null
            )
          ) {
            // Remember the observed claims identity even before it is trusted.
            // If token verification advances the shared authority and reruns
            // this effect, the same stale claims value must not be treated as
            // a brand-new initial authority on the next attempt.
            claimsOwnerKeyRef.current = nextKey;
            pendingClaimsVerificationKeyRef.current = nextKey;
            if (readAuthSessionSnapshot().ownerKey !== nextKey) {
              setAuthSessionPendingClaimsOwner(nextKey);
            }
            const verification = await verifyPendingClaimsOwner(nextKey);
            if (!isCurrent() || verification !== 'confirmed') {
              return;
            }
            pendingClaimsVerificationKeyRef.current = null;
            forceNextClaimsVerificationRef.current = false;
            ownerConfirmed = true;
          }
          const previousClaimsOwnerKey = claimsOwnerKeyRef.current;
          const establishedOwnerKey = readAuthSessionSnapshot().ownerKey;
          if (
            !ownerConfirmed
            && nextKey !== null
            && previousClaimsOwnerKey === nextKey
            && establishedOwnerKey === nextKey
          ) {
            // A stable Logto getter may still be serving an older account after
            // an overlapping loading pulse. Confirm the repeated claims value
            // against the current ID token before treating it as authoritative.
            pendingClaimsVerificationKeyRef.current = nextKey;
            const verification = await verifyPendingClaimsOwner(nextKey);
            if (!isCurrent() || verification !== 'confirmed') {
              return;
            }
            pendingClaimsVerificationKeyRef.current = null;
          }
          const committedSnapshot = commitUserKey(nextKey);
          forceNextClaimsVerificationRef.current = false;
          if (nextKey && committedSnapshot.ownerKey === null) {
            pendingClaimsVerificationKeyRef.current = nextKey;
            const verification = await verifyPendingClaimsOwner(nextKey);
            if (!isCurrent() || verification !== 'confirmed') {
              return;
            }
            pendingClaimsVerificationKeyRef.current = null;
            commitUserKey(nextKey);
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} 读取用户标识失败`, error);
        try {
          const fallbackUserKey = await resolveAuthUserKeyFromActiveSession();
          if (isCurrent()) {
            if (fallbackUserKey !== null) {
              pendingClaimsVerificationKeyRef.current = null;
            }
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
    getIdTokenClaims,
    isAuthenticated,
    isLoading,
  ]);

  return isAuthenticated ? authSessionSnapshot.ownerKey : null;
};
