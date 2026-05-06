import apiClient, { getApiBaseUrl } from './apiClient';

export type AgentApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

export type CreateAgentApiKeyResponse = {
  key: string;
  api_key: AgentApiKey;
};

export type AgentPluginConfig = {
  selected_template_id: string;
  polish_before_output: boolean;
  polish_level: string;
  force_one_page: boolean;
};

export const resolveAgentApiBaseUrl = () => {
  const base = getApiBaseUrl();
  if (typeof window === 'undefined') {
    return base || '';
  }
  if (!base) {
    return window.location.origin;
  }
  const normalizedBase = base.replace(/\/$/, '');
  if (normalizedBase.startsWith('/')) {
    return `${window.location.origin}${normalizedBase}`;
  }
  return normalizedBase;
};

export const agentService = {
  async getPluginConfig(): Promise<AgentPluginConfig> {
    const response = await apiClient.get<AgentPluginConfig>('/agent/config');
    return response.data;
  },

  async savePluginConfig(config: AgentPluginConfig): Promise<AgentPluginConfig> {
    const response = await apiClient.put<AgentPluginConfig>('/agent/config', config);
    return response.data;
  },

  async listApiKeys(): Promise<AgentApiKey[]> {
    const response = await apiClient.get<AgentApiKey[]>('/agent/api-keys');
    return response.data;
  },

  async createApiKey(name: string): Promise<CreateAgentApiKeyResponse> {
    const response = await apiClient.post<CreateAgentApiKeyResponse>('/agent/api-keys', { name });
    return response.data;
  },

  async revokeApiKey(id: string): Promise<void> {
    await apiClient.delete(`/agent/api-keys/${encodeURIComponent(id)}`);
  },
};
