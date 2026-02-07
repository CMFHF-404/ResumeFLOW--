import { useCallback, useEffect, useRef, useState } from 'react';
import { analyticsService } from '../services/analyticsService';

type UseAdminResult = {
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<boolean>;
};

const LOAD_ADMIN_ERROR = '权限校验失败';

export const useAdmin = (): UseAdminResult => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasRequestedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyState = (updater: () => void) => {
    if (isMountedRef.current) {
      updater();
    }
  };

  const refresh = useCallback(async () => {
    applyState(() => {
      setLoading(true);
      setError(null);
    });
    try {
      const result = await analyticsService.checkAdminPermission();
      applyState(() => {
        setIsAdmin(Boolean(result.is_admin));
      });
      return Boolean(result.is_admin);
    } catch (err) {
      console.error('[useAdmin] 权限校验失败:', err);
      applyState(() => {
        setError(LOAD_ADMIN_ERROR);
      });
      return false;
    } finally {
      applyState(() => {
        setLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    if (hasRequestedRef.current) {
      return;
    }
    hasRequestedRef.current = true;
    void refresh();
  }, [refresh]);

  return {
    isAdmin,
    loading,
    error,
    refresh,
  };
};
