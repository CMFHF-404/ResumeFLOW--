import React from 'react';
import { agentService, resolveAgentApiBaseUrl, type AgentApiKey, type AgentPluginConfig as ServerAgentPluginConfig } from '../services/agentService';
import {
  DEFAULT_RESUME_TEMPLATE_ID,
  RESUME_TEMPLATE_DEFINITIONS,
  resolveDefaultResumeThemeColorPresetId,
  type ResumeThemeColorPresetId,
  type ResumeTemplateId,
} from '../constants/resumeTemplates';
import { useAuthUserKey } from '../hooks/useAuthUserKey';
import {
  DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
  DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
} from '../utils/resumeCustomization';
import TemplateSelectorModal, { TemplateThumbnail } from '../views/ResumeEditor/components/TemplateSelectorModal';
import { DEFAULT_SECTION_ORDER } from '../views/ResumeEditor/constants';
import {
  loadResumeTemplatePresetMap,
  saveResumeTemplatePreset,
  type ResumeTemplatePresetMap,
} from '../views/resumeTemplateStorage';
import type { ResumeExperienceListMarkerStyle } from '../types/resume';

type TabKey = 'template' | 'polish';

type PolishLevel = '保守' | '标准' | '增强' | '强匹配';

export interface AgentApiPluginConfig {
  selectedTemplateId: ResumeTemplateId;
  polishBeforeOutput: boolean;
  polishLevel: PolishLevel;
}

interface AgentApiPluginConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'resumeflow.agentPluginConfig';

const DEFAULT_CONFIG: AgentApiPluginConfig = {
  selectedTemplateId: DEFAULT_RESUME_TEMPLATE_ID,
  polishBeforeOutput: true,
  polishLevel: '标准',
};

const loadConfig = (): AgentApiPluginConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AgentApiPluginConfig>;
    return {
      polishBeforeOutput: typeof parsed.polishBeforeOutput === 'boolean'
        ? parsed.polishBeforeOutput
        : DEFAULT_CONFIG.polishBeforeOutput,
      polishLevel: ['保守', '标准', '增强', '强匹配'].includes(String(parsed.polishLevel))
        ? parsed.polishLevel as PolishLevel
        : DEFAULT_CONFIG.polishLevel,
      selectedTemplateId: RESUME_TEMPLATE_DEFINITIONS.some((item) => item.id === parsed.selectedTemplateId)
        ? parsed.selectedTemplateId as ResumeTemplateId
        : DEFAULT_RESUME_TEMPLATE_ID,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

const persistConfig = (config: AgentApiPluginConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

const toServerConfig = (config: AgentApiPluginConfig): ServerAgentPluginConfig => ({
  selected_template_id: config.selectedTemplateId,
  polish_before_output: config.polishBeforeOutput,
  polish_level: config.polishLevel,
});

const fromServerConfig = (config: ServerAgentPluginConfig): AgentApiPluginConfig => ({
  selectedTemplateId: RESUME_TEMPLATE_DEFINITIONS.some((item) => item.id === config.selected_template_id)
    ? config.selected_template_id as ResumeTemplateId
    : DEFAULT_RESUME_TEMPLATE_ID,
  polishBeforeOutput: config.polish_before_output,
  polishLevel: ['保守', '标准', '增强', '强匹配'].includes(config.polish_level)
    ? config.polish_level as PolishLevel
    : DEFAULT_CONFIG.polishLevel,
});

const maskApiKey = (key: string) => {
  if (!key) return '未生成';
  if (key.length <= 18) return `${key.slice(0, 6)}...`;
  return `${key.slice(0, 14)}...${key.slice(-4)}`;
};

const resolveDisplayApiKey = (revealedKey: string, apiKeys: AgentApiKey[]) => {
  if (revealedKey) return maskApiKey(revealedKey);
  const activeKey = apiKeys.find((key) => !key.revoked_at);
  return activeKey ? `${activeKey.key_prefix}...` : '未生成';
};

const getAgentSkillBundleUrl = () => `${resolveAgentApiBaseUrl()}/agent/v1/skills/resumeflow-job-search`;

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Continue to the DOM fallback below for embedded browsers with blocked clipboard permission.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('clipboard_unavailable');
  }
};

