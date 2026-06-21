import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { experienceService, type ExperienceListItem } from '../../services/experienceService';
import { runDedupedRefresh } from '../experienceUtils';
import { mergeFormalAndLocalExperiences, sortExperiencesByStartDate } from './cardDataUtils';
import type { ExperienceSectionProps } from './types';

export const useExperienceList = (
  category: ExperienceSectionProps['category'],
  refreshSignal: number | undefined,
  isAuthenticated: boolean
) => {
  const initialExperiencesRef = useRef<ExperienceListItem[] | null>(
    isAuthenticated ? experienceService.peekList(category) : null
  );
  const [experiences, setExperiences] = useState<ExperienceListItem[]>(
    () => initialExperiencesRef.current ?? []
  );
  const [isLoading, setIsLoading] = useState(() => isAuthenticated && !initialExperiencesRef.current);
  const refreshInFlightRef = useRef<Promise<ExperienceListItem[]> | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshExperiences = useCallback(async () => {
    if (!isAuthenticated) {
      setExperiences([]);
      setIsLoading(false);
      return [];
    }
    return runDedupedRefresh(refreshInFlightRef, async () => {
      const data = await experienceService.list(category, { force: true });
      setExperiences((prev) => mergeFormalAndLocalExperiences(data, prev));
      return data;
    });
  }, [category, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      hasLoadedRef.current = false;
      initialExperiencesRef.current = null;
      setExperiences([]);
      setIsLoading(false);
      return;
    }
    const loadExperiences = async () => {
      if (hasLoadedRef.current) {
        return;
      }
      try {
        if (!initialExperiencesRef.current?.length) {
          setIsLoading(true);
        }
        hasLoadedRef.current = true;
        const data = await experienceService.list(category);
        setExperiences((prev) => mergeFormalAndLocalExperiences(data, prev));
      } catch (error) {
        console.error(`[ExperienceSection] 加载${category}经历失败:`, error);
        hasLoadedRef.current = false;
      } finally {
        setIsLoading(false);
      }
    };
    loadExperiences();
  }, [category, isAuthenticated]);

  useEffect(() => {
    if (!refreshSignal || !isAuthenticated) {
      return;
    }
    refreshExperiences().catch((error) => {
      console.error(`[ExperienceSection] 刷新${category}经历失败:`, error);
    });
  }, [category, isAuthenticated, refreshExperiences, refreshSignal]);

  return { experiences, setExperiences, isLoading, refreshExperiences };
};

export const useSortedExperiences = (experiences: ExperienceListItem[]) => {
  return useMemo(() => sortExperiencesByStartDate(experiences), [experiences]);
};
