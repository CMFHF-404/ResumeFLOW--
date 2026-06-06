import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { AssistantDraftGroup } from './sessionUtils';

export type DraftSurface = 'desktop' | 'mobile';

export type DraftPanelVersionState = {
  versionByGroupId: Record<string, number>;
  setVersionByGroupId: Dispatch<SetStateAction<Record<string, number>>>;
};

export const useAssistantDraftPanelState = (
  draftGroups: AssistantDraftGroup[],
  selectedSessionId: string | null,
) => {
  const [isDraftPanelOpen, setIsDraftPanelOpen] = useState(true);
  const [isMobileDraftTrayOpen, setIsMobileDraftTrayOpen] = useState(false);
  const [desktopDraftVersionByGroupId, setDesktopDraftVersionByGroupId] = useState<Record<string, number>>({});
  const [mobileDraftVersionByGroupId, setMobileDraftVersionByGroupId] = useState<Record<string, number>>({});
  const [draftExpandedByGroupId, setDraftExpandedByGroupId] = useState<Record<string, boolean>>({});
  const previousDraftCountRef = useRef(0);
  const autoOpenedDraftSessionIdsRef = useRef<Set<string>>(new Set());

  const draftCardCount = draftGroups.length;

  useEffect(() => {
    const previousDraftCount = previousDraftCountRef.current;
    const draftSessionKey = selectedSessionId ?? '__pending__';
    const hasAutoOpened = autoOpenedDraftSessionIdsRef.current.has(draftSessionKey);
    if (draftCardCount === 1 && previousDraftCount === 0 && !hasAutoOpened) {
      setIsDraftPanelOpen(true);
      setIsMobileDraftTrayOpen(true);
      autoOpenedDraftSessionIdsRef.current.add(draftSessionKey);
    }
    previousDraftCountRef.current = draftCardCount;
  }, [draftCardCount, selectedSessionId]);

  useEffect(() => {
    const groupIds = new Set(draftGroups.map((group) => group.id));
    const syncVersionState = (current: Record<string, number>) => {
      let hasChange = false;
      const next: Record<string, number> = {};
      draftGroups.forEach((group) => {
        const fallbackIndex = group.items.length - 1;
        next[group.id] = fallbackIndex;
        if (current[group.id] !== fallbackIndex) {
          hasChange = true;
        }
      });
      Object.keys(current).forEach((id) => {
        if (!groupIds.has(id)) {
          hasChange = true;
        }
      });
      return hasChange ? next : current;
    };

    setDesktopDraftVersionByGroupId(syncVersionState);
    setMobileDraftVersionByGroupId(syncVersionState);
    setDraftExpandedByGroupId((current) => {
      let hasChange = false;
      const next: Record<string, boolean> = {};
      Object.entries(current).forEach(([id, expanded]) => {
        if (groupIds.has(id)) {
          next[id] = expanded;
        } else {
          hasChange = true;
        }
      });
      return hasChange ? next : current;
    });
  }, [draftGroups]);

  const getDraftVersionState = (surface: DraftSurface) => (
    surface === 'mobile'
      ? {
        versionByGroupId: mobileDraftVersionByGroupId,
        setVersionByGroupId: setMobileDraftVersionByGroupId,
      }
      : {
        versionByGroupId: desktopDraftVersionByGroupId,
        setVersionByGroupId: setDesktopDraftVersionByGroupId,
      }
  );

  return {
    draftCardCount,
    isDraftPanelOpen,
    setIsDraftPanelOpen,
    isMobileDraftTrayOpen,
    setIsMobileDraftTrayOpen,
    draftExpandedByGroupId,
    setDraftExpandedByGroupId,
    getDraftVersionState,
  };
};
