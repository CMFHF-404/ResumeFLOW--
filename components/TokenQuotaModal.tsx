import React from 'react';
import { BarChart3, RefreshCw, TrendingUp, Wallet, X } from 'lucide-react';
import {
  billingService,
  type TokenPurchaseOption,
  type TokenQuotaSummary,
  type TokenUsageAggregate,
  type TokenUsageEvent,
} from '../services/billingService';

type TokenQuotaModalProps = {
  isOpen: boolean;
  onClose: () => void;
  summary: TokenQuotaSummary | null;
  onSummaryChange: (summary: TokenQuotaSummary) => void;
};

// 格式化 Tokens 数量显示，如 1.1M, 48.3k
const formatTokens = (value?: number | null): string => {
  const safeValue = Math.max(Number(value || 0), 0);
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(safeValue % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(safeValue % 1_000 === 0 ? 0 : 1)}k`;
  }
  return safeValue.toLocaleString();
};

// 格式化日期与时间展示，如 2026/06/24 08:41
const formatDateTime = (value?: string | null): string => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// ==========================================
// 1. 额度主看板组件 (合并指标并优化高度)
// ==========================================
const QuotaDashboard: React.FC<{ summary: TokenQuotaSummary | null }> = ({ summary }) => {
  const remaining = Math.max(Number(summary?.remaining_tokens ?? 0), 0);
  const used = Math.max(Number(summary?.used_tokens ?? 0), 0);
  const limit = Math.max(Number(summary?.token_limit ?? 0), 0);

  // 消耗比例
  const usedPercent = limit > 0
    ? Math.max(0, Math.min((used / limit) * 100, 100))
    : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* 剩余可用额度展示 */}
        <div className="flex-1">
          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            剩余可用额度
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
              {formatTokens(remaining)}
            </span>
            <span className="text-xs text-gray-400 font-medium">Tokens</span>
          </div>
        </div>

        {/* 已用进度条 */}
        <div className="flex-[1.2] space-y-1.5 border-t border-gray-100 pt-3 sm:border-t-0 sm:pt-0 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-gray-600 dark:text-gray-300">
              已用 {formatTokens(used)}
            </span>
            <span className="text-gray-400">
              上限 {formatTokens(limit)} ({usedPercent.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 ease-out"
              style={{ width: `${usedPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 底部融合的最近购买小字展示 */}
      {summary?.last_purchase_tokens ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 border-t border-gray-100 pt-2.5 text-[11px] text-gray-400 dark:border-gray-800">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            最近一次购买: <strong className="font-semibold text-gray-600 dark:text-gray-300">{formatTokens(summary.last_purchase_tokens)}</strong>
          </span>
          {summary.last_purchase_at && (
            <span>时间: {formatDateTime(summary.last_purchase_at)}</span>
          )}
        </div>
      ) : null}
    </div>
  );
};

