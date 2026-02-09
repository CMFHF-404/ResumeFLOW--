import apiClient from './apiClient';

export interface FeedbackPayload {
  category: string;
  content: string;
  contact?: string;
  context_json?: Record<string, any>;
}

export interface FeedbackResponse {
  id: string;
  created_at: string;
}

export const feedbackService = {
  async create(payload: FeedbackPayload) {
    const response = await apiClient.post<FeedbackResponse>('/feedback', payload);
    return response.data;
  },
};
