import { useEffect, useState } from 'react';
import { useLogto } from '@logto/react';
import {
  resolveAuthUserKeyFromActiveSession,
} from '../services/apiClient';

const LOG_PREFIX = '[useAuthUserKey]';
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
  const [userKey, setUserKey] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadUserKey = async () => {
      if (isLoading) {
        return;
      }

      if (!isAuthenticated || !getIdTokenClaims) {
        if (!isCancelled) {
          setUserKey(null);
        }
        return;
      }

      try {
        const claims = await getIdTokenClaims();
        const nextKey = resolveUserKey(claims);
        if (!isCancelled) {
          setUserKey(nextKey);
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} 读取用户标识失败`, error);
        if (!isCancelled) {
          const fallbackUserKey = await resolveAuthUserKeyFromActiveSession();
          setUserKey(fallbackUserKey);
        }
      }
    };

    void loadUserKey();

    return () => {
      isCancelled = true;
    };
  }, [getIdTokenClaims, isAuthenticated, isLoading]);

  return userKey;
};
