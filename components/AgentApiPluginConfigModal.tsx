import React from 'react';
import { agentService, resolveAgentApiBaseUrl, type AgentApiKey } from '../services/agentService';
import {
  assertAuthCacheKey,
  AuthContextChangedError,
  captureAuthCacheKey,
  isAuthContextChangedError,
} from '../services/apiClient';

interface AgentApiPluginConfigModalProps {
  isOpen: boolean;
  authUserKey: string | null;
  onClose: () => void;
}

interface AgentApiKeyOperation {
  expectedAuthCacheKey: string;
  expectedActiveKeyId: string | null;
  generation: number;
}

interface RevealedAgentApiKey extends AgentApiKeyOperation {
  key: string;
}

interface AgentApiKeyView extends AgentApiKeyOperation {
  keys: AgentApiKey[];
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
  return `${activeKey.key_prefix}...`;
};

const getAgentSkillBundleUrl = () => `${resolveAgentApiBaseUrl()}/agent/v1/skills/resumeflow-job-search`;

const copyTextToClipboard = async (
  text: string,
  assertCurrent: () => Promise<void>,
) => {
  await assertCurrent();
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      await assertCurrent();
      return;
    } catch {
      // Continue to the DOM fallback below for embedded browsers with blocked clipboard permission.
      await assertCurrent();
    }
  }

  await assertCurrent();
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  let copied = false;
  try {
    textarea.focus();
    textarea.select();
    copied = document.execCommand('copy');
  } finally {
    textarea.value = '';
    textarea.remove();
  }
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

const isAgentApiKeyConflict = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'response' in error
  && (error as { response?: { status?: number } }).response?.status === 409
);

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

