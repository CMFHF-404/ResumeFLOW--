import { useCallback, useEffect, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import { profileService, type Profile } from '../services/profileService';
import { syncResumeTemplatePresetsFromProfile } from '../views/resumeTemplateStorage';

const LOAD_PROFILE_ERROR_MESSAGE = '加载用户资料失败';

type UseProfileResult = {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
  refresh: (options?: { force?: boolean }) => Promise<Profile | null>;
};

export const useProfile = (): UseProfileResult => {
  const { isAuthenticated } = useLogto();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    if (!isAuthenticated) {
      applyState(() => {
        setProfile(null);
        setError(null);
      });
      return null;
    }

    applyState(() => {
      setIsLoading(true);
      setError(null);
    });
    try {
      const data = await profileService.getProfile(options);
      syncResumeTemplatePresetsFromProfile(data.extra_json, data.user_id);
      applyState(() => {
        setProfile(data);
      });
      return data;
    } catch (err) {
      console.error('[Profile] 加载用户资料失败:', err);
      applyState(() => {
        setError(LOAD_PROFILE_ERROR_MESSAGE);
      });
      return null;
    } finally {
      applyState(() => {
        setIsLoading(false);
      });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      hasRequestedRef.current = false;
      return;
    }
    if (hasRequestedRef.current) {
      return;
    }
    hasRequestedRef.current = true;
    void refresh();
  }, [isAuthenticated, refresh]);

  return {
    profile,
    isLoading,
    error,
    refresh,
  };
};
