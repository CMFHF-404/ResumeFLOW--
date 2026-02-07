import { useEffect, useState } from 'react';
import { useLogto } from '@logto/react';

const LOG_PREFIX = '[useAuthUserKey]';

const resolveUserKey = (claims: unknown): string | null => {
  if (!claims || typeof claims !== 'object') {
    return null;
  }
  const record = claims as { sub?: unknown };
  return typeof record.sub === 'string' ? record.sub : null;
};

export const useAuthUserKey = () => {
  const { isAuthenticated, getIdTokenClaims } = useLogto();
  const [userKey, setUserKey] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadUserKey = async () => {
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
          setUserKey(null);
        }
      }
    };

    void loadUserKey();

    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated, getIdTokenClaims]);

  return userKey;
};
