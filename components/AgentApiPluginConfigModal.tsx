import React from 'react';

type TabKey = 'basic' | 'template' | 'polish';

type OutputFormat = 'PDF' | 'DOCX' | 'Markdown';

type PolishLevel = '保守' | '标准' | '增强' | '强匹配';

export interface AgentApiPluginConfig {
  selectedTemplateId: string;
  polishBeforeOutput: boolean;
  polishLevel: PolishLevel;
  outputFormat: OutputFormat;
  forceOnePage: boolean;
}

interface AgentApiPluginConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'resumeflow.agentPluginConfig';
const SYSTEM_DEFAULT_TEMPLATE_ID = 'system-default-template';

const DEFAULT_CONFIG: AgentApiPluginConfig = {
  selectedTemplateId: SYSTEM_DEFAULT_TEMPLATE_ID,
  polishBeforeOutput: true,
  polishLevel: '标准',
  outputFormat: 'PDF',
  forceOnePage: true,
};

const AGENT_INSTRUCTION = '请安装并配置 ResumeFLOW 求职插件，使用我的 API Key 连接平台。之后你在求职网站获取 JD 后，请将职位名称、公司名称、JD 原文和岗位链接发送给 ResumeFLOW，由平台根据我预设的简历模板、润色设置和工作流生成定制简历，再由你用于投递。';

const TEMPLATE_OPTIONS = [
  { id: SYSTEM_DEFAULT_TEMPLATE_ID, label: '系统默认模板' },
  { id: 'template-modern', label: '现代简洁模板' },
  { id: 'template-classic', label: '经典商务模板' },
  { id: 'template-tech', label: '技术岗位模板' },
];

const loadConfig = (): AgentApiPluginConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AgentApiPluginConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      selectedTemplateId: parsed.selectedTemplateId || SYSTEM_DEFAULT_TEMPLATE_ID,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

const AgentApiPluginConfigModal: React.FC<AgentApiPluginConfigModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = React.useState<TabKey>('basic');
  const [config, setConfig] = React.useState<AgentApiPluginConfig>(DEFAULT_CONFIG);
  const [tip, setTip] = React.useState('');

  React.useEffect(() => {
    if (!isOpen) return;
    setConfig(loadConfig());
    setActiveTab('basic');
    setTip('');
  }, [isOpen]);

  if (!isOpen) return null;

  const saveConfig = () => {
    const normalized = {
      ...config,
      selectedTemplateId: config.selectedTemplateId || SYSTEM_DEFAULT_TEMPLATE_ID,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    setConfig(normalized);
    setTip('配置已保存');
  };

  const copyInstruction = async () => {
    await navigator.clipboard.writeText(AGENT_INSTRUCTION);
    setTip('已复制，可直接发送给你的 Agent');
  };

  const saveAndCopy = async () => {
    saveConfig();
    await copyInstruction();
  };

  const tabButtonClass = (tab: TabKey) => `rounded-lg px-3 py-1.5 text-sm transition ${activeTab === tab ? 'bg-primary text-white' : 'bg-slate-800 text-slate-300 hover:text-white'}`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Agent API 插件配置</h2>
          <button className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={onClose} type="button">关闭</button>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <div className="mb-2 text-xs text-slate-400">发送给通用 Agent 的指令</div>
          <textarea className="h-24 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-slate-100" readOnly value={AGENT_INSTRUCTION} />
          <p className="mt-2 text-xs text-amber-300">提示：平台只基于已有真实经历改写，不会新增不存在的公司、项目、奖项、证书或学历。</p>
        </div>

        <div className="mt-4 flex gap-2">
          <button className={tabButtonClass('basic')} onClick={() => setActiveTab('basic')} type="button">基础配置</button>
          <button className={tabButtonClass('template')} onClick={() => setActiveTab('template')} type="button">简历模板</button>
          <button className={tabButtonClass('polish')} onClick={() => setActiveTab('polish')} type="button">润色设置</button>
        </div>

        <div className="mt-4 min-h-[160px] rounded-xl border border-slate-700 p-4">
          {activeTab === 'basic' ? (
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span>输出格式</span>
                <select className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1" value={config.outputFormat} onChange={(e) => setConfig((prev) => ({ ...prev, outputFormat: e.target.value as OutputFormat }))}>
                  <option value="PDF">PDF</option>
                  <option value="DOCX">DOCX</option>
                  <option value="Markdown">Markdown</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>强制一页</span>
                <input type="checkbox" checked={config.forceOnePage} onChange={(e) => setConfig((prev) => ({ ...prev, forceOnePage: e.target.checked }))} />
              </label>
              <p className="text-xs text-slate-400">API Key 安全提示：页面不会长期明文展示 API Key。后续接入时仅在生成环节完整展示一次，数据库仅存 hash。</p>
            </div>
          ) : null}

          {activeTab === 'template' ? (
            <div className="space-y-2 text-sm">
              {TEMPLATE_OPTIONS.map((tpl) => (
                <label key={tpl.id} className="flex items-center gap-2 rounded-lg border border-slate-700 p-2">
                  <input type="radio" name="template" value={tpl.id} checked={config.selectedTemplateId === tpl.id} onChange={() => setConfig((prev) => ({ ...prev, selectedTemplateId: tpl.id }))} />
                  <span>{tpl.label}</span>
                </label>
              ))}
              <p className="text-xs text-slate-400">未选择模板时将自动使用系统默认模板。</p>
            </div>
          ) : null}

          {activeTab === 'polish' ? (
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span>输出前 AI 润色</span>
                <input type="checkbox" checked={config.polishBeforeOutput} onChange={(e) => setConfig((prev) => ({ ...prev, polishBeforeOutput: e.target.checked }))} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>润色档位</span>
                <select className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1" value={config.polishLevel} onChange={(e) => setConfig((prev) => ({ ...prev, polishLevel: e.target.value as PolishLevel }))}>
                  <option value="保守">保守</option>
                  <option value="标准">标准</option>
                  <option value="增强">增强</option>
                  <option value="强匹配">强匹配</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-emerald-300">{tip}</div>
          <div className="flex gap-2">
            <button className="rounded-lg bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600" onClick={saveConfig} type="button">保存配置</button>
            <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm hover:bg-indigo-500" onClick={copyInstruction} type="button">复制给 Agent</button>
            <button className="rounded-lg bg-primary px-3 py-2 text-sm text-white" onClick={saveAndCopy} type="button">保存并复制给 Agent</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentApiPluginConfigModal;
