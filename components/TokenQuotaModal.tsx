import React from 'react';
import { BarChart3, RefreshCw, Wallet, X } from 'lucide-react';
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

const formatTokens = (value?: number | null) => {
  const safeValue = Math.max(Number(value || 0), 0);
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(safeValue % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(safeValue % 1_000 === 0 ? 0 : 1)}k`;
  }
  return safeValue.toLocaleString();
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const buildChartPoints = (items: TokenUsageAggregate[], width: number, height: number) => {
  if (!items.length) {
    return '';
  }
  const maxValue = Math.max(...items.map((item) => item.total_tokens), 1);
  return items
    .map((item, index) => {
      const x = items.length === 1 ? width / 2 : (index / (items.length - 1)) * width;
      const y = height - (item.total_tokens / maxValue) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
};

const UsageLineChart: React.FC<{ usageByDay: TokenUsageAggregate[] }> = ({ usageByDay }) => {
  const width = 260;
  const height = 82;
  const points = buildChartPoints(usageByDay, width, height);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">按天消耗</span>
        <BarChart3 className="h-4 w-4 text-primary" />
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible" role="img">
        <line x1="0" y1={height} x2={width} y2={height} stroke="currentColor" className="text-gray-200 dark:text-gray-700" />
        {points ? (
          <>
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary" />
            {points.split(' ').map((point) => {
              const [cx, cy] = point.split(',');
              return <circle key={point} cx={cx} cy={cy} r="3.5" fill="currentColor" className="text-primary" />;
            })}
          </>
        ) : (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-gray-400 text-[12px]">
            暂无数据
          </text>
        )}
      </svg>
    </div>
  );
};

const UsageBarChart: React.FC<{ usageByEntrypoint: TokenUsageAggregate[] }> = ({ usageByEntrypoint }) => {
  const maxValue = Math.max(...usageByEntrypoint.map((item) => item.total_tokens), 1);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-3 text-xs font-semibold text-gray-600 dark:text-gray-300">按入口消耗</div>
      <div className="space-y-2">
        {usageByEntrypoint.length ? usageByEntrypoint.slice(0, 6).map((item) => (
          <div key={item.key} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-2 text-xs">
            <span className="truncate text-gray-500 dark:text-gray-400" title={item.key}>{item.key}</span>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(6, (item.total_tokens / maxValue) * 100)}%` }}
              />
            </div>
            <span className="text-right font-medium text-gray-700 dark:text-gray-200">{formatTokens(item.total_tokens)}</span>
          </div>
        )) : (
          <div className="py-7 text-center text-xs text-gray-400">暂无数据</div>
        )}
      </div>
    </div>
  );
};

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

  if (!isOpen) {
    return null;
  }

  const activeSummary = summary;
  const percent = Math.max(0, Math.min(activeSummary?.remaining_percent ?? 0, 100));

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-950">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">额度</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">AI 服务 token 用量</p>
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

        <div className="min-h-0 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs text-gray-500 dark:text-gray-400">剩余用量</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{formatTokens(activeSummary?.remaining_tokens)}</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs text-gray-500 dark:text-gray-400">当前周期已用</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{formatTokens(activeSummary?.used_tokens)}</div>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">上限 {formatTokens(activeSummary?.token_limit)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-xs text-gray-500 dark:text-gray-400">最近购买</div>
              <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{formatTokens(activeSummary?.last_purchase_tokens)}</div>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">{formatDateTime(activeSummary?.last_purchase_at)}</div>
            </div>
          </div>

          {error ? <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div> : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <UsageLineChart usageByDay={usageByDay} />
            <UsageBarChart usageByEntrypoint={usageByEntrypoint} />
          </div>

          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">用量明细</h3>
              <span className="text-xs text-gray-400">最近 {usageEvents.length} 条</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="max-h-52 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">时间</th>
                      <th className="px-3 py-2 font-semibold">入口</th>
                      <th className="px-3 py-2 font-semibold">状态</th>
                      <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {usageEvents.length ? usageEvents.map((event) => (
                      <tr key={event.id} className="text-gray-600 dark:text-gray-300">
                        <td className="px-3 py-2">{formatDateTime(event.created_at)}</td>
                        <td className="px-3 py-2">{event.entrypoint}</td>
                        <td className="px-3 py-2">{event.status}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatTokens(event.total_tokens)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-gray-400">暂无用量明细</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">购买额度</h3>
            <div className="grid gap-3 md:grid-cols-3">
              {purchaseOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void handlePurchase(option)}
                  disabled={purchasingOptionId !== null}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
                >
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-200">{option.label}</div>
                  <div className="mt-1 text-xs text-emerald-700/70 dark:text-emerald-200/70">{option.price_label}</div>
                  <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TokenQuotaModal;
