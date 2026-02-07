import apiClient from './apiClient';

export type FunnelStep = {
  name: string;
  event: string;
  count: number;
  conversion_rate: number;
  dropoff_rate: number;
};

export type FunnelData = {
  updated_at: string;
  steps: FunnelStep[];
};

export type AIQualityData = {
  updated_at: string;
  polish_actions: Array<{ action: string; count: number }>;
  match_score_distribution: Array<{ range: string; count: number }>;
  latency_series: Array<{ date: string; p50: number; p95: number; p99: number }>;
};

export type EditorUXData = {
  updated_at: string;
  layout_modes: Array<{ mode: string; count: number }>;
  smart_one_page_series: Array<{ date: string; count: number }>;
  module_reorder_heatmap: {
    modules: string[];
    positions: string[];
    values: Array<[number, number, number]>;
  };
};

export const analyticsService = {
  async getFunnelData() {
    const response = await apiClient.get<FunnelData>('/analytics/funnel');
    return response.data;
  },

  async getAIQualityData() {
    const response = await apiClient.get<AIQualityData>('/analytics/ai-quality');
    return response.data;
  },

  async getEditorUXData() {
    const response = await apiClient.get<EditorUXData>('/analytics/editor-ux');
    return response.data;
  },

  async checkAdminPermission() {
    const response = await apiClient.get<{ is_admin: boolean }>('/analytics/check-admin');
    return response.data;
  },
};
