import type React from 'react';
import type { ExperienceListItem } from '../../services/experienceService';
import type { ExperienceCardData, StarFieldKey } from '../ExperienceCard';
import { convertDateToISO, parseYearMonthValue } from '../experienceUtils';
import { stripRichTextToText } from '../../utils/richText';
import type { ExperienceDraftRecord } from '../../services/experienceDraftService';

export const isTempId = (id: string) => id.startsWith('temp_');
export const isDraftId = (id: string) => id.startsWith('draft_');
export const isLocalExperienceId = (id: string) => isTempId(id) || isDraftId(id);

export const mergeFormalAndLocalExperiences = (
  formalItems: ExperienceListItem[],
  currentItems: ExperienceListItem[]
) => {
  const formalIds = new Set(formalItems.map((item) => item.master.id));
  const localItems = currentItems.filter(
    (item) => isLocalExperienceId(item.master.id) && !formalIds.has(item.master.id)
  );
  return localItems.length ? [...localItems, ...formalItems] : formalItems;
};

export const sortExperiencesByStartDate = (experiences: ExperienceListItem[]) => {
  return [...experiences].sort((a, b) => {
    const dateA = a.latest_version?.start_date;
    const dateB = b.latest_version?.start_date;
    const valA = parseYearMonthValue(dateA) ?? -1;
    const valB = parseYearMonthValue(dateB) ?? -1;
    return valB - valA;
  });
};

export const buildExperienceCardData = (item: ExperienceListItem): ExperienceCardData => {
  const star = item.latest_version?.star || {};
  return {
    org: item.latest_version?.org || '',
    title: item.latest_version?.title || '',
    start_date: item.latest_version?.start_date || '',
    end_date: item.latest_version?.end_date || '',
    star: {
      s: star.s || '',
      t: star.t || '',
      a: star.a || '',
      r: star.r || '',
    },
    editMode: 'expert',
    simpleText: '',
    draftStatus: 'idle',
  };
};

export const createEmptyCardData = (): ExperienceCardData => ({
  org: '',
  title: '',
  start_date: '',
  end_date: '',
  star: { s: '', t: '', a: '', r: '' },
  editMode: 'expert',
  simpleText: '',
  draftStatus: 'idle',
});

export const cloneExperienceCardData = (data: ExperienceCardData) => JSON.parse(JSON.stringify(data));

export const resolveExperienceCardData = (
  cardId: string,
  experiences: ExperienceListItem[],
  seedData?: ExperienceCardData
): ExperienceCardData | null => {
  if (seedData) {
    return seedData;
  }
  const item = experiences.find((exp) => exp.master.id === cardId);
  return item ? buildExperienceCardData(item) : null;
};

export const getStarFieldValue = (data: ExperienceCardData, field: StarFieldKey): string => {
  const value = data?.star?.[field];
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

export const buildStarFieldState = (data: ExperienceCardData): Record<StarFieldKey, string> => ({
  s: getStarFieldValue(data, 's'),
  t: getStarFieldValue(data, 't'),
  a: getStarFieldValue(data, 'a'),
  r: getStarFieldValue(data, 'r'),
});

export const STAR_FIELD_KEYS: StarFieldKey[] = ['s', 't', 'a', 'r'];

export const buildStarPolishPayload = (data: ExperienceCardData) => {
  const starPayload: Record<StarFieldKey, string> = {
    s: stripRichTextToText(getStarFieldValue(data, 's')),
    t: stripRichTextToText(getStarFieldValue(data, 't')),
    a: stripRichTextToText(getStarFieldValue(data, 'a')),
    r: stripRichTextToText(getStarFieldValue(data, 'r')),
  };
  const hasContent = STAR_FIELD_KEYS.some((key) => starPayload[key].trim());
  return {
    content: {
      company: data?.org || '',
      role: data?.title || '',
      ...starPayload,
    },
    hasContent,
  };
};

export const buildVersionPayload = (data: ExperienceCardData) => ({
  title: data.title,
  org: data.org || undefined,
  start_date: convertDateToISO(data.start_date),
  end_date: convertDateToISO(data.end_date),
  star: data.star || {},
});

export const buildDraftCardData = (draft: ExperienceDraftRecord): ExperienceCardData => ({
  ...createEmptyCardData(),
  ...(draft.card_data || {}),
  star: {
    s: draft.card_data?.star?.s || '',
    t: draft.card_data?.star?.t || '',
    a: draft.card_data?.star?.a || '',
    r: draft.card_data?.star?.r || '',
  },
  editMode: draft.mode || 'simple',
  simpleText: draft.simple_text || '',
  draftId: draft.id,
  clientDraftKey: draft.client_draft_key,
  draftStatus: 'saved',
});

export const applyOptimisticSave = (
  cardId: string,
  data: ExperienceCardData,
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>,
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>
) => {
  setOriginalCardData((prev) => new Map(prev).set(cardId, cloneExperienceCardData(data)));
  setModifiedCards((prev) => {
    const next = new Set(prev);
    next.delete(cardId);
    return next;
  });
  setExperiences((prev) =>
    prev.map((item) => {
      if (item.master.id !== cardId) {
        return item;
      }
      return {
        ...item,
        latest_version: {
          ...(item.latest_version || {}),
          title: data.title,
          org: data.org,
          start_date: convertDateToISO(data.start_date),
          end_date: convertDateToISO(data.end_date),
          star: data.star,
        } as any,
      };
    })
  );
};

export const syncCardFromRefresh = (
  cardId: string,
  list: ExperienceListItem[],
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>,
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>
) => {
  const updatedItem = list.find((item) => item.master.id === cardId);
  if (!updatedItem) {
    return;
  }
  const freshData = buildExperienceCardData(updatedItem);
  setModifiedCards((currentModified) => {
    if (!currentModified.has(cardId)) {
      setCardData((prev) => new Map(prev).set(cardId, freshData));
      setOriginalCardData((prev) => new Map(prev).set(cardId, cloneExperienceCardData(freshData)));
    }
    return currentModified;
  });
};