const AgentApiPluginConfigModal: React.FC<AgentApiPluginConfigModalProps> = ({
  isOpen,
  authUserKey,
  onClose,
}) => {
  const [tip, setTip] = React.useState('');
  const [apiKeyView, setApiKeyView] = React.useState<AgentApiKeyView | null>(null);
  const [newKeyName, setNewKeyName] = React.useState('Agent');
  const [revealedSecret, setRevealedSecret] = React.useState<RevealedAgentApiKey | null>(null);
  const [mutationGeneration, setMutationGeneration] = React.useState<number | null>(null);
  const modalGenerationRef = React.useRef(0);
  const committedOpenStateRef = React.useRef(isOpen);
  const committedAuthUserKeyRef = React.useRef(authUserKey);
  const isOpenRef = React.useRef(isOpen);
  const apiKeyViewRef = React.useRef(apiKeyView);
  const isOpenStateCommitted = committedOpenStateRef.current === isOpen;
  const isOwnerStateCommitted = committedAuthUserKeyRef.current === authUserKey;
  const visibleGeneration = isOpenStateCommitted && isOwnerStateCommitted
    ? modalGenerationRef.current
    : -1;
  const apiKeys = apiKeyView?.generation === visibleGeneration ? apiKeyView.keys : [];
  const revealedKey = revealedSecret?.generation === visibleGeneration ? revealedSecret.key : '';
  const isMutatingKey = mutationGeneration === visibleGeneration;
  const displayApiKey = React.useMemo(
    () => resolveDisplayApiKey(revealedKey, apiKeys),
    [apiKeys, revealedKey]
  );
  const agentInstruction = React.useMemo(
    () => buildAgentInstruction(revealedKey || '<创建或刷新 API Key 后一次显示>'),
    [displayApiKey, revealedKey]
  );

  const isOperationCurrent = React.useCallback((operation: AgentApiKeyOperation) => (
    isOpenRef.current
    && committedAuthUserKeyRef.current === operation.expectedAuthCacheKey
    && modalGenerationRef.current === operation.generation
  ), []);

  const assertOperationCurrent = React.useCallback(async (operation: AgentApiKeyOperation) => {
    if (!isOperationCurrent(operation)) {
      throw new AuthContextChangedError();
    }
    await assertAuthCacheKey(operation.expectedAuthCacheKey);
    if (!isOperationCurrent(operation)) {
      throw new AuthContextChangedError();
    }
  }, [isOperationCurrent]);

  const beginOperation = React.useCallback(async (generation: number) => {
    const expectedAuthCacheKey = await captureAuthCacheKey(authUserKey ?? undefined);
    const ownerBoundApiKeyView = apiKeyViewRef.current?.generation === generation
      && apiKeyViewRef.current.expectedAuthCacheKey === expectedAuthCacheKey
      ? apiKeyViewRef.current
      : null;
    const operation = {
      expectedAuthCacheKey,
      expectedActiveKeyId: ownerBoundApiKeyView?.keys.find((key) => !key.revoked_at)?.id ?? null,
      generation,
    };
    await assertOperationCurrent(operation);
    return operation;
  }, [assertOperationCurrent, authUserKey]);

  const clearSensitiveState = React.useCallback((invalidateGeneration = false) => {
    if (invalidateGeneration) {
      modalGenerationRef.current += 1;
    }
    setRevealedSecret(null);
    setApiKeyView(null);
    setTip('');
    setMutationGeneration(null);
    setNewKeyName('Agent');
  }, []);

  React.useLayoutEffect(() => {
    if (committedAuthUserKeyRef.current !== authUserKey) {
      committedAuthUserKeyRef.current = authUserKey;
      modalGenerationRef.current += 1;
      clearSensitiveState();
    }
    if (committedOpenStateRef.current !== isOpen) {
      committedOpenStateRef.current = isOpen;
      modalGenerationRef.current += 1;
    }
    isOpenRef.current = isOpen;
  }, [authUserKey, clearSensitiveState, isOpen]);

  React.useLayoutEffect(() => {
    apiKeyViewRef.current = apiKeyView;
  }, [apiKeyView]);

  const loadApiKeys = React.useCallback(async (generation: number) => {
    let operation: AgentApiKeyOperation | null = null;
    try {
      operation = await beginOperation(generation);
      const keys = await agentService.listApiKeys({
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertOperationCurrent(operation);
      setApiKeyView({ ...operation, keys });
    } catch (error) {
      if (modalGenerationRef.current !== generation) {
        return;
      }
      if (isAuthContextChangedError(error)) {
        clearSensitiveState();
        return;
      }
      if (isOpenRef.current && modalGenerationRef.current === generation) {
        setTip(error instanceof Error ? error.message : 'API Key 加载失败');
      }
    }
  }, [assertOperationCurrent, beginOperation, clearSensitiveState, isOperationCurrent]);

  React.useEffect(() => {
    if (!isOpen) {
      clearSensitiveState();
      return;
    }
    const generation = modalGenerationRef.current;
    clearSensitiveState();
    void loadApiKeys(generation);
    return () => {
      if (modalGenerationRef.current === generation) {
        modalGenerationRef.current += 1;
      }
      setRevealedSecret(null);
      setApiKeyView(null);
      setMutationGeneration(null);
    };
  }, [clearSensitiveState, isOpen, loadApiKeys]);

  if (!isOpen) return null;

  const createAndActivateApiKey = async (
    operation: AgentApiKeyOperation,
    rotate = false,
  ) => {
    await assertOperationCurrent(operation);
    const result = await agentService.createApiKey(
      newKeyName.trim() || 'Agent',
      rotate,
      {
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
        expectedActiveKeyId: operation.expectedActiveKeyId,
      },
    );
    await assertOperationCurrent(operation);
    const revokedAt = new Date().toISOString();
    setRevealedSecret({ ...operation, key: result.key });
    setApiKeyView((current) => ({
      ...operation,
      keys: [
        result.api_key,
        ...(current?.expectedAuthCacheKey === operation.expectedAuthCacheKey
          && current.generation === operation.generation
          ? current.keys
          : [])
          .filter((key) => key.id !== result.api_key.id)
          .map((key) => (
            rotate && !key.revoked_at ? { ...key, revoked_at: revokedAt } : key
          )),
      ],
    }));
    return result.key;
  };

  const copyInstruction = async () => {
    const generation = modalGenerationRef.current;
    setMutationGeneration(generation);
    setTip('');
    let operation: AgentApiKeyOperation | null = null;
    try {
      operation = revealedSecret?.generation === generation
        ? {
          expectedAuthCacheKey: revealedSecret.expectedAuthCacheKey,
          expectedActiveKeyId: revealedSecret.expectedActiveKeyId,
          generation,
        }
        : await beginOperation(generation);
      await assertOperationCurrent(operation);
      let fullKey = revealedSecret?.generation === generation
        && revealedSecret.expectedAuthCacheKey === operation.expectedAuthCacheKey
        ? revealedSecret.key
        : '';
      if (!fullKey) {
        const operationApiKeys = apiKeyView?.generation === generation
          && apiKeyView.expectedAuthCacheKey === operation.expectedAuthCacheKey
          ? apiKeyView.keys
          : [];
        if (operationApiKeys.some((key) => !key.revoked_at)) {
          setTip('当前 API Key 仅会在创建时显示一次；如未保存，请刷新 API Key 生成替换密钥。');
          return;
        }
        fullKey = await createAndActivateApiKey(operation, false);
      }
      await assertOperationCurrent(operation);
      await copyTextToClipboard(
        buildAgentInstruction(fullKey),
        () => assertOperationCurrent(operation),
      );
      await assertOperationCurrent(operation);
      setTip('已复制完整指令，可直接发送给你的 Agent。请将 API Key 保存到私有密钥库。');
    } catch (error) {
      if (modalGenerationRef.current !== generation) {
        return;
      }
      if (isAuthContextChangedError(error)) {
        clearSensitiveState();
        return;
      }
      if (isAgentApiKeyConflict(error)) {
        setRevealedSecret(null);
        setApiKeyView(null);
        await loadApiKeys(generation);
        if (modalGenerationRef.current === generation) {
          setTip('API Key 状态已在其他操作中变化，已刷新列表；请重新执行。');
        }
        return;
      }
      const message = getApiErrorMessage(error, '复制指令失败');
      setTip(error instanceof Error && error.message === 'clipboard_unavailable'
        ? '剪贴板不可用，请手动选中指令复制'
        : message === 'Existing Agent API key cannot be displayed. Refresh it to create a replacement.'
          ? '当前账号已有旧版 API Key，但无法再次显示明文；请点击“刷新 API Key”生成唯一可复制的新 Key。'
          : message);
    } finally {
      if (modalGenerationRef.current === generation) {
        setMutationGeneration(null);
      }
    }
  };

  const refreshApiKey = async () => {
    const generation = modalGenerationRef.current;
    setMutationGeneration(generation);
    setTip('');
    let operation: AgentApiKeyOperation | null = null;
    try {
      operation = await beginOperation(generation);
      const operationApiKeys = apiKeyView?.generation === generation
        && apiKeyView.expectedAuthCacheKey === operation.expectedAuthCacheKey
        ? apiKeyView.keys
        : [];
      if (
        operationApiKeys.some((key) => !key.revoked_at)
        && !window.confirm('刷新会立即撤销当前 API Key；所有外部 Agent 都必须改用新 Key。是否继续？')
      ) {
        return;
      }
      await createAndActivateApiKey(operation, true);
      await assertOperationCurrent(operation);
      setTip('API Key 已刷新；完整 Key 仅本次显示，请立即保存到私有密钥库。');
    } catch (error) {
      if (modalGenerationRef.current !== generation) {
        return;
      }
      if (isAuthContextChangedError(error)) {
        clearSensitiveState();
        return;
      }
      if (isAgentApiKeyConflict(error)) {
        setRevealedSecret(null);
        setApiKeyView(null);
        await loadApiKeys(generation);
        if (modalGenerationRef.current === generation) {
          setTip('API Key 状态已在其他操作中变化，已刷新列表；请重新执行。');
        }
        return;
      }
      setTip(getApiErrorMessage(error, 'API Key 刷新失败'));
    } finally {
      if (modalGenerationRef.current === generation) {
        setMutationGeneration(null);
      }
    }
  };

  const copyRevealedKey = async () => {
    if (!revealedSecret || revealedSecret.generation !== visibleGeneration) return;
    const operation = {
      expectedAuthCacheKey: revealedSecret.expectedAuthCacheKey,
      expectedActiveKeyId: revealedSecret.expectedActiveKeyId,
      generation: revealedSecret.generation,
    };
    try {
      await assertOperationCurrent(operation);
      await copyTextToClipboard(
        revealedSecret.key,
        () => assertOperationCurrent(operation),
      );
      await assertOperationCurrent(operation);
      setTip('API Key 已复制');
    } catch (error) {
      if (modalGenerationRef.current !== operation.generation) {
        return;
      }
      if (isAuthContextChangedError(error)) {
        clearSensitiveState();
        return;
      }
      setTip('剪贴板不可用，请手动选中 API Key 复制');
    }
  };

  const handleClose = () => {
    clearSensitiveState(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={handleClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/60" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Agent API 插件配置</h2>
            <p className="mt-1 text-xs text-slate-400">用于让外部 Agent 获取 JD 后调用 ResumeFLOW 生成岗位简历。</p>
          </div>
          <button className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white" onClick={handleClose} type="button">关闭</button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">发送给通用 Agent 的指令</div>
                <div className="mt-1 text-xs text-slate-400">包含服务端 SKILL 集获取接口、API 地址，以及创建时一次显示的 API Key。</div>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50" disabled={isMutatingKey} onClick={copyInstruction} type="button">复制指令</button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50" disabled={isMutatingKey} onClick={refreshApiKey} type="button">刷新 API Key</button>
              </div>
            </div>
            <textarea className="h-44 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-primary" readOnly value={agentInstruction} />
            <p className="mt-2 text-xs text-slate-400">当前 Key 标识：{displayApiKey}。完整 Key 不会由列表接口返回。</p>
            {revealedKey ? (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="mb-2 text-xs font-medium text-amber-200">完整 API Key 仅本次显示，不会保存到当前账号；关闭后无法再次查看。</div>
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
