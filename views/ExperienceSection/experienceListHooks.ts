import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { experienceService, type ExperienceListItem } from '../../services/experienceService';
import { mergeFormalAndLocalExperiences, sortExperiencesByStartDate } from './cardDataUtils';
import type { ExperienceSectionProps } from './types';
import type { AuthOwnerOperationGuard } from '../../hooks/useAuthOwnerOperationGuard';
import { isAuthContextChangedError } from '../../services/apiClient';

export const useExperienceList = (
  category: ExperienceSectionProps['category'],
  refreshSignal: number | undefined,
  isAuthenticated: boolean,
  authUserKey?: string | null,
  ownerGuard?: AuthOwnerOperationGuard,
) => {
  const initialExperiencesRef = useRef<ExperienceListItem[] | null>(
    isAuthenticated && authUserKey
      ? experienceService.peekList(category, { expectedAuthCacheKey: authUserKey })
      : null
  );
  const [experiences, setExperiences] = useState<ExperienceListItem[]>(
    () => initialExperiencesRef.current ?? []
  );
  const [isLoading, setIsLoading] = useState(() => isAuthenticated && !initialExperiencesRef.current);
  const [listOwnerKey, setListOwnerKey] = useState<string | null>(authUserKey ?? null);
  const refreshInFlightRef = useRef<{
    ownerKey: string;
    promise: Promise<ExperienceListItem[]>;
  } | null>(null);
  const hasLoadedRef = useRef(false);
  const renderedOwnerKeyRef = useRef<string | null>(authUserKey ?? null);

  const isOwnerResolved = isAuthenticated && !!authUserKey && authUserKey !== 'anonymous';
  const visibleExperiences = listOwnerKey === authUserKey ? experiences : [];
  const visibleIsLoading = isOwnerResolved && listOwnerKey !== authUserKey
    ? true
    : isLoading;

  const refreshExperiences = useCallback(async () => {
    if (!isOwnerResolved) {
      setExperiences([]);
      setIsLoading(false);
      return [];
    }
    if (!ownerGuard) {
      return [];
    }
    const operation = await ownerGuard.beginOperation();
    if (refreshInFlightRef.current?.ownerKey === operation.expectedAuthCacheKey) {
      return refreshInFlightRef.current.promise;
    }
    const promise = (async () => {
      const data = await experienceService.list(category, {
        force: true,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await ownerGuard.assertOperationCurrent(operation);
      setExperiences((prev) => mergeFormalAndLocalExperiences(data, prev));
      setListOwnerKey(operation.expectedAuthCacheKey);
      return data;
    })();
    const entry = { ownerKey: operation.expectedAuthCacheKey, promise };
    refreshInFlightRef.current = entry;
    try {
      return await promise;
    } finally {
      if (refreshInFlightRef.current === entry) {
        refreshInFlightRef.current = null;
      }
    }
  }, [category, isOwnerResolved, ownerGuard]);

  useEffect(() => {
    if (!isOwnerResolved) {
      hasLoadedRef.current = false;
      renderedOwnerKeyRef.current = null;
      initialExperiencesRef.current = null;
      setExperiences([]);
      setListOwnerKey(null);
      setIsLoading(false);
      return;
    }
    const expectedAuthCacheKey = authUserKey;
    let didTransitionOwner = false;
    if (renderedOwnerKeyRef.current !== expectedAuthCacheKey) {
      didTransitionOwner = true;
      renderedOwnerKeyRef.current = expectedAuthCacheKey;
      hasLoadedRef.current = false;
      initialExperiencesRef.current = experienceService.peekList(category, {
        expectedAuthCacheKey,
      });
      setExperiences(initialExperiencesRef.current ?? []);
      setListOwnerKey(expectedAuthCacheKey);
    }
    const loadExperiences = async () => {
      if (hasLoadedRef.current) {
        return;
      }
      try {
        if (!ownerGuard) {
          return;
        }
        const operation = await ownerGuard.beginOperation();
        if (!initialExperiencesRef.current?.length) {
          setIsLoading(true);
        }
        hasLoadedRef.current = true;
        const data = await experienceService.list(category, { expectedAuthCacheKey });
        await ownerGuard.assertOperationCurrent(operation);
        setExperiences((prev) => (
          didTransitionOwner ? data : mergeFormalAndLocalExperiences(data, prev)
        ));
        setListOwnerKey(expectedAuthCacheKey);
      } catch (error) {
        if (!isAuthContextChangedError(error)) {
          console.error(`[ExperienceSection] 加载${category}经历失败:`, error);
          hasLoadedRef.current = false;
        }
      } finally {
        if (ownerGuard?.authUserKey === expectedAuthCacheKey) {
          setIsLoading(false);
        }
      }
    };
    loadExperiences();
  }, [authUserKey, category, isOwnerResolved, ownerGuard]);

  useEffect(() => {
    if (!refreshSignal || !isAuthenticated) {
      return;
    }
    refreshExperiences().catch((error) => {
      console.error(`[ExperienceSection] 刷新${category}经历失败:`, error);
    });
  }, [category, isAuthenticated, refreshExperiences, refreshSignal]);

  return {
    experiences: visibleExperiences,
    setExperiences,
    isLoading: visibleIsLoading,
    refreshExperiences,
  };
};

export const useSortedExperiences = (experiences: ExperienceListItem[]) => {
  return useMemo(() => sortExperiencesByStartDate(experiences), [experiences]);
};