// ==========================================
// 2. 消耗趋势折线图 (贝塞尔曲线 + 渐变填充 + 刻度)
// ==========================================
const UsageLineChart: React.FC<{ usageByDay: TokenUsageAggregate[] }> = ({ usageByDay }) => {
  const width = 500;
  const height = 130;
  const padding = 15;
  const maxVal = Math.max(...usageByDay.map((item) => item.total_tokens), 1000);

  // 生成三次贝塞尔曲线路径
  const bezierPath = React.useMemo(() => {
    if (!usageByDay.length) return '';
    const coords = usageByDay.map((item, index) => {
      const x = usageByDay.length === 1 ? width / 2 : (index / (usageByDay.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - (item.total_tokens / maxVal) * (height - padding * 2);
      return { x, y };
    });

    if (coords.length === 1) {
      return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    }

    let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX1 = curr.x + (next.x - curr.x) / 3;
      const cpY1 = curr.y;
      const cpX2 = curr.x + 2 * (next.x - curr.x) / 3;
      const cpY2 = next.y;
      path += ` C ${cpX1.toFixed(1)} ${cpY1.toFixed(1)}, ${cpX2.toFixed(1)} ${cpY2.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }
    return path;
  }, [usageByDay, maxVal]);

  // 生成渐变封闭区域路径
  const closedPath = React.useMemo(() => {
    if (!bezierPath || !usageByDay.length) return '';
    const firstX = usageByDay.length === 1 ? width / 2 : padding;
    const lastX = usageByDay.length === 1 ? width / 2 : width - padding;
    return `${bezierPath} L ${lastX.toFixed(1)} ${(height - padding).toFixed(1)} L ${firstX.toFixed(1)} ${(height - padding).toFixed(1)} Z`;
  }, [bezierPath, usageByDay]);

  // 日期标签
  const labels = React.useMemo(() => {
    if (usageByDay.length < 2) return [];
    const formatKey = (key: string) => key.substring(5); // 去除年份
    const first = formatKey(usageByDay[0].key);
    const last = formatKey(usageByDay[usageByDay.length - 1].key);
    if (usageByDay.length >= 5) {
      const mid = formatKey(usageByDay[Math.floor(usageByDay.length / 2)].key);
      return [
        { text: first, x: '0%' },
        { text: mid, x: '50%' },
        { text: last, x: '100%' },
      ];
    }
    return [
      { text: first, x: '0%' },
      { text: last, x: '100%' },
    ];
  }, [usageByDay]);

  return (
    <div className="flex h-full flex-col justify-between">
      <div className="relative flex-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img">
          <defs>
            <linearGradient id="chartLineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* 网格线 */}
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" className="text-gray-200 dark:text-gray-800" strokeWidth="1" />
          <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeDasharray="3,3" strokeWidth="1" />
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeDasharray="3,3" strokeWidth="1" />

          {/* 刻度数值 */}
          <text x={padding + 4} y={padding + 9} className="fill-gray-400 text-[10px] font-medium">{formatTokens(maxVal)}</text>
          <text x={padding + 4} y={height / 2 + 3} className="fill-gray-400 text-[10px] font-medium">{formatTokens(maxVal / 2)}</text>

          {usageByDay.length ? (
            <>
              {closedPath && <path d={closedPath} fill="url(#chartLineGrad)" />}
              {bezierPath && <path d={bezierPath} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500 dark:text-emerald-400" />}
              {usageByDay.map((item, index) => {
                const cx = usageByDay.length === 1 ? width / 2 : (index / (usageByDay.length - 1)) * (width - padding * 2) + padding;
                const cy = height - padding - (item.total_tokens / maxVal) * (height - padding * 2);
                return (
                  <g key={index} className="group/dot">
                    <circle cx={cx} cy={cy} r="3" fill="currentColor" className="text-emerald-500 dark:text-emerald-400 transition hover:scale-150" />
                    <title>{`${item.key}: ${item.total_tokens.toLocaleString()} Tokens`}</title>
                  </g>
                );
              })}
            </>
          ) : (
            <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-gray-400 text-xs">暂无消耗趋势数据</text>
          )}
        </svg>
      </div>

      {labels.length > 0 && (
        <div className="relative mt-1.5 h-4 text-[10px] font-semibold text-gray-400">
          {labels.map((lbl, idx) => (
            <span
              key={idx}
              className="absolute -translate-x-1/2"
              style={{ left: lbl.x, transform: lbl.x === '0%' ? 'none' : lbl.x === '100%' ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {lbl.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 3. 来源分布条形图
// ==========================================
const UsageBarChart: React.FC<{ usageByEntrypoint: TokenUsageAggregate[] }> = ({ usageByEntrypoint }) => {
  const maxValue = Math.max(...usageByEntrypoint.map((item) => item.total_tokens), 1);
  return (
    <div className="space-y-2.5">
      {usageByEntrypoint.length ? (
        usageByEntrypoint.slice(0, 6).map((item) => (
          <div key={item.key} className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-2 text-[11px]">
            <span className="truncate text-gray-500 dark:text-gray-400 font-medium" title={item.key}>
              {item.key}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                style={{ width: `${Math.max(6, (item.total_tokens / maxValue) * 100)}%` }}
              />
            </div>
            <span className="text-right font-bold text-gray-700 dark:text-gray-200">
              {formatTokens(item.total_tokens)}
            </span>
          </div>
        ))
      ) : (
        <div className="py-10 text-center text-xs text-gray-400">暂无来源分布数据</div>
      )}
    </div>
  );
};

// ==========================================
// 4. 图表选项卡容器 (在移动端只显示一个图表以减小高度)
// ==========================================
const QuotaCharts: React.FC<{
  usageByDay: TokenUsageAggregate[];
  usageByEntrypoint: TokenUsageAggregate[];
}> = ({ usageByDay, usageByEntrypoint }) => {
  const [activeTab, setActiveTab] = React.useState<'trend' | 'entrypoint'>('trend');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="mb-3.5 flex items-center justify-between">
        <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 md:block hidden">用量分析</h3>
        <div className="flex w-full items-center justify-between md:justify-end">
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 md:hidden">用量分析</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => setActiveTab('trend')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                activeTab === 'trend'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              消耗趋势
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('entrypoint')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                activeTab === 'entrypoint'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              来源分布
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className={`${activeTab === 'trend' ? 'block' : 'hidden'} md:block`}>
          <span className="mb-2 hidden text-[11px] font-semibold text-gray-400 dark:text-gray-500 md:block">消耗趋势 (最近)</span>
          <div className="h-[155px] rounded-lg border border-gray-100 bg-gray-50/20 p-3 dark:border-gray-800 dark:bg-gray-900/20">
            <UsageLineChart usageByDay={usageByDay} />
          </div>
        </div>

        <div className={`${activeTab === 'entrypoint' ? 'block' : 'hidden'} md:block`}>
          <span className="mb-2 hidden text-[11px] font-semibold text-gray-400 dark:text-gray-500 md:block">来源分布 (按入口)</span>
          <div className="h-[155px] overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/20 p-3 dark:border-gray-800 dark:bg-gray-900/20">
            <UsageBarChart usageByEntrypoint={usageByEntrypoint} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 5. 用量明细 (响应式：移动端列表，PC端表格)
// ==========================================
const UsageDetailTable: React.FC<{ usageEvents: TokenUsageEvent[] }> = ({ usageEvents }) => {
  return (
    <div className="hidden md:block overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="max-h-48 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400 z-10">
            <tr>
              <th className="px-3 py-2.5 font-semibold">时间</th>
              <th className="px-3 py-2.5 font-semibold">入口</th>
              <th className="px-3 py-2.5 font-semibold">状态</th>
              <th className="px-3 py-2.5 text-right font-semibold">Tokens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {usageEvents.length ? (
              usageEvents.map((event) => (
                <tr key={event.id} className="text-gray-600 hover:bg-gray-50/50 dark:text-gray-300 dark:hover:bg-gray-900/50">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(event.created_at)}</td>
                  <td className="px-3 py-2 font-medium">{event.entrypoint}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        event.status === 'success' || event.status === 'SUCCESS' || event.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                          : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                      }`}
                    >
                      {event.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-gray-700 dark:text-gray-200">
                    {formatTokens(event.total_tokens)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-400">暂无用量明细</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const UsageDetailList: React.FC<{ usageEvents: TokenUsageEvent[] }> = ({ usageEvents }) => {
  return (
    <div className="block md:hidden max-h-48 overflow-y-auto space-y-2 pr-0.5">
      {usageEvents.length ? (
        usageEvents.map((event) => (
          <div
            key={event.id}
            className="rounded-lg border border-gray-100 bg-gray-50/20 p-2.5 dark:border-gray-800 dark:bg-gray-900/25 flex items-center justify-between text-xs"
          >
            <div className="space-y-1 min-w-0 pr-2">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-gray-800 dark:text-gray-200 truncate max-w-[160px]">
                  {event.entrypoint}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-1 py-0.5 text-[9px] font-bold ${
                    event.status === 'success' || event.status === 'SUCCESS' || event.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                      : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                  }`}
                >
                  {event.status}
                </span>
              </div>
              <div className="text-[10px] text-gray-400">
                {formatDateTime(event.created_at)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="font-extrabold text-gray-700 dark:text-gray-200">
                +{formatTokens(event.total_tokens)}
              </span>
            </div>
          </div>
        ))
      ) : (
        <div className="py-8 text-center text-xs text-gray-400 rounded-lg border border-dashed border-gray-200 dark:border-gray-800">
          暂无用量明细
        </div>
      )}
    </div>
  );
};

// ==========================================
// 6. 购买额度区 (自适应：移动端横滑动)
// ==========================================
const PurchaseSection: React.FC<{
  purchaseOptions: TokenPurchaseOption[];
  purchasingOptionId: string | null;
  onPurchase: (option: TokenPurchaseOption) => void;
}> = ({ purchaseOptions, purchasingOptionId, onPurchase }) => {
  return (
    <div className="mt-5">
      <h3 className="mb-2.5 text-xs font-bold text-gray-900 dark:text-white">购买额度</h3>
      <div className="flex overflow-x-auto pb-1.5 gap-3 snap-x md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
        {purchaseOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => void onPurchase(option)}
            disabled={purchasingOptionId !== null}
            className="flex-shrink-0 w-[210px] snap-start rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-teal-50/10 p-3.5 text-left transition hover:border-emerald-300 hover:shadow-md disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/10 dark:from-emerald-950/20 dark:to-teal-950/5 dark:hover:border-emerald-500/30 md:w-auto"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
                {option.label}
              </span>
              <span className="rounded-full bg-emerald-100/70 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                {option.price_label}
              </span>
            </div>
            {option.description && (
              <p className="mt-2 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[30px]">
                {option.description}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                立即购买 →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ==========================================
// 主额度弹窗组件
// ==========================================
const TokenQuotaModal: React.FC<TokenQuotaModalProps> = ({
  isOpen,
  onClose,
  summary,
  onSummaryChange,
}) => {
  const [usageEvents, setUsageEvents] = React.useState<TokenUsageEvent[]>([]);
  const [usageByDay, setUsageByDay] = React.useState<TokenUsageAggregate[]>([]);
  const [usageByEntrypoint, setUsageByEntrypoint] = React.useState<TokenUsageAggregate[]>([]);
  const [purchaseOptions, setPurchaseOptions] = React.useState<TokenPurchaseOption[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [purchasingOptionId, setPurchasingOptionId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [nextSummary, usage, options] = await Promise.all([
        billingService.getSummary({ force: true }),
        billingService.getUsage(80),
        billingService.getPurchaseOptions(),
      ]);
      onSummaryChange(nextSummary);
      setUsageEvents(usage.events);
      setUsageByDay(usage.usage_by_day);
      setUsageByEntrypoint(usage.usage_by_entrypoint);
      setPurchaseOptions(options);
    } catch (fetchError) {
      console.error(fetchError);
      setError('额度信息加载失败，请稍后重试。');
    } finally {
      setIsLoading(false);
    }
  }, [onSummaryChange]);

  React.useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  const handlePurchase = async (option: TokenPurchaseOption) => {
    setPurchasingOptionId(option.id);
    setError('');
    try {
      const result = await billingService.createPlaceholderPurchase(option.id);
      onSummaryChange(result.summary);
      await refresh();
    } catch (purchaseError) {
      console.error(purchaseError);
      setError('购买额度失败，请稍后重试。');
    } finally {
      setPurchasingOptionId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-950">
        {/* 头部区域 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-gray-900 dark:text-white">额度</h2>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">AI 服务 token 用量</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
              aria-label="刷新额度"
              title="刷新额度"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
              aria-label="关闭额度弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 内容滚动区域 */}
        <div className="min-h-0 overflow-y-auto p-4 space-y-4">
          <QuotaDashboard summary={summary} />

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          )}

          <QuotaCharts usageByDay={usageByDay} usageByEntrypoint={usageByEntrypoint} />

          {/* 用量明细 */}
          <div className="mt-2">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-900 dark:text-white">用量明细</h3>
              <span className="text-[10px] font-semibold text-gray-400">最近 {usageEvents.length} 条</span>
            </div>
            <UsageDetailTable usageEvents={usageEvents} />
            <UsageDetailList usageEvents={usageEvents} />
          </div>

          {/* 购买额度区 */}
          <PurchaseSection
            purchaseOptions={purchaseOptions}
            purchasingOptionId={purchasingOptionId}
            onPurchase={handlePurchase}
          />
        </div>
      </div>
    </div>
  );
};

export default TokenQuotaModal;
