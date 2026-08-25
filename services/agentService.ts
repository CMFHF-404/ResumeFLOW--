import apiClient, { getApiBaseUrl, type AuthOwnerOptions } from './apiClient';

export type AgentApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  key?: null;
  created_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

export type CreateAgentApiKeyResponse = {
  key: string;
  api_key: AgentApiKey;
};

type AgentApiKeyWire = Omit<AgentApiKey, 'key'> & {
  key?: string | null;
};

type CreateAgentApiKeyWireResponse = {
  key: string;
  api_key: AgentApiKeyWire;
};

export interface CreateAgentApiKeyOptions extends AuthOwnerOptions {
  expectedActiveKeyId?: string | null;
}

const stripNestedAgentApiKeySecret = ({
  key: _nestedSecret,
  ...apiKey
}: AgentApiKeyWire): AgentApiKey => apiKey;

export type AgentPluginConfig = {
  selected_template_id: string;
  polish_before_output: boolean;
  polish_level: string;
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
  async getPluginConfig(options?: AuthOwnerOptions): Promise<AgentPluginConfig> {
    const response = await apiClient.get<AgentPluginConfig>('/agent/config', options);
    return response.data;
  },

  async savePluginConfig(
    config: AgentPluginConfig,
    options?: AuthOwnerOptions,
  ): Promise<AgentPluginConfig> {
    const response = await apiClient.put<AgentPluginConfig>('/agent/config', config, options);
    return response.data;
  },

  async listApiKeys(options?: AuthOwnerOptions): Promise<AgentApiKey[]> {
    const response = await apiClient.get<AgentApiKeyWire[]>('/agent/api-keys', options);
    return response.data.map(stripNestedAgentApiKeySecret);
  },

  async createApiKey(
    name: string,
    rotate = false,
    options?: CreateAgentApiKeyOptions,
  ): Promise<CreateAgentApiKeyResponse> {
    const payload = {
      name,
      rotate,
      ...(options && Object.hasOwn(options, 'expectedActiveKeyId')
        ? { expected_active_key_id: options.expectedActiveKeyId ?? null }
        : {}),
    };
    const response = await apiClient.post<CreateAgentApiKeyWireResponse>(
      '/agent/api-keys',
      payload,
      options?.expectedAuthCacheKey
        ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
        : undefined,
    );
    return {
      key: response.data.key,
      api_key: stripNestedAgentApiKeySecret(response.data.api_key),
    };
  },

  async revokeApiKey(id: string, options?: AuthOwnerOptions): Promise<void> {
    await apiClient.delete(`/agent/api-keys/${encodeURIComponent(id)}`, options);
  },
};
