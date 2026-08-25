import { useCallback, useEffect, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import { profileService, type Profile } from '../services/profileService';
import { syncResumeTemplatePresetsFromProfile } from '../services/resumeTemplateStorage';
import { useAuthUserKey } from './useAuthUserKey';
import { createProfileLoadGuard, type ProfileLoadRequest } from './profileLoadGuard';

const LOAD_PROFILE_ERROR_MESSAGE = '加载用户资料失败';

type UseProfileResult = {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
  refresh: (options?: { force?: boolean }) => Promise<Profile | null>;
};

type ProfileViewState = {
  ownerKey: string | null;
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
};

const createEmptyProfileViewState = (ownerKey: string | null): ProfileViewState => ({
  ownerKey,
  profile: null,
  isLoading: false,
  error: null,
});

export const useProfile = (): UseProfileResult => {
  const { isAuthenticated } = useLogto();
  const authUserKey = useAuthUserKey();
  const activeOwnerKey = isAuthenticated ? authUserKey : null;
  const [viewState, setViewState] = useState<ProfileViewState>(() => (
    createEmptyProfileViewState(null)
  ));
  const loadGuardRef = useRef(createProfileLoadGuard());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      loadGuardRef.current.invalidate();
    };
  }, []);

  const applyRequestState = useCallback((
    request: ProfileLoadRequest,
    updater: (current: ProfileViewState) => ProfileViewState,
  ) => {
    if (!isMountedRef.current || !loadGuardRef.current.isCurrent(request)) {
      return;
    }
    setViewState((current) => (
      current.ownerKey === request.ownerKey ? updater(current) : current
    ));
  }, []);

  const loadProfileForOwner = useCallback(async (
    requestedOwnerKey: string,
    options?: { force?: boolean },
  ) => {
    const request = loadGuardRef.current.beginRequest(requestedOwnerKey);
    if (!request || !isMountedRef.current) {
      return null;
    }

    setViewState((current) => (
      current.ownerKey === requestedOwnerKey
        ? { ...current, isLoading: true, error: null }
        : {
            ...createEmptyProfileViewState(requestedOwnerKey),
            isLoading: true,
          }
    ));
    try {
      const data = await profileService.getProfile({
        ...options,
        expectedAuthCacheKey: requestedOwnerKey,
      });
      if (!isMountedRef.current || !loadGuardRef.current.isCurrent(request)) {
        return null;
      }
      syncResumeTemplatePresetsFromProfile(data.extra_json, data.user_id);
      applyRequestState(request, (current) => ({
        ...current,
        profile: data,
      }));
      return data;
    } catch (err) {
      if (!isMountedRef.current || !loadGuardRef.current.isCurrent(request)) {
        return null;
      }
      console.error('[Profile] 加载用户资料失败:', err);
      applyRequestState(request, (current) => ({
        ...current,
        error: LOAD_PROFILE_ERROR_MESSAGE,
      }));
      return null;
    } finally {
      applyRequestState(request, (current) => ({
        ...current,
        isLoading: false,
      }));
    }
  }, [applyRequestState]);

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    if (!activeOwnerKey) {
      loadGuardRef.current.transitionOwner(null);
      if (isMountedRef.current) {
        setViewState(createEmptyProfileViewState(null));
      }
      return null;
    }
    return loadProfileForOwner(activeOwnerKey, options);
  }, [activeOwnerKey, loadProfileForOwner]);

  useEffect(() => {
    loadGuardRef.current.transitionOwner(activeOwnerKey);
    setViewState(createEmptyProfileViewState(activeOwnerKey));
    if (!activeOwnerKey) {
      return;
    }
    void loadProfileForOwner(activeOwnerKey);
  }, [activeOwnerKey, loadProfileForOwner]);

  const isViewStateCurrent = Boolean(
    activeOwnerKey && viewState.ownerKey === activeOwnerKey
  );

  return {
    profile: isViewStateCurrent ? viewState.profile : null,
    isLoading: isViewStateCurrent ? viewState.isLoading : false,
    error: isViewStateCurrent ? viewState.error : null,
    refresh,
  };
};
