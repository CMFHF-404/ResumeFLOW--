import apiClient from './apiClient';
import type { ExperienceCategory } from './experienceService';
import type { ExperienceCardData } from '../views/ExperienceCard';

export type ExperienceDraftMode = 'simple' | 'expert';

export type ExperienceDraftPayload = {
  category: Extract<ExperienceCategory, 'work' | 'project'>;
  clientDraftKey: string;
  mode: ExperienceDraftMode;
  simpleText: string;
  cardData: ExperienceCardData;
  targetMasterId?: string | null;
};

export type ExperienceDraftRecord = {
  id: string;
  category: Extract<ExperienceCategory, 'work' | 'project'>;
  client_draft_key: string;
  mode: ExperienceDraftMode;
  simple_text: string;
  card_data: ExperienceCardData;
  target_master_id?: string | null;
  updated_at: string;
};

const toApiPayload = (payload: ExperienceDraftPayload) => ({
  category: payload.category,
  client_draft_key: payload.clientDraftKey,
  mode: payload.mode,
  simple_text: payload.simpleText,
  card_data: payload.cardData,
  target_master_id: payload.targetMasterId ?? null,
});

export const experienceDraftService = {
  async list(category: Extract<ExperienceCategory, 'work' | 'project'>) {
    const response = await apiClient.get<ExperienceDraftRecord[]>('/api/experience-drafts', {
      params: { category },
    });
    return response.data;
  },

  async upsert(payload: ExperienceDraftPayload) {
    const response = await apiClient.post<ExperienceDraftRecord>(
      '/api/experience-drafts',
      toApiPayload(payload)
    );
    return response.data;
  },

  async delete(id: string) {
    await apiClient.delete(`/api/experience-drafts/${id}`);
  },
};