const buildAgentInstruction = (displayApiKey: string) => {
  const apiBaseUrl = resolveAgentApiBaseUrl();
  const skillBundleUrl = getAgentSkillBundleUrl();
  return [
    '请安装并使用 ResumeFLOW 求职 SKILL 集。',
    `获取地址：GET ${skillBundleUrl}`,
    '鉴权：Authorization: Bearer <API Key>',
    `ResumeFLOW API Base：${apiBaseUrl}`,
    `API Key：${displayApiKey}`,
    '安装后请按 SKILL.md 与 references/api.md 执行求职筛选、分析、生成和归档流程。',
  ].join('\n');
};

const AgentApiPluginConfigModal: React.FC<AgentApiPluginConfigModalProps> = ({ isOpen, onClose }) => {
  const authUserKey = useAuthUserKey();
  const [activeTab, setActiveTab] = React.useState<TabKey>('template');
  const [config, setConfig] = React.useState<AgentApiPluginConfig>(DEFAULT_CONFIG);
  const [tip, setTip] = React.useState('');
  const [apiKeys, setApiKeys] = React.useState<AgentApiKey[]>([]);
  const [newKeyName, setNewKeyName] = React.useState('Agent');
  const [revealedKey, setRevealedKey] = React.useState('');
  const [isMutatingKey, setIsMutatingKey] = React.useState(false);
  const [templatePresetMap, setTemplatePresetMap] = React.useState<ResumeTemplatePresetMap>({});
  const [customizingTemplateId, setCustomizingTemplateId] = React.useState<ResumeTemplateId | null>(null);
  const latestConfigRef = React.useRef<AgentApiPluginConfig>(DEFAULT_CONFIG);
  const hasLoadedServerConfigRef = React.useRef(false);
  const hasPendingLocalChangeRef = React.useRef(false);
  const configSaveTimerRef = React.useRef<number | null>(null);
  const configSaveVersionRef = React.useRef(0);
  const displayApiKey = React.useMemo(
    () => resolveDisplayApiKey(revealedKey, apiKeys),
    [apiKeys, revealedKey]
  );
  const agentInstruction = React.useMemo(
    () => buildAgentInstruction(displayApiKey),
    [displayApiKey]
  );

  const clearScheduledConfigSave = React.useCallback(() => {
    if (configSaveTimerRef.current === null) return;
    window.clearTimeout(configSaveTimerRef.current);
    configSaveTimerRef.current = null;
  }, []);

  const saveConfig = React.useCallback(async (
    showTip = true,
    configToSave: AgentApiPluginConfig = latestConfigRef.current
  ) => {
    const normalized = {
      ...configToSave,
      selectedTemplateId: configToSave.selectedTemplateId || DEFAULT_RESUME_TEMPLATE_ID,
    };
    const saveVersion = ++configSaveVersionRef.current;
    latestConfigRef.current = normalized;
    persistConfig(normalized);
    setConfig(normalized);
    try {
      const saved = await agentService.savePluginConfig(toServerConfig(normalized));
      if (saveVersion !== configSaveVersionRef.current) {
        return true;
      }
      const next = fromServerConfig(saved);
      latestConfigRef.current = next;
      hasPendingLocalChangeRef.current = false;
      persistConfig(next);
      setConfig(next);
      if (showTip) {
        setTip('配置已保存到服务端');
      }
      return true;
    } catch (error) {
      if (saveVersion === configSaveVersionRef.current) {
        setTip(error instanceof Error ? error.message : '服务端配置保存失败');
      }
      return false;
    }
  }, []);

  const scheduleConfigSave = React.useCallback((next: AgentApiPluginConfig) => {
    clearScheduledConfigSave();
    configSaveTimerRef.current = window.setTimeout(() => {
      configSaveTimerRef.current = null;
      void saveConfig(false, next);
    }, 450);
  }, [clearScheduledConfigSave, saveConfig]);

  React.useEffect(() => {
    if (!isOpen) return;
    const localConfig = loadConfig();
    latestConfigRef.current = localConfig;
    hasLoadedServerConfigRef.current = false;
    hasPendingLocalChangeRef.current = false;
    clearScheduledConfigSave();
    setConfig(localConfig);
    setActiveTab('template');
    setTip('');
    setRevealedKey('');
    setNewKeyName('Agent');
    setTemplatePresetMap(loadResumeTemplatePresetMap(authUserKey));
    setCustomizingTemplateId(null);
  }, [authUserKey, clearScheduledConfigSave, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    void (async () => {
      try {
        const serverConfig = await agentService.getPluginConfig();
        if (isCancelled) return;
        const normalized = fromServerConfig(serverConfig);
        hasLoadedServerConfigRef.current = true;
        if (hasPendingLocalChangeRef.current) {
          scheduleConfigSave(latestConfigRef.current);
          return;
        }
        latestConfigRef.current = normalized;
        persistConfig(normalized);
        setConfig(normalized);
      } catch (error) {
        if (isCancelled) return;
        hasLoadedServerConfigRef.current = true;
        if (hasPendingLocalChangeRef.current) {
          scheduleConfigSave(latestConfigRef.current);
        }
        setTip(error instanceof Error ? error.message : '服务端配置加载失败，已使用本地配置');
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, scheduleConfigSave]);

  React.useEffect(() => {
    if (isOpen) return;
    clearScheduledConfigSave();
  }, [clearScheduledConfigSave, isOpen]);

  React.useEffect(() => () => {
    clearScheduledConfigSave();
  }, [clearScheduledConfigSave]);

  const loadApiKeys = React.useCallback(async () => {
    if (!isOpen) return;
    try {
      const keys = await agentService.listApiKeys();
      setApiKeys(keys);
    } catch (error) {
      setTip(error instanceof Error ? error.message : 'API Key 加载失败');
    }
  }, [isOpen]);

  React.useEffect(() => {
    void loadApiKeys();
  }, [loadApiKeys]);

  if (!isOpen) return null;

  const updateConfig = (patch: Partial<AgentApiPluginConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      configSaveVersionRef.current += 1;
      latestConfigRef.current = next;
      hasPendingLocalChangeRef.current = true;
      persistConfig(next);
      if (hasLoadedServerConfigRef.current) {
        scheduleConfigSave(next);
      }
      return next;
    });
  };

  const createAndActivateApiKey = async (revokeExisting = true) => {
    const activeKeys = apiKeys.filter((key) => !key.revoked_at);
    const result = await agentService.createApiKey(newKeyName.trim() || 'Agent');
    const revokedAt = new Date().toISOString();
    setRevealedKey(result.key);
    setApiKeys((current) => [
      result.api_key,
      ...current.filter((key) => key.id !== result.api_key.id),
    ]);
    if (!revokeExisting) {
      return { key: result.key, failedRevokeCount: 0 };
    }
    const revokeResults = await Promise.allSettled(
      activeKeys.map((key) => agentService.revokeApiKey(key.id))
    );
    const revokedKeyIds = new Set(
      activeKeys
        .filter((_key, index) => revokeResults[index]?.status === 'fulfilled')
        .map((key) => key.id)
    );
    setApiKeys((current) => current.map((key) => (
      revokedKeyIds.has(key.id) && !key.revoked_at ? { ...key, revoked_at: revokedAt } : key
    )));
    const failedRevokeCount = revokeResults.filter((item) => item.status === 'rejected').length;
    return { key: result.key, failedRevokeCount };
  };

  const copyInstruction = async () => {
    setIsMutatingKey(true);
    setTip('');
    try {
      let fullKey = revealedKey;
      let failedRevokeCount = 0;
      if (!fullKey) {
        const created = await createAndActivateApiKey(false);
        fullKey = created.key;
        failedRevokeCount = created.failedRevokeCount;
      }
      const isSaved = await saveConfig(false, latestConfigRef.current);
      if (!isSaved) {
        return;
      }
      await copyTextToClipboard(buildAgentInstruction(fullKey));
      setTip(
        failedRevokeCount > 0
          ? '已复制完整指令；新 API Key 仅本次显示，部分旧 Key 撤销失败'
          : '已复制完整指令，可直接发送给你的 Agent'
      );
    } catch (error) {
      setTip(error instanceof Error && error.message === 'clipboard_unavailable'
        ? '剪贴板不可用，请手动选中指令复制'
        : error instanceof Error ? error.message : '复制指令失败');
    } finally {
      setIsMutatingKey(false);
    }
  };

  const refreshApiKey = async () => {
    setIsMutatingKey(true);
    setTip('');
    try {
      const { failedRevokeCount } = await createAndActivateApiKey();
      setTip(
        failedRevokeCount > 0
          ? '新 API Key 已生成并显示，部分旧 Key 撤销失败，可稍后重试'
          : 'API Key 已刷新，仅本次显示'
      );
    } catch (error) {
      setTip(error instanceof Error ? error.message : 'API Key 刷新失败');
    } finally {
      setIsMutatingKey(false);
    }
  };

  const copyRevealedKey = async () => {
    if (!revealedKey) return;
    try {
      await copyTextToClipboard(revealedKey);
      setTip('API Key 已复制');
    } catch {
      setTip('剪贴板不可用，请手动选中 API Key 复制');
    }
  };

  const handleSaveTemplatePreset = async (preset: {
    templateId: ResumeTemplateId;
    sectionOrder: string[];
    themeColorPresetId: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
  }) => {
    const savedPreset = await saveResumeTemplatePreset(preset);
    setTemplatePresetMap((prev) => ({
      ...prev,
      [savedPreset.templateId]: savedPreset,
    }));
    setTip('模板自定义已保存');
  };

  const closeWithSave = () => {
    clearScheduledConfigSave();
    void saveConfig(false, latestConfigRef.current);
    onClose();
  };

  const tabButtonClass = (tab: TabKey) => `rounded-xl px-4 py-2 text-sm font-medium transition ${activeTab === tab ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'}`;
  const selectedPreset = templatePresetMap[config.selectedTemplateId];
  const selectedThemeColorPresetId = selectedPreset?.themeColorPresetId
    ?? resolveDefaultResumeThemeColorPresetId(config.selectedTemplateId);

  return (
    <>
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={closeWithSave}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/60" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Agent API 插件配置</h2>
            <p className="mt-1 text-xs text-slate-400">用于让外部 Agent 获取 JD 后调用 ResumeFLOW 生成岗位简历。</p>
          </div>
          <button className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white" onClick={closeWithSave} type="button">关闭</button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">发送给通用 Agent 的指令</div>
                <div className="mt-1 text-xs text-slate-400">包含服务端 SKILL 集获取接口、API 地址和部分打码的 API Key。</div>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50" disabled={isMutatingKey} onClick={copyInstruction} type="button">复制指令</button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50" disabled={isMutatingKey} onClick={refreshApiKey} type="button">刷新 API Key</button>
              </div>
            </div>
            <textarea className="h-40 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-primary" readOnly value={agentInstruction} />
            {revealedKey ? (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="mb-2 text-xs font-medium text-amber-200">完整 API Key 仅本次显示，请复制给 Agent 后妥善保存。</div>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100" readOnly value={revealedKey} />
                  <button className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950" onClick={copyRevealedKey} type="button">复制 Key</button>
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-amber-300">提示：平台只基于已有真实经历改写，不会新增不存在的公司、项目、奖项、证书或学历。</p>
          </div>

          <div className="mt-4 flex gap-2">
            <button className={tabButtonClass('template')} onClick={() => setActiveTab('template')} type="button">简历模板</button>
            <button className={tabButtonClass('polish')} onClick={() => setActiveTab('polish')} type="button">润色设置</button>
          </div>

          <div className="mt-4 min-h-[150px] rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
            {activeTab === 'template' ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {RESUME_TEMPLATE_DEFINITIONS.map((template) => {
                  const isSelected = config.selectedTemplateId === template.id;
                  const hasCustomPreset = Boolean(templatePresetMap[template.id]);
                  return (
                    <article
                      key={template.id}
                      className={`rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                          : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
                      }`}
                    >
                      <div className="relative mb-3 h-28 overflow-hidden rounded-lg bg-white">
                        <TemplateThumbnail
                          templateId={template.id}
                          themeColorPresetId={
                            templatePresetMap[template.id]?.themeColorPresetId
                              ?? resolveDefaultResumeThemeColorPresetId(template.id)
                          }
                        />
                        <button
                          className="absolute right-2 top-2 rounded-md border border-white/80 bg-white/95 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-white"
                          onClick={() => setCustomizingTemplateId(template.id)}
                          type="button"
                        >
                          自定义
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-100">{template.name}</div>
                          <div className="mt-1 line-clamp-2 text-xs text-slate-400">{template.description}</div>
                        </div>
                        {hasCustomPreset ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">已自定义</span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-500">{template.hasAvatar ? '支持头像' : '无头像模板'}</div>
                        <button
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            isSelected
                              ? 'bg-primary text-white'
                              : 'border border-slate-600 text-slate-200 hover:bg-slate-800'
                          }`}
                          onClick={() => updateConfig({ selectedTemplateId: template.id })}
                          type="button"
                        >
                          {isSelected ? '已选中' : '选择'}
                        </button>
                      </div>
                    </article>
                  );
                })}
                <p className="text-xs text-slate-400 sm:col-span-2">模板列表与简历工厂同步；Agent 生成时会使用这里选择的模板。</p>
              </div>
            ) : null}

            {activeTab === 'polish' ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <span>
                    <span className="block text-sm font-medium text-slate-100">输出前 AI 润色</span>
                    <span className="text-xs text-slate-400">根据 JD 调整表达强度</span>
                  </span>
                  <input className="h-5 w-5 rounded border-slate-600 bg-slate-800 text-primary" type="checkbox" checked={config.polishBeforeOutput} onChange={(e) => updateConfig({ polishBeforeOutput: e.target.checked })} />
                </label>
                <label className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <span className="mb-2 block text-xs font-medium text-slate-400">润色档位</span>
                  <select className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100" value={config.polishLevel} onChange={(e) => updateConfig({ polishLevel: e.target.value as PolishLevel })}>
                    <option value="保守">保守</option>
                    <option value="标准">标准</option>
                    <option value="增强">增强</option>
                    <option value="强匹配">强匹配</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>
          {tip ? <div className="mt-4 text-sm font-medium text-emerald-300">{tip}</div> : null}
        </div>
      </div>
    </div>
    <TemplateSelectorModal
      isOpen={customizingTemplateId !== null}
      selectedTemplateId={config.selectedTemplateId}
      themeColorPresetId={selectedThemeColorPresetId}
      sectionOrder={selectedPreset?.sectionOrder ?? DEFAULT_SECTION_ORDER}
      experienceListMarkerStyle={selectedPreset?.experienceListMarkerStyle ?? DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE}
      skillTagSeparator={selectedPreset?.skillTagSeparator ?? DEFAULT_RESUME_SKILL_TAG_SEPARATOR}
      templatePresetMap={templatePresetMap}
      isPresetMapReady={true}
      isPresetSyncFallbackAvailable={false}
      onClose={() => setCustomizingTemplateId(null)}
      onUseLocalPresetFallback={() => undefined}
      onSelectTemplate={(templateId) => updateConfig({ selectedTemplateId: templateId })}
      onSaveTemplatePreset={handleSaveTemplatePreset}
      initialEditingTemplateId={customizingTemplateId}
    />
    </>
  );
};

export default AgentApiPluginConfigModal;
