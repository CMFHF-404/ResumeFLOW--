import React from 'react';
import { agentService, resolveAgentApiBaseUrl, type AgentApiKey } from '../services/agentService';

interface AgentApiPluginConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const maskApiKey = (key: string) => {
  if (!key) return '未生成';
  if (key.length <= 18) return `${key.slice(0, 6)}...`;
  return `${key.slice(0, 14)}...${key.slice(-4)}`;
};

const resolveDisplayApiKey = (revealedKey: string, apiKeys: AgentApiKey[]) => {
  if (revealedKey) return maskApiKey(revealedKey);
  const activeKey = apiKeys.find((key) => !key.revoked_at);
  if (!activeKey) return '未生成';
  return activeKey.key ? maskApiKey(activeKey.key) : `${activeKey.key_prefix}...`;
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

const getApiErrorMessage = (error: unknown, fallback: string) => {
  const response = (
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { data?: { detail?: unknown } } }).response
      : undefined
  );
  const detail = response?.data?.detail;
  return typeof detail === 'string'
    ? detail
    : error instanceof Error ? error.message : fallback;
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
    '请将 ResumeFLOW API Base 和 API Key 保存到本机私有密钥存储或本地配置中，方便后续同一机器继续使用；不要写入仓库、归档、日志或普通回复。',
    '安装后请按 SKILL.md 与 references/api.md 调用选项接口，先向用户确认模板、是否启用输出润色及档位，再执行求职筛选、分析、生成和归档流程。',
  ].join('\n');
};

const AgentApiPluginConfigModal: React.FC<AgentApiPluginConfigModalProps> = ({ isOpen, onClose }) => {
  const [tip, setTip] = React.useState('');
  const [apiKeys, setApiKeys] = React.useState<AgentApiKey[]>([]);
  const [newKeyName, setNewKeyName] = React.useState('Agent');
  const [revealedKey, setRevealedKey] = React.useState('');
  const [isMutatingKey, setIsMutatingKey] = React.useState(false);
  const displayApiKey = React.useMemo(
    () => resolveDisplayApiKey(revealedKey, apiKeys),
    [apiKeys, revealedKey]
  );
  const agentInstruction = React.useMemo(
    () => buildAgentInstruction(revealedKey || displayApiKey),
    [displayApiKey, revealedKey]
  );

  React.useEffect(() => {
    if (!isOpen) return;
    setTip('');
    setRevealedKey('');
    setNewKeyName('Agent');
  }, [isOpen]);

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

  const resolveActiveFullKey = () => (
    apiKeys.find((key) => !key.revoked_at && key.key)?.key ?? ''
  );

  const createAndActivateApiKey = async (rotate = false) => {
    const activeKeys = apiKeys.filter((key) => !key.revoked_at);
    const result = await agentService.createApiKey(newKeyName.trim() || 'Agent', rotate);
    const revokedAt = new Date().toISOString();
    setRevealedKey(result.key);
    setApiKeys((current) => [
      result.api_key,
      ...current
        .filter((key) => key.id !== result.api_key.id)
        .map((key) => (
          rotate && !key.revoked_at ? { ...key, key: null, revoked_at: revokedAt } : key
        )),
    ]);
    return { key: result.key, reusedExisting: activeKeys.some((key) => key.id === result.api_key.id) };
  };

  const copyInstruction = async () => {
    setIsMutatingKey(true);
    setTip('');
    try {
      let fullKey = revealedKey;
      let reusedExisting = false;
      if (!fullKey) {
        const activeFullKey = resolveActiveFullKey();
        if (activeFullKey) {
          fullKey = activeFullKey;
          setRevealedKey(activeFullKey);
        }
      }
      if (!fullKey) {
        const created = await createAndActivateApiKey(false);
        fullKey = created.key;
        reusedExisting = created.reusedExisting;
      }
      await copyTextToClipboard(buildAgentInstruction(fullKey));
      setTip(
        reusedExisting
          ? '已复制完整指令，使用当前账号已保存的 API Key'
          : '已复制完整指令，可直接发送给你的 Agent'
      );
    } catch (error) {
      const message = getApiErrorMessage(error, '复制指令失败');
      setTip(error instanceof Error && error.message === 'clipboard_unavailable'
        ? '剪贴板不可用，请手动选中指令复制'
        : message === 'Existing Agent API key cannot be displayed. Refresh it to create a replacement.'
          ? '当前账号已有旧版 API Key，但无法再次显示明文；请点击“刷新 API Key”生成唯一可复制的新 Key。'
          : message);
    } finally {
      setIsMutatingKey(false);
    }
  };

  const refreshApiKey = async () => {
    setIsMutatingKey(true);
    setTip('');
    try {
      await createAndActivateApiKey(true);
      setTip('API Key 已刷新，并保存到当前账号');
    } catch (error) {
      setTip(getApiErrorMessage(error, 'API Key 刷新失败'));
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

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/60" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Agent API 插件配置</h2>
            <p className="mt-1 text-xs text-slate-400">用于让外部 Agent 获取 JD 后调用 ResumeFLOW 生成岗位简历。</p>
          </div>
          <button className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white" onClick={onClose} type="button">关闭</button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">发送给通用 Agent 的指令</div>
                <div className="mt-1 text-xs text-slate-400">包含服务端 SKILL 集获取接口、API 地址、当前账号保存的 API Key，以及 Agent 本地复用提醒。</div>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50" disabled={isMutatingKey} onClick={copyInstruction} type="button">复制指令</button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50" disabled={isMutatingKey} onClick={refreshApiKey} type="button">刷新 API Key</button>
              </div>
            </div>
            <textarea className="h-44 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-primary" readOnly value={agentInstruction} />
            {revealedKey ? (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="mb-2 text-xs font-medium text-amber-200">完整 API Key 已保存到当前账号；点击刷新前会持续复用。</div>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100" readOnly value={revealedKey} />
                  <button className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950" onClick={copyRevealedKey} type="button">复制 Key</button>
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-amber-300">提示：平台只基于已有真实经历改写，不会新增不存在的公司、项目、奖项、证书或学历。</p>
          </div>

          {tip ? <div className="mt-4 text-sm font-medium text-emerald-300">{tip}</div> : null}
        </div>
      </div>
    </div>
  );
};

export default AgentApiPluginConfigModal;
