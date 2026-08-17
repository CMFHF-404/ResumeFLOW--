import React from 'react';
import { ArrowLeft, BarChart3, CreditCard, KeyRound, LoaderCircle, RefreshCw, TrendingUp, Wallet, X } from 'lucide-react';
import {
  billingService,
  type BillingProduct,
  type PaymentCheckoutForm,
  type PaymentOrder,
  type PaymentPurchaseContext,
  type TokenQuotaSummary,
  type TokenUsageAggregate,
  type TokenUsageEvent,
} from '../services/billingService';
import {
  clearMatchingTerminalPurchaseAttempt,
  coordinatePaymentOrdersAndContextRefresh,
  getOrCreatePurchaseIdempotencyKey,
  paymentOrderConflictMessage,
  paymentOrderCreationRateLimitMessage,
  requiresRepeatPurchaseAcknowledgement,
  resolveUnsettledPaymentOrderConflict,
} from './tokenQuotaOrderUtils';
import { usePaymentOrdersController } from './usePaymentOrdersController';
import {
  createPaymentCheckoutSubmissionController,
  type PaymentCheckoutSubmission,
} from './paymentCheckoutSubmissionController';

type QuotaModalView = 'overview' | 'purchase' | 'orders';

const SHOW_REDEMPTION_CARD = false;

type TokenQuotaModalProps = {
  isOpen: boolean;
  onClose: () => void;
  summary: TokenQuotaSummary | null;
  onSummaryChange: (summary: TokenQuotaSummary) => void;
  initialView?: QuotaModalView;
  returnFocusElement?: HTMLElement | null;
  returnedPaymentOrderId?: string | null;
  onPaymentOrderHandled?: () => void;
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
const QuotaDashboard: React.FC<{
  summary: TokenQuotaSummary | null;
  onOpenPurchase: () => void;
  purchaseButtonRef: React.RefObject<HTMLButtonElement | null>;
}> = ({ summary, onOpenPurchase, purchaseButtonRef }) => {
  const remaining = Math.max(Number(summary?.remaining_tokens ?? 0), 0);
  const used = Math.max(Number(summary?.used_tokens ?? 0), 0);
  const limit = Math.max(Number(summary?.token_limit ?? 0), 0);
  const isUnlimitedQuota = Boolean(summary?.is_unlimited);
  const unlimitedExpiryText = formatDateTime(summary?.unlimited_expires_at);

  // 消耗比例
  const usedPercent = limit > 0
    ? Math.max(0, Math.min((used / limit) * 100, 100))
    : 0;
  const progressPercent = isUnlimitedQuota ? 100 : usedPercent;

  return (
    <div className={`rounded-xl border p-4 ${
      isUnlimitedQuota
        ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/10'
        : 'border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50'
    }`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* 剩余可用额度展示 */}
        <div className="flex-1">
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${
            isUnlimitedQuota ? 'text-amber-600 dark:text-amber-300' : 'text-gray-400 dark:text-gray-500'
          }`}>
            {isUnlimitedQuota ? '无限额度' : '剩余可用额度'}
          </span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={isUnlimitedQuota
              ? 'text-5xl font-black tracking-tight text-amber-600 dark:text-amber-300 leading-none'
              : `text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400`
            }>
              {isUnlimitedQuota ? '∞' : formatTokens(remaining)}
            </span>
            {!isUnlimitedQuota && (
              <span className="text-xs text-gray-400 font-medium">Tokens</span>
            )}
          </div>
        </div>

        {/* 已用进度条 */}
        <div className="flex-[1.2] space-y-1.5 border-t border-gray-100 pt-3 sm:border-t-0 sm:pt-0 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className={isUnlimitedQuota ? 'text-amber-700 dark:text-amber-200' : 'text-gray-600 dark:text-gray-300'}>
              {isUnlimitedQuota ? '本期 AI 服务不扣 Token' : `已用 ${formatTokens(used)}`}
            </span>
            <span className="text-gray-400">
              {isUnlimitedQuota ? '无限可用' : `上限 ${formatTokens(limit)} (${usedPercent.toFixed(0)}%)`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
            <div
              // 金色无限进度条
              className={`h-full rounded-full ${
                isUnlimitedQuota
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-300'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-400'
              } transition-all duration-500 ease-out`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 底部融合的最近入账与购买额度 */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 text-[11px] text-gray-400 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-x-4">
          {isUnlimitedQuota ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              到期时间: <strong className="font-semibold text-amber-700 dark:text-amber-200">{unlimitedExpiryText}</strong>
            </span>
          ) : summary?.last_purchase_tokens ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                最近一次入账: <strong className="font-semibold text-gray-600 dark:text-gray-300">{formatTokens(summary.last_purchase_tokens)}</strong>
              </span>
              {summary.last_purchase_at && (
                <span>时间: {formatDateTime(summary.last_purchase_at)}</span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-700" />
              暂无入账记录
            </span>
          )}
        </div>
        <button
          ref={purchaseButtonRef}
          type="button"
          onClick={onOpenPurchase}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-bold text-emerald-600 transition hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300 dark:focus:ring-emerald-500/20"
        >
          <span>购买额度</span>
        </button>
      </div>
    </div>
  );
};

// ==========================================
// 2. 消耗趋势折线图 (贝塞尔曲线 + 渐变填充 + 刻度)
// ==========================================
const UsageLineChart: React.FC<{ usageByDay: TokenUsageAggregate[] }> = ({ usageByDay }) => {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const width = 500;
  const height = 130;
  const padding = 15;
  const chartTop = 8;
  const labelBandHeight = usageByDay.length >= 2 ? 18 : 0;
  const chartBottom = height - labelBandHeight - 1;
  const chartHeight = chartBottom - chartTop;
  const maxVal = Math.max(...usageByDay.map((item) => item.total_tokens), 1000);
  const axisMax = maxVal > 0 ? maxVal * 1.25 : 1000;

  // 生成三次贝塞尔曲线路径
  const bezierPath = React.useMemo(() => {
    if (!usageByDay.length) return '';
    const coords = usageByDay.map((item, index) => {
      const x = usageByDay.length === 1 ? width / 2 : (index / (usageByDay.length - 1)) * (width - padding * 2) + padding;
      const y = chartBottom - (item.total_tokens / axisMax) * chartHeight;
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
  }, [usageByDay, axisMax, chartHeight, chartBottom]);

  // 生成渐变封闭区域路径
  const closedPath = React.useMemo(() => {
    if (!bezierPath || !usageByDay.length) return '';
    const firstX = usageByDay.length === 1 ? width / 2 : padding;
    const lastX = usageByDay.length === 1 ? width / 2 : width - padding;
    return `${bezierPath} L ${lastX.toFixed(1)} ${chartBottom.toFixed(1)} L ${firstX.toFixed(1)} ${chartBottom.toFixed(1)} Z`;
  }, [bezierPath, chartBottom, usageByDay]);

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
    <div className="relative h-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" role="img">
        <defs>
          <linearGradient id="chartLineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* 网格线 */}
        <line x1={padding} y1={chartBottom} x2={width - padding} y2={chartBottom} stroke="currentColor" className="text-gray-200 dark:text-gray-800" strokeWidth="1" />
        <line x1={padding} y1={chartTop + chartHeight / 2} x2={width - padding} y2={chartTop + chartHeight / 2} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeDasharray="3,3" strokeWidth="1" />
        <line x1={padding} y1={chartTop} x2={width - padding} y2={chartTop} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeDasharray="3,3" strokeWidth="1" />

        {/* 刻度数值 */}
        <text x={padding + 4} y={chartTop + 9} className="fill-gray-400 text-[10px] font-medium">{formatTokens(axisMax)}</text>
        <text x={padding + 4} y={chartTop + chartHeight / 2 + 3} className="fill-gray-400 text-[10px] font-medium">{formatTokens(axisMax / 2)}</text>

        {usageByDay.length ? (
          <>
            {closedPath && <path d={closedPath} fill="url(#chartLineGrad)" />}
            {bezierPath && <path d={bezierPath} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500 dark:text-emerald-400" />}
            {usageByDay.map((item, index) => {
              const cx = usageByDay.length === 1 ? width / 2 : (index / (usageByDay.length - 1)) * (width - padding * 2) + padding;
              const cy = chartBottom - (item.total_tokens / axisMax) * chartHeight;
              const isHovered = hoveredIndex === index;
              return (
                <g key={index} className="group/dot">
                  {/* 透明 Hover 感应区 */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r="12"
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                  {/* 渲染的点 */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 5.5 : 3.2}
                    fill="currentColor"
                    className="text-emerald-500 dark:text-emerald-400 transition-all duration-200 ease-out pointer-events-none"
                    style={{ transformOrigin: `${cx}px ${cy}px` }}
                  />
                  <title>{`${item.key}: ${item.total_tokens.toLocaleString()} Tokens`}</title>
                </g>
              );
            })}
          </>
        ) : (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-gray-400 text-xs">暂无消耗趋势数据</text>
        )}
      </svg>

      {/* 绝对定位自定义 Tooltip */}
      {hoveredIndex !== null && usageByDay[hoveredIndex] && (() => {
        const item = usageByDay[hoveredIndex];
        const cx = usageByDay.length === 1 ? width / 2 : (hoveredIndex / (usageByDay.length - 1)) * (width - padding * 2) + padding;
        const cy = chartBottom - (item.total_tokens / axisMax) * chartHeight;

        const leftPct = `${(cx / width) * 100}%`;
        const topPct = `${(cy / height) * 100}%`;

        return (
          <div
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full pb-2 transition-all duration-150 ease-out"
            style={{ left: leftPct, top: topPct }}
          >
            <div className="rounded-lg border border-gray-100 bg-white/95 px-2.5 py-1.5 text-[10px] font-bold text-gray-800 shadow-xl backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200 whitespace-nowrap">
              <div className="text-[9px] font-semibold text-gray-400 dark:text-gray-500">{item.key}</div>
              <div className="mt-0.5 font-extrabold text-emerald-600 dark:text-emerald-400">
                {item.total_tokens.toLocaleString()} <span className="text-[9px] font-normal text-gray-400">Tokens</span>
              </div>
            </div>
            {/* 三角形 */}
            <div className="absolute left-1/2 bottom-1 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border-r border-b border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900" />
          </div>
        );
      })()}

      {labels.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 text-[10px] font-semibold text-gray-400">
          {labels.map((lbl, idx) => (
            <span
              key={idx}
              className="absolute -translate-x-1/2 whitespace-nowrap"
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
        <h3 className="hidden shrink-0 whitespace-nowrap text-xs font-bold text-gray-700 dark:text-gray-300 md:block">用量分析</h3>
        <div className="flex w-full items-center justify-between md:w-auto md:justify-end">
          <span className="shrink-0 whitespace-nowrap text-xs font-bold text-gray-700 dark:text-gray-300 md:hidden">用量分析</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900 md:hidden">
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

const formatPrice = (amountFen: number, currency: string) => {
  const amount = Math.max(Number(amountFen || 0), 0) / 100;
  return `${currency === 'CNY' ? '¥' : `${currency} `}${amount.toFixed(2)}`;
};

type PaymentUiStatus = 'creating' | 'processing' | PaymentOrder['status'] | null;

const paymentStatusCopy = (status: PaymentUiStatus) => {
  switch (status) {
    case 'creating': return '正在创建订单…';
    case 'processing': return '正在确认付款状态…';
    case 'pending': return '订单已创建，正在前往收银台…';
    case 'paid': return '付款已确认，正在到账…';
    case 'fulfilled': return '权益已到账，额度已刷新。';
    case 'cancelled': return '订单已暂停；如仍需购买，请再次下单。';
    case 'expired': return '订单已过期；如仍需购买，请再次下单。';
    case 'failed': return '订单未完成，请重试或选择其他套餐。';
    default: return '';
  }
};

const PurchaseCatalog: React.FC<{
  products: BillingProduct[];
  paymentsEnabled: boolean;
  isLoading: boolean;
  isPurchasing: boolean;
  isCheckoutSubmitting: boolean;
  isPurchaseContextReady: boolean;
  paymentStatus: PaymentUiStatus;
  onPurchase: (product: BillingProduct) => void;
}> = ({ products, paymentsEnabled, isLoading, isPurchasing, isCheckoutSubmitting, isPurchaseContextReady, paymentStatus, onPurchase }) => {
  const [activeTab, setActiveTab] = React.useState<BillingProduct['category']>('tokens');
  const tokenTabRef = React.useRef<HTMLButtonElement | null>(null);
  const unlimitedTabRef = React.useRef<HTMLButtonElement | null>(null);
  const activeProducts = products.filter((product) => product.category === activeTab);
  const switchTabFromKeyboard = (nextTab: BillingProduct['category']) => {
    setActiveTab(nextTab);
    const nextTabRef = nextTab === 'tokens' ? tokenTabRef : unlimitedTabRef;
    nextTabRef.current?.focus();
  };
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      switchTabFromKeyboard(activeTab === 'tokens' ? 'unlimited' : 'tokens');
    } else if (event.key === 'Home') {
      event.preventDefault();
      switchTabFromKeyboard('tokens');
    } else if (event.key === 'End') {
      event.preventDefault();
      switchTabFromKeyboard('unlimited');
    }
  };
  const renderProduct = (product: BillingProduct) => {
    const isUnlimited = product.category === 'unlimited';
    const tokenAmount = Math.max(Number(product.token_amount ?? 0), 0);
    const estimatedJdAnalyses = Math.floor(tokenAmount / 17_000);
    const estimatedAssistantActions = Math.floor(tokenAmount / 5_000);
    const benefit = isUnlimited
      ? `${product.unlimited_duration_days ?? 0} 天不限量`
      : '永久有效';
    return (
      <article
        key={product.sku}
        className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border p-3.5 transition sm:p-4 ${
          isUnlimited
            ? 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 shadow-[0_10px_30px_-22px_rgba(217,119,6,0.65)] dark:border-amber-500/25 dark:from-amber-950/30 dark:via-gray-950 dark:to-amber-950/10'
            : 'border-emerald-100 bg-white shadow-[0_10px_24px_-24px_rgba(5,150,105,0.7)] dark:border-emerald-500/15 dark:bg-gray-950'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className={`truncate text-sm font-extrabold ${isUnlimited ? 'text-amber-900 dark:text-amber-100' : 'text-gray-900 dark:text-white'}`}>{product.name}</h4>
            <p className="mt-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">{benefit}</p>
          </div>
          {isUnlimited && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">∞ UNLIMITED</span>}
        </div>
        <div className="mt-3 min-h-16 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          {isUnlimited ? (
            <p>{product.description}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-4 marker:text-emerald-400 dark:marker:text-emerald-500">
              <li>约 <strong className="font-extrabold text-gray-700 dark:text-gray-200">{estimatedJdAnalyses}</strong> 次 JD 分析</li>
              <li>约 <strong className="font-extrabold text-gray-700 dark:text-gray-200">{estimatedAssistantActions}</strong> 条 AI 助理消息</li>
              <li>约 <strong className="font-extrabold text-gray-700 dark:text-gray-200">{estimatedAssistantActions}</strong> 次 AI 润色</li>
            </ul>
          )}
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <strong className={`text-xl tracking-tight ${isUnlimited ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatPrice(product.amount_fen, product.currency)}</strong>
          {paymentsEnabled && (
            <button
              type="button"
              disabled={isPurchasing || isCheckoutSubmitting || !isPurchaseContextReady}
              onClick={() => onPurchase(product)}
              className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-extrabold text-white transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                isUnlimited
                  ? 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-200 dark:hover:bg-amber-400'
                  : 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-200 dark:hover:bg-emerald-500'
              }`}
            >
              {isPurchasing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              购买
            </button>
          )}
        </div>
      </article>
    );
  };

  if (isLoading) {
    return <div className="rounded-xl border border-gray-200 px-4 py-6 text-center text-xs font-semibold text-gray-400 dark:border-gray-800">正在加载可购买套餐…</div>;
  }

  if (!paymentsEnabled && products.length === 0) {
    return <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">在线支付暂未开放，请稍后重试。</div>;
  }

  return (
    <section aria-label="购买套餐" className="mx-auto w-full max-w-3xl space-y-4">
      <div className="text-center">
        <div
          role="tablist"
          aria-label="套餐类型"
          className="inline-flex rounded-xl border border-gray-200 bg-gray-100/80 p-1 shadow-inner dark:border-gray-800 dark:bg-gray-900"
        >
          <button
            ref={tokenTabRef}
            id="billing-tab-tokens"
            type="button"
            role="tab"
            aria-selected={activeTab === 'tokens'}
            aria-controls="billing-plan-panel"
            tabIndex={activeTab === 'tokens' ? 0 : -1}
            onClick={() => setActiveTab('tokens')}
            onKeyDown={handleTabKeyDown}
            className={`min-w-24 rounded-lg px-5 py-2 text-xs font-extrabold transition focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:focus:ring-emerald-500/20 ${
              activeTab === 'tokens'
                ? 'bg-white text-emerald-700 shadow-sm dark:bg-gray-800 dark:text-emerald-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            按量
          </button>
          <button
            ref={unlimitedTabRef}
            id="billing-tab-unlimited"
            type="button"
            role="tab"
            aria-selected={activeTab === 'unlimited'}
            aria-controls="billing-plan-panel"
            tabIndex={activeTab === 'unlimited' ? 0 : -1}
            onClick={() => setActiveTab('unlimited')}
            onKeyDown={handleTabKeyDown}
            className={`min-w-24 rounded-lg px-5 py-2 text-xs font-extrabold transition focus:outline-none focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-500/20 ${
              activeTab === 'unlimited'
                ? 'bg-white text-amber-700 shadow-sm dark:bg-gray-800 dark:text-amber-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            包月
          </button>
        </div>
        <p className="mt-2 text-[10px] font-semibold text-gray-400">选择套餐后将直接跳转支付</p>
        {paymentStatus && (
          <p role="status" aria-live="polite" className={`mt-2 text-[10px] font-bold ${paymentStatus === 'fulfilled' ? 'text-emerald-600 dark:text-emerald-400' : paymentStatus === 'failed' || paymentStatus === 'expired' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-300'}`}>
            {paymentStatusCopy(paymentStatus)}
          </p>
        )}
      </div>
      {!paymentsEnabled && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
          在线支付暂未开放；套餐购买按钮已隐藏，请稍后重试。
        </div>
      )}
      <div
        id="billing-plan-panel"
        role="tabpanel"
        aria-labelledby={`billing-tab-${activeTab}`}
        className="animate-in fade-in slide-in-from-bottom-1 duration-200"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {activeProducts.map(renderProduct)}
        </div>
      </div>
    </section>
  );
};

const RedemptionCard: React.FC<{
  code: string;
  isRedeeming: boolean;
  redemptionMessage: string;
  redemptionError: string;
  onCodeChange: (value: string) => void;
  onRedeem: () => void;
}> = ({ code, isRedeeming, redemptionMessage, redemptionError, onCodeChange, onRedeem }) => (
  <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-teal-50/20 p-4 shadow-sm dark:border-emerald-500/10 dark:from-emerald-950/10 dark:to-teal-950/5">
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onRedeem();
      }}
      className="flex flex-col justify-between"
    >
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <KeyRound className="h-3 w-3" />
          </span>
          <span>兑换卡密</span>
        </div>
        <p className="mb-2.5 text-[11px] text-gray-500 dark:text-gray-400">输入您的卡密以兑换对应的 AI 服务额度。</p>
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="卡密"
            disabled={isRedeeming}
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            placeholder="RF-XXXX-XXXX-XXXX-XXXX"
            className="h-9 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold tracking-wide text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-700 dark:focus:border-emerald-500 dark:focus:ring-emerald-500/10"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={isRedeeming || !code.trim()}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 focus:outline-none"
          >
            {isRedeeming ? '兑换中' : '确认兑换'}
          </button>
        </div>
        {redemptionMessage && (
          <div role="status" aria-live="polite" className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
            {redemptionMessage}
          </div>
        )}
        {redemptionError && (
          <div role="alert" className="text-[10px] font-semibold text-red-600 dark:text-red-300">
            {redemptionError}
          </div>
        )}
      </div>
    </form>
  </div>
);

const paymentOrderStatusCopy = (status: PaymentOrder['status']) => {
  switch (status) {
    case 'pending': return '待支付';
    case 'paid': return '支付确认中';
    case 'fulfilled': return '已完成';
    case 'cancelled': return '已取消';
    case 'expired': return '已取消（超时）';
    case 'failed': return '支付失败';
    default: return status;
  }
};

const isOrderPastDue = (order: PaymentOrder, now: number) => {
  if (order.status !== 'pending' || !order.expires_at) return false;
  const expiresAt = new Date(order.expires_at).getTime();
  return !Number.isNaN(expiresAt) && expiresAt <= now;
};

const PaymentOrdersPanel: React.FC<{
  orders: PaymentOrder[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  now: number;
  actionOrderId: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onContinuePayment: (order: PaymentOrder) => void;
  onSync: (order: PaymentOrder) => void;
  onCancel: (order: PaymentOrder) => void;
  onRepeatPurchase: (order: PaymentOrder) => void;
  onSelectNewPurchase: () => void;
}> = ({
  orders,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  now,
  actionOrderId,
  onRefresh,
  onLoadMore,
  onContinuePayment,
  onSync,
  onCancel,
  onRepeatPurchase,
  onSelectNewPurchase,
}) => {
  const [confirmingOrderId, setConfirmingOrderId] = React.useState<string | null>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelTriggerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const orderArticleRefs = React.useRef(new Map<string, HTMLElement>());
  const restoreCancelFocusRef = React.useRef<string | null>(null);

  const openCancelConfirmation = (orderId: string) => {
    restoreCancelFocusRef.current = null;
    setConfirmingOrderId(orderId);
  };

  const closeCancelConfirmation = () => {
    restoreCancelFocusRef.current = confirmingOrderId;
    setConfirmingOrderId(null);
  };

  React.useEffect(() => {
    if (!confirmingOrderId) return;
    const animationFrame = window.requestAnimationFrame(() => confirmButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [confirmingOrderId]);

  React.useEffect(() => {
    const orderId = restoreCancelFocusRef.current;
    if (confirmingOrderId || !orderId) return;
    restoreCancelFocusRef.current = null;
    const animationFrame = window.requestAnimationFrame(() => {
      const target = cancelTriggerRefs.current.get(orderId) ?? orderArticleRefs.current.get(orderId);
      target?.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [confirmingOrderId]);

  React.useEffect(() => {
    if (confirmingOrderId && !orders.some((order) => order.id === confirmingOrderId && order.status === 'pending')) {
      restoreCancelFocusRef.current = confirmingOrderId;
      setConfirmingOrderId(null);
    }
  }, [confirmingOrderId, orders]);

  if (isLoading && orders.length === 0) {
    return <div className="rounded-xl border border-gray-200 px-4 py-8 text-center text-xs font-semibold text-gray-400 dark:border-gray-800">正在加载订单…</div>;
  }

  return (
    <section aria-label="我的订单" className="mx-auto w-full max-w-3xl space-y-3" data-quota-view="orders">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">我的订单</h3>
          <p className="mt-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500">仅显示当前账户创建的订单</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>
      {error && (
        <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <span>{error}</span>
          <button type="button" onClick={onRefresh} className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-red-700 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">重试</button>
        </div>
      )}
      {!error && orders.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-xs font-semibold text-gray-400 dark:border-gray-800">暂无订单，选择套餐后即可在这里查看进度。</div>
      )}
      <div className="space-y-2">
        {orders.map((order) => {
          const isPastDue = isOrderPastDue(order, now);
          const isPending = order.status === 'pending';
          const canRepeatPurchase = order.status === 'cancelled' || order.status === 'expired';
          const canQueryFinalStatus = order.status === 'paid' || canRepeatPurchase;
          const canSelectNewPurchase = order.status === 'failed';
          const isBusy = actionOrderId !== null;
          const isCurrentAction = actionOrderId === order.id;
          const isConfirming = confirmingOrderId === order.id;
          return (
            <article
              key={order.id}
              ref={(element) => {
                if (element) orderArticleRefs.current.set(order.id, element);
                else orderArticleRefs.current.delete(order.id);
              }}
              tabIndex={-1}
              className="rounded-xl border border-gray-200 p-3.5 outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-800 dark:focus:ring-emerald-500/20"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h4 className="truncate text-xs font-extrabold text-gray-900 dark:text-white">{order.product_name || order.sku}</h4>
                  <p className="mt-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">{formatPrice(order.amount_fen, order.currency)} · 创建于 {formatDateTime(order.created_at)}</p>
                  {order.token_amount ? <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{formatTokens(order.token_amount)} Tokens</p> : order.unlimited_duration_days ? <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{order.unlimited_duration_days} 天不限量</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 self-start">
                  {isPending && !isConfirming && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onContinuePayment(order)}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >{isCurrentAction ? '打开中…' : '继续支付'}</button>
                  )}
                  {canRepeatPurchase && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onRepeatPurchase(order)}
                      className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                    >{isCurrentAction ? '下单中…' : '再次下单'}</button>
                  )}
                  <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-extrabold ${
                    order.status === 'fulfilled' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : order.status === 'pending' || order.status === 'paid' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}>{paymentOrderStatusCopy(order.status)}</span>
                </div>
              </div>
              {isPending && order.expires_at && <p className={`mt-2 text-[10px] font-medium ${isPastDue ? 'text-red-500 dark:text-red-300' : 'text-gray-400 dark:text-gray-500'}`}>{isPastDue ? '按本机时间估计已超过付款时限，最终状态以服务端为准。' : `请于 ${formatDateTime(order.expires_at)} 前完成支付`}</p>}
              {(isPending || canQueryFinalStatus || canSelectNewPurchase) && <div className="mt-3 flex flex-wrap items-center gap-2">
                {isPending && !isConfirming && (
                  <>
                    <button type="button" disabled={isBusy} onClick={() => onSync(order)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">查询状态</button>
                    <button
                      ref={(element) => {
                        if (element) cancelTriggerRefs.current.set(order.id, element);
                        else cancelTriggerRefs.current.delete(order.id);
                      }}
                      type="button"
                      disabled={isBusy}
                      onClick={() => openCancelConfirmation(order.id)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
                    >取消订单</button>
                  </>
                )}
                {isConfirming && (
                  <div className="w-full rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-100">
                    <p>本地取消不会关闭支付平台上的旧收银台；“再次下单”会创建一笔新的同套餐订单。</p>
                    <div className="mt-2 flex gap-2">
                      <button ref={confirmButtonRef} type="button" disabled={isBusy} onClick={() => onCancel(order)} className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-extrabold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60">{isCurrentAction ? '取消中…' : '确认取消'}</button>
                      <button type="button" disabled={isBusy} onClick={closeCancelConfirmation} className="rounded-md border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/30 dark:bg-transparent dark:text-amber-100">暂不取消</button>
                    </div>
                  </div>
                )}
                {canQueryFinalStatus && <button type="button" disabled={isBusy} onClick={() => onSync(order)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">查询最终状态</button>}
                {canSelectNewPurchase && <button type="button" disabled={isBusy} onClick={onSelectNewPurchase} className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10">重新选择套餐</button>}
              </div>}
            </article>
          );
        })}
      </div>
      {hasMore && <div className="pt-1 text-center"><button type="button" disabled={isLoadingMore} onClick={onLoadMore} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">{isLoadingMore ? '正在加载…' : '加载更多'}</button></div>}
    </section>
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
  initialView = 'overview',
  returnFocusElement = null,
  returnedPaymentOrderId = null,
  onPaymentOrderHandled,
}) => {
  const [usageEvents, setUsageEvents] = React.useState<TokenUsageEvent[]>([]);
  const [usageByDay, setUsageByDay] = React.useState<TokenUsageAggregate[]>([]);
  const [usageByEntrypoint, setUsageByEntrypoint] = React.useState<TokenUsageAggregate[]>([]);
  const [redemptionCode, setRedemptionCode] = React.useState('');
  const [redemptionMessage, setRedemptionMessage] = React.useState('');
  const [redemptionError, setRedemptionError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isRedeeming, setIsRedeeming] = React.useState(false);
  const redemptionRequestGenerationRef = React.useRef(0);
  const redemptionAbortControllerRef = React.useRef<AbortController | null>(null);
  const [activeView, setActiveView] = React.useState<QuotaModalView>('overview');
  const [error, setError] = React.useState('');
  const [products, setProducts] = React.useState<BillingProduct[]>([]);
  const [catalogVersion, setCatalogVersion] = React.useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = React.useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = React.useState(false);
  const productsRequestGenerationRef = React.useRef(0);
  const productsAbortControllerRef = React.useRef<AbortController | null>(null);
  const [isPurchasing, setIsPurchasing] = React.useState(false);
  const [isCheckoutSubmitting, setIsCheckoutSubmitting] = React.useState(false);
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentUiStatus>(null);
  const [checkoutForm, setCheckoutForm] = React.useState<PaymentCheckoutForm | null>(null);
  const checkoutFormRef = React.useRef<HTMLFormElement | null>(null);
  const checkoutSubmitWatchdogRef = React.useRef<number | null>(null);
  const checkoutSubmissionControllerRef = React.useRef(
    createPaymentCheckoutSubmissionController(),
  );
  const [checkoutReturnSyncOrderId, setCheckoutReturnSyncOrderId] = React.useState<string | null>(null);
  const [purchaseContext, setPurchaseContext] = React.useState<PaymentPurchaseContext | null>(null);
  const [isLoadingPurchaseContext, setIsLoadingPurchaseContext] = React.useState(false);
  const [purchaseContextError, setPurchaseContextError] = React.useState('');
  const purchaseContextRequestGenerationRef = React.useRef(0);
  const purchaseContextAbortControllerRef = React.useRef<AbortController | null>(null);
  const paymentRefreshLifecycleGenerationRef = React.useRef(0);
  const quotaRefreshGenerationRef = React.useRef(0);
  const quotaRefreshAbortControllerRef = React.useRef<AbortController | null>(null);
  const fulfilledRefreshGenerationRef = React.useRef(0);
  const fulfilledRefreshAbortControllerRef = React.useRef<AbortController | null>(null);
  const purchaseContextTokenRef = React.useRef<string | null>(null);
  const acknowledgedPaymentStateTokenRef = React.useRef<string | null>(null);
  const purchaseIdempotencyKeysRef = React.useRef(new Map<string, string>());
  const purchaseOrderIdsRef = React.useRef(new Map<string, string>());
  const returnedOrderRef = React.useRef<string | null>(null);
  const checkoutRequestGenerationRef = React.useRef(0);
  const checkoutInFlightGenerationRef = React.useRef<number | null>(null);
  const checkoutAbortControllerRef = React.useRef<AbortController | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const purchaseButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const backButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const restorePurchaseButtonFocusRef = React.useRef(false);
  const [paymentSyncRetryRequest, setPaymentSyncRetryRequest] = React.useState(0);
  const [canRetryPaymentSync, setCanRetryPaymentSync] = React.useState(false);

  const clearPurchaseAttemptForTerminalOrder = React.useCallback((order: PaymentOrder) => {
    clearMatchingTerminalPurchaseAttempt(
      purchaseIdempotencyKeysRef.current,
      purchaseOrderIdsRef.current,
      order,
    );
  }, []);

  const {
    orders,
    ordersHasMore,
    isLoadingOrders,
    isLoadingMoreOrders,
    ordersError,
    orderActionId,
    ordersNow,
    loadOrders,
    invalidateOrderLoadRequests,
    rememberOrderForCheckoutRecovery,
    setOrdersError,
    touchOrdersNow,
    markOrderAction,
    beginOrderAction,
    isOrderActionCurrent,
    finishOrderAction,
    invalidateOrderAction,
  } = usePaymentOrdersController(clearPurchaseAttemptForTerminalOrder);

  const beginCheckoutRequest = React.useCallback(() => {
    if (checkoutInFlightGenerationRef.current !== null) return null;
    const generation = checkoutRequestGenerationRef.current + 1;
    checkoutRequestGenerationRef.current = generation;
    checkoutInFlightGenerationRef.current = generation;
    checkoutAbortControllerRef.current?.abort();
    checkoutAbortControllerRef.current = new AbortController();
    return generation;
  }, []);

  const isCheckoutRequestCurrent = React.useCallback((generation: number) => (
    checkoutRequestGenerationRef.current === generation
    && checkoutInFlightGenerationRef.current === generation
  ), []);

  const finishCheckoutRequest = React.useCallback((generation: number) => {
    if (checkoutInFlightGenerationRef.current !== generation) return;
    checkoutInFlightGenerationRef.current = null;
    checkoutAbortControllerRef.current = null;
    setIsPurchasing(false);
  }, []);

  const invalidateCheckoutRequest = React.useCallback(() => {
    checkoutAbortControllerRef.current?.abort();
    checkoutAbortControllerRef.current = null;
    checkoutRequestGenerationRef.current += 1;
    checkoutInFlightGenerationRef.current = null;
    checkoutSubmissionControllerRef.current.invalidate();
    invalidateOrderAction();
    setCheckoutForm(null);
    setIsPurchasing(false);
    setIsCheckoutSubmitting(false);
    return true;
  }, [invalidateOrderAction]);

  const clearCheckoutSubmitWatchdog = React.useCallback(() => {
    if (checkoutSubmitWatchdogRef.current !== null) {
      window.clearTimeout(checkoutSubmitWatchdogRef.current);
      checkoutSubmitWatchdogRef.current = null;
    }
  }, []);

  const resetCheckoutAfterExternalReturn = React.useCallback(() => {
    clearCheckoutSubmitWatchdog();
    checkoutRequestGenerationRef.current += 1;
    checkoutInFlightGenerationRef.current = null;
    checkoutAbortControllerRef.current?.abort();
    checkoutAbortControllerRef.current = null;
    setCheckoutForm(null);
    setIsPurchasing(false);
    setIsCheckoutSubmitting(false);
  }, [clearCheckoutSubmitWatchdog]);

  const invalidatePurchaseContextRequest = React.useCallback(() => {
    purchaseContextRequestGenerationRef.current += 1;
    purchaseContextAbortControllerRef.current?.abort();
    purchaseContextAbortControllerRef.current = null;
    setIsLoadingPurchaseContext(false);
  }, []);

  const invalidateProductsRequest = React.useCallback(() => {
    productsRequestGenerationRef.current += 1;
    productsAbortControllerRef.current?.abort();
    productsAbortControllerRef.current = null;
    setIsLoadingProducts(false);
  }, []);

  const invalidateRedemptionRequest = React.useCallback(() => {
    redemptionRequestGenerationRef.current += 1;
    redemptionAbortControllerRef.current?.abort();
    redemptionAbortControllerRef.current = null;
  }, []);

  const invalidateQuotaRefresh = React.useCallback(() => {
    quotaRefreshGenerationRef.current += 1;
    quotaRefreshAbortControllerRef.current?.abort();
    quotaRefreshAbortControllerRef.current = null;
    fulfilledRefreshGenerationRef.current += 1;
    fulfilledRefreshAbortControllerRef.current?.abort();
    fulfilledRefreshAbortControllerRef.current = null;
    billingService.clearBillingCache();
  }, []);

  const invalidatePaymentRefreshLifecycle = React.useCallback(() => {
    paymentRefreshLifecycleGenerationRef.current += 1;
    invalidateQuotaRefresh();
  }, [invalidateQuotaRefresh]);

  const refreshProducts = React.useCallback(async () => {
    const generation = productsRequestGenerationRef.current + 1;
    productsRequestGenerationRef.current = generation;
    productsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    productsAbortControllerRef.current = controller;
    setIsLoadingProducts(true);
    try {
      const response = await billingService.getProducts({ signal: controller.signal });
      if (generation !== productsRequestGenerationRef.current) return null;
      setProducts(response.products);
      setCatalogVersion(response.catalog_version);
      setPaymentsEnabled(response.payments_enabled);
      return response;
    } catch (productError) {
      if (generation !== productsRequestGenerationRef.current || controller.signal.aborted) return null;
      console.warn('Failed to load billing products', productError);
      setProducts([]);
      setCatalogVersion(null);
      setPaymentsEnabled(false);
      return null;
    } finally {
      if (generation === productsRequestGenerationRef.current) {
        productsAbortControllerRef.current = null;
        setIsLoadingProducts(false);
      }
    }
  }, []);

  const refreshPurchaseContext = React.useCallback(async () => {
    const generation = purchaseContextRequestGenerationRef.current + 1;
    purchaseContextRequestGenerationRef.current = generation;
    purchaseContextAbortControllerRef.current?.abort();
    const controller = new AbortController();
    purchaseContextAbortControllerRef.current = controller;
    setPurchaseContext(null);
    setPurchaseContextError('');
    setIsLoadingPurchaseContext(true);
    try {
      const nextContext = await billingService.getPaymentPurchaseContext({ signal: controller.signal });
      if (generation !== purchaseContextRequestGenerationRef.current) return null;
      if (purchaseContextTokenRef.current !== nextContext.payment_state_token) {
        acknowledgedPaymentStateTokenRef.current = null;
      }
      purchaseContextTokenRef.current = nextContext.payment_state_token;
      setPurchaseContext(nextContext);
      if (nextContext.latest_order) rememberOrderForCheckoutRecovery(nextContext.latest_order);
      return nextContext;
    } catch (contextError) {
      if (generation !== purchaseContextRequestGenerationRef.current || controller.signal.aborted) return null;
      console.warn('Failed to load payment purchase context', contextError);
      setPurchaseContextError('购买上下文加载失败，请刷新后再试。');
      return null;
    } finally {
      if (generation === purchaseContextRequestGenerationRef.current) {
        purchaseContextAbortControllerRef.current = null;
        setIsLoadingPurchaseContext(false);
      }
    }
  }, [rememberOrderForCheckoutRecovery]);

  const recoverCheckoutSubmission = React.useCallback((order: PaymentOrder) => {
    clearCheckoutSubmitWatchdog();
    checkoutRequestGenerationRef.current += 1;
    checkoutInFlightGenerationRef.current = null;
    setCheckoutForm(null);
    setIsPurchasing(false);
    setIsCheckoutSubmitting(false);
    setPaymentStatus(order.status);
    rememberOrderForCheckoutRecovery(order);
    setOrdersError('未能跳转至收银台，订单已保留。请在订单列表点击“继续支付”。');
    setActiveView('orders');
  }, [clearCheckoutSubmitWatchdog, rememberOrderForCheckoutRecovery]);

  const armCheckoutSubmitWatchdog = React.useCallback((
    order: PaymentOrder,
    submission: PaymentCheckoutSubmission,
  ) => {
    if (!checkoutSubmissionControllerRef.current.shouldRecoverFromWatchdog(submission)) return;
    clearCheckoutSubmitWatchdog();
    checkoutSubmitWatchdogRef.current = window.setTimeout(() => {
      checkoutSubmitWatchdogRef.current = null;
      if (!checkoutSubmissionControllerRef.current.shouldRecoverFromWatchdog(submission)) return;
      recoverCheckoutSubmission(order);
    }, 10_000);
  }, [clearCheckoutSubmitWatchdog, recoverCheckoutSubmission]);

  const clearRedemptionPresentation = React.useCallback(() => {
    setRedemptionCode('');
    setRedemptionMessage('');
    setRedemptionError('');
  }, []);

  const refresh = React.useCallback(async (options?: { preserveError?: boolean }) => {
    const lifecycleGeneration = paymentRefreshLifecycleGenerationRef.current;
    invalidateQuotaRefresh();
    const refreshGeneration = quotaRefreshGenerationRef.current;
    const controller = new AbortController();
    quotaRefreshAbortControllerRef.current = controller;
    setIsLoading(true);
    if (!options?.preserveError) setError('');
    try {
      const [nextSummary, usage] = await Promise.all([
        billingService.getSummary({ force: true, signal: controller.signal }),
        billingService.getUsage(80, { signal: controller.signal }),
      ]);
      if (
        controller.signal.aborted
        || paymentRefreshLifecycleGenerationRef.current !== lifecycleGeneration
        || quotaRefreshGenerationRef.current !== refreshGeneration
      ) return;
      onSummaryChange(nextSummary);
      setUsageEvents(usage.events);
      setUsageByDay(usage.usage_by_day);
      setUsageByEntrypoint(usage.usage_by_entrypoint);
    } catch (fetchError) {
      if (
        controller.signal.aborted
        || paymentRefreshLifecycleGenerationRef.current !== lifecycleGeneration
        || quotaRefreshGenerationRef.current !== refreshGeneration
      ) return;
      console.error(fetchError);
      if (!options?.preserveError) setError('额度信息加载失败，请稍后重试。');
    } finally {
      if (quotaRefreshGenerationRef.current === refreshGeneration) {
        quotaRefreshAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [invalidateQuotaRefresh, onSummaryChange]);

  const refreshFulfilledOrderData = React.useCallback((order: PaymentOrder, reportError: boolean) => {
    invalidateQuotaRefresh();
    setIsLoading(false);
    const lifecycleGeneration = paymentRefreshLifecycleGenerationRef.current;
    const refreshGeneration = fulfilledRefreshGenerationRef.current;
    const controller = new AbortController();
    fulfilledRefreshAbortControllerRef.current = controller;

    if (order.summary) {
      onSummaryChange(order.summary);
    }

    void (async () => {
      const [summaryResult, usageResult] = await Promise.allSettled([
        order.summary
          ? Promise.resolve<TokenQuotaSummary | null>(null)
          : billingService.getSummary({ force: true, signal: controller.signal }),
        billingService.getUsage(80, { signal: controller.signal }),
      ]);
      const isCurrent = (
        !controller.signal.aborted
        && paymentRefreshLifecycleGenerationRef.current === lifecycleGeneration
        && fulfilledRefreshGenerationRef.current === refreshGeneration
      );
      if (!isCurrent) return;

      if (summaryResult.status === 'fulfilled' && summaryResult.value) {
        onSummaryChange(summaryResult.value);
      } else if (summaryResult.status === 'rejected') {
        console.warn('Payment fulfilled but quota summary refresh failed', summaryResult.reason);
      }
      if (usageResult.status === 'fulfilled') {
        setUsageEvents(usageResult.value.events);
        setUsageByDay(usageResult.value.usage_by_day);
        setUsageByEntrypoint(usageResult.value.usage_by_entrypoint);
      } else {
        console.warn('Payment fulfilled but usage refresh failed', usageResult.reason);
      }
      if (reportError && (summaryResult.status === 'rejected' || usageResult.status === 'rejected')) {
        setError('权益已到账，但额度明细刷新失败，请手动刷新。');
      }
    })().catch((refreshError) => {
      const isCurrent = (
        !controller.signal.aborted
        && paymentRefreshLifecycleGenerationRef.current === lifecycleGeneration
        && fulfilledRefreshGenerationRef.current === refreshGeneration
      );
      if (!isCurrent) return;
      console.warn('Payment fulfilled but post-payment refresh failed', refreshError);
      if (reportError) setError('权益已到账，但额度明细刷新失败，请手动刷新。');
    }).finally(() => {
      if (fulfilledRefreshGenerationRef.current === refreshGeneration) {
        fulfilledRefreshAbortControllerRef.current = null;
      }
    });
  }, [invalidateQuotaRefresh, onSummaryChange]);

  React.useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  React.useEffect(() => {
    if (!isOpen) {
      invalidatePaymentRefreshLifecycle();
      invalidateRedemptionRequest();
      setIsLoading(false);
      setIsRedeeming(false);
      clearCheckoutSubmitWatchdog();
      invalidateCheckoutRequest();
      invalidateOrderLoadRequests();
      invalidatePurchaseContextRequest();
      invalidateProductsRequest();
      setPurchaseContext(null);
      setCatalogVersion(null);
      setActiveView('overview');
      return;
    }
    if (initialView === 'purchase' || returnedPaymentOrderId) {
      setActiveView('purchase');
    }
  }, [clearCheckoutSubmitWatchdog, initialView, invalidateCheckoutRequest, invalidateOrderLoadRequests, invalidatePaymentRefreshLifecycle, invalidateProductsRequest, invalidatePurchaseContextRequest, invalidateRedemptionRequest, isOpen, returnedPaymentOrderId]);

  React.useLayoutEffect(() => {
    if (!isOpen) {
      invalidatePaymentRefreshLifecycle();
      invalidateRedemptionRequest();
    }
    return () => {
      invalidatePaymentRefreshLifecycle();
      invalidateRedemptionRequest();
    };
  }, [invalidatePaymentRefreshLifecycle, invalidateRedemptionRequest, isOpen]);

  React.useEffect(() => () => {
    clearCheckoutSubmitWatchdog();
    invalidateCheckoutRequest();
    invalidateOrderLoadRequests();
    invalidatePurchaseContextRequest();
    invalidateProductsRequest();
  }, [clearCheckoutSubmitWatchdog, invalidateCheckoutRequest, invalidateOrderLoadRequests, invalidateProductsRequest, invalidatePurchaseContextRequest]);

  React.useEffect(() => {
    if (!isOpen) return;
    const animationFrame = window.requestAnimationFrame(() => {
      if (activeView !== 'overview') {
        backButtonRef.current?.focus();
      } else if (restorePurchaseButtonFocusRef.current) {
        restorePurchaseButtonFocusRef.current = false;
        purchaseButtonRef.current?.focus();
      } else {
        dialogRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeView, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    void refreshProducts();
    return invalidateProductsRequest;
  }, [invalidateProductsRequest, isOpen, refreshProducts]);

  const coordinatePaymentDataRefresh = React.useCallback(() => {
    const lifecycleGeneration = paymentRefreshLifecycleGenerationRef.current;
    return coordinatePaymentOrdersAndContextRefresh(
      loadOrders,
      refreshPurchaseContext,
      () => paymentRefreshLifecycleGenerationRef.current === lifecycleGeneration,
    );
  }, [loadOrders, refreshPurchaseContext]);

  React.useEffect(() => {
    if (!isOpen) return;
    // Order history and purchase context fail independently. A temporary
    // history outage must not leave the direct purchase page disabled.
    void coordinatePaymentDataRefresh();
  }, [coordinatePaymentDataRefresh, isOpen]);

  React.useEffect(() => {
    if (!isOpen || activeView !== 'orders' || checkoutReturnSyncOrderId) return;
    void coordinatePaymentDataRefresh();
    const timer = window.setInterval(() => {
      touchOrdersNow();
      void loadOrders({ replayLoadedDepth: true });
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      invalidateOrderLoadRequests();
    };
  }, [activeView, checkoutReturnSyncOrderId, coordinatePaymentDataRefresh, invalidateOrderLoadRequests, isOpen, loadOrders, touchOrdersNow]);

  React.useEffect(() => {
    if (!isOpen || activeView !== 'purchase' || !checkoutForm || !checkoutFormRef.current) return;
    const form = checkoutFormRef.current;
    const { order } = checkoutForm;
    setIsCheckoutSubmitting(true);
    const submission = checkoutSubmissionControllerRef.current.beginSubmission(order.id);
    armCheckoutSubmitWatchdog(order, submission);
    try {
      form.submit();
      armCheckoutSubmitWatchdog(order, submission);
    } catch (submitError) {
      console.warn('Failed to submit payment checkout form', submitError);
      checkoutSubmissionControllerRef.current.invalidate();
      recoverCheckoutSubmission(order);
      return;
    }
    setCheckoutForm(null);
  }, [activeView, armCheckoutSubmitWatchdog, checkoutForm, isOpen, recoverCheckoutSubmission]);

  const finishReturnedOrder = React.useCallback(async (order: PaymentOrder, consumeReturnedOrder = false) => {
    if (consumeReturnedOrder) setPaymentStatus(order.status);
    if (order.status !== 'fulfilled') return false;
    if (consumeReturnedOrder && order.id === returnedPaymentOrderId) {
      onPaymentOrderHandled?.();
    }
    refreshFulfilledOrderData(order, consumeReturnedOrder);
    return true;
  }, [onPaymentOrderHandled, refreshFulfilledOrderData, returnedPaymentOrderId]);

  React.useEffect(() => {
    if (!isOpen || !returnedPaymentOrderId || returnedOrderRef.current === returnedPaymentOrderId) return;
    returnedOrderRef.current = returnedPaymentOrderId;
    setError('');
    setCanRetryPaymentSync(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const inspectOrder = async (shouldSync: boolean) => {
      try {
        setPaymentStatus('processing');
        const order = shouldSync
          ? await billingService.syncPaymentOrder(returnedPaymentOrderId)
          : await billingService.getPaymentOrder(returnedPaymentOrderId);
        if (cancelled) return;
        rememberOrderForCheckoutRecovery(order);
        if (await finishReturnedOrder(order, true)) {
          void refreshPurchaseContext();
          return;
        }
        await refreshPurchaseContext();
        if (cancelled) return;
        if (order.status === 'failed' || order.status === 'expired' || order.status === 'cancelled') {
          onPaymentOrderHandled?.();
          return;
        }
        attempts += 1;
        if (attempts < 6) {
          timer = setTimeout(() => { void inspectOrder(false); }, 1_500);
        } else {
          returnedOrderRef.current = null;
          setCanRetryPaymentSync(true);
          setError('支付状态仍在确认中，您可以重新查询。');
        }
      } catch (syncError) {
        console.warn('Failed to sync payment order', syncError);
        if (!cancelled) {
          returnedOrderRef.current = null;
          setCanRetryPaymentSync(true);
          setError('支付状态暂时无法确认，请重新查询。');
        }
      }
    };
    void inspectOrder(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (returnedOrderRef.current === returnedPaymentOrderId) {
        returnedOrderRef.current = null;
      }
    };
  }, [finishReturnedOrder, isOpen, onPaymentOrderHandled, paymentSyncRetryRequest, refreshPurchaseContext, rememberOrderForCheckoutRecovery, returnedPaymentOrderId]);

  const retryReturnedPaymentOrder = () => {
    if (!returnedPaymentOrderId) return;
    returnedOrderRef.current = null;
    setCanRetryPaymentSync(false);
    setError('');
    setPaymentSyncRetryRequest((request) => request + 1);
  };

  const updateListedOrder = rememberOrderForCheckoutRecovery;

  React.useEffect(() => {
    const handlePageHide = () => {
      checkoutSubmissionControllerRef.current.markPageHidden();
      clearCheckoutSubmitWatchdog();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const orderId = checkoutSubmissionControllerRef.current.consumePersistedPageShow();
      resetCheckoutAfterExternalReturn();
      if (orderId) setCheckoutReturnSyncOrderId(orderId);
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      clearCheckoutSubmitWatchdog();
    };
  }, [clearCheckoutSubmitWatchdog, resetCheckoutAfterExternalReturn]);

  React.useEffect(() => {
    if (!checkoutReturnSyncOrderId) return;
    const orderId = checkoutReturnSyncOrderId;
    let cancelled = false;
    invalidateOrderLoadRequests();
    setActiveView('orders');
    setOrdersError('');
    const syncReturnedCheckout = async () => {
      try {
        const order = await billingService.syncPaymentOrder(orderId);
        if (cancelled) return;
        updateListedOrder(order);
        setPaymentStatus(order.status);
        await finishReturnedOrder(order);
        await refreshPurchaseContext();
      } catch (syncError) {
        if (!cancelled) {
          console.warn('Failed to sync payment order after returning from checkout', syncError);
          setOrdersError('已返回应用，但支付状态暂时无法确认。请在订单列表中重新查询。');
        }
      } finally {
        if (!cancelled) {
          setCheckoutReturnSyncOrderId(null);
          // The orders effect starts a fresh generation after sync is released,
          // so a response started before the sync cannot overwrite this order.
        }
      }
    };
    void syncReturnedCheckout();
    return () => { cancelled = true; };
  }, [checkoutReturnSyncOrderId, finishReturnedOrder, invalidateOrderLoadRequests, refreshPurchaseContext, updateListedOrder]);

  const handlePurchase = async (product: BillingProduct) => {
    if (isPurchasing || isCheckoutSubmitting || !paymentsEnabled) return;
    const observedPaymentStateToken = purchaseContext?.payment_state_token;
    const observedCatalogVersion = catalogVersion;
    if (!observedPaymentStateToken || !observedCatalogVersion) {
      setError('购买上下文尚未就绪，请刷新后再试。');
      void refreshPurchaseContext();
      return;
    }
    if (requiresRepeatPurchaseAcknowledgement(
      observedPaymentStateToken,
      purchaseContext.latest_order,
      acknowledgedPaymentStateTokenRef.current,
    )) {
      acknowledgedPaymentStateTokenRef.current = observedPaymentStateToken;
      if (purchaseContext.latest_order) updateListedOrder(purchaseContext.latest_order);
      setError('最近订单已支付或到账；如确需再次购买，请再次点击购买。');
      return;
    }
    const requestGeneration = beginCheckoutRequest();
    if (requestGeneration === null) return;
    const requestSignal = checkoutAbortControllerRef.current?.signal;
    setIsPurchasing(true);
    setPaymentStatus('creating');
    setError('');
    try {
      const idempotencyKey = getOrCreatePurchaseIdempotencyKey(
        purchaseIdempotencyKeysRef.current,
        product.sku,
        () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `billing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const order = await billingService.createPaymentOrder(
        product.sku,
        idempotencyKey,
        observedPaymentStateToken,
        observedCatalogVersion,
        { signal: requestSignal },
      );
      if (!isCheckoutRequestCurrent(requestGeneration)) return;
      purchaseOrderIdsRef.current.set(product.sku, order.id);
      updateListedOrder(order);
      setPaymentStatus(order.status);
      if (order.status !== 'pending' && order.status !== 'cancelled' && order.status !== 'expired') {
        setPaymentStatus(order.status);
        setOrdersError('订单状态已变化，请确认最新状态后再继续。');
        setActiveView('orders');
        await refreshPurchaseContext();
        return;
      }
      try {
        const checkout = await billingService.getPaymentCheckout(order.id, { signal: requestSignal });
        if (!isCheckoutRequestCurrent(requestGeneration)) return;
        setPaymentStatus(checkout.order.status);
        setIsCheckoutSubmitting(true);
        setCheckoutForm(checkout);
      } catch (checkoutError) {
        if (!isCheckoutRequestCurrent(requestGeneration)) return;
        console.warn('Failed to load checkout for created payment order', checkoutError);
        updateListedOrder(order);
        const checkoutConflict = resolveUnsettledPaymentOrderConflict(checkoutError);
        setOrdersError(checkoutConflict
          ? paymentOrderConflictMessage(checkoutConflict)
          : '订单已创建，但暂时无法打开收银台。请稍后点击“继续支付”。');
        setActiveView('orders');
        await refreshPurchaseContext();
      }
    } catch (purchaseError) {
      if (!isCheckoutRequestCurrent(requestGeneration)) return;
      const unsettledConflict = resolveUnsettledPaymentOrderConflict(purchaseError);
      if (unsettledConflict) {
        if (unsettledConflict.code === 'payment_order_state_changed') {
          acknowledgedPaymentStateTokenRef.current = null;
        }
        setCheckoutForm(null);
        setIsCheckoutSubmitting(false);
        setPaymentStatus(null);
        finishCheckoutRequest(requestGeneration);
        if (unsettledConflict.code === 'payment_catalog_changed') {
          purchaseIdempotencyKeysRef.current.delete(product.sku);
          purchaseOrderIdsRef.current.delete(product.sku);
          setOrdersError('');
          setError(paymentOrderConflictMessage(unsettledConflict));
          await Promise.all([refreshProducts(), refreshPurchaseContext()]);
          return;
        }
        setError('');
        if (unsettledConflict.code === 'payment_order_state_changed') {
          purchaseIdempotencyKeysRef.current.delete(product.sku);
          purchaseOrderIdsRef.current.delete(product.sku);
        }
        setOrdersError(paymentOrderConflictMessage(unsettledConflict));
        setActiveView('orders');
        if (unsettledConflict.latestOrder) updateListedOrder(unsettledConflict.latestOrder);
        if (unsettledConflict.orderId) {
          try {
            const order = await billingService.getPaymentOrder(unsettledConflict.orderId);
            if (checkoutRequestGenerationRef.current !== requestGeneration) return;
            updateListedOrder(order);
          } catch (orderError) {
            console.warn('Failed to load unsettled payment order', orderError);
          }
        }
        await refreshPurchaseContext();
        return;
      }
      const rateLimitMessage = paymentOrderCreationRateLimitMessage(purchaseError);
      if (rateLimitMessage) {
        setPaymentStatus('failed');
        setError(rateLimitMessage);
        return;
      }
      console.warn('Failed to create payment order');
      setPaymentStatus('failed');
      setError('订单创建失败，请稍后重试。');
    } finally {
      finishCheckoutRequest(requestGeneration);
    }
  };

  const handleRedeem = async () => {
    const code = redemptionCode.trim();
    if (!code || isRedeeming) return;
    const lifecycleGeneration = paymentRefreshLifecycleGenerationRef.current;
    const requestGeneration = redemptionRequestGenerationRef.current + 1;
    redemptionRequestGenerationRef.current = requestGeneration;
    redemptionAbortControllerRef.current?.abort();
    const controller = new AbortController();
    redemptionAbortControllerRef.current = controller;
    const isCurrent = () => (
      !controller.signal.aborted
      && paymentRefreshLifecycleGenerationRef.current === lifecycleGeneration
      && redemptionRequestGenerationRef.current === requestGeneration
    );
    setIsRedeeming(true);
    setRedemptionMessage('');
    setRedemptionError('');
    try {
      const result = await billingService.redeemCode(code, { signal: controller.signal });
      if (!isCurrent()) return;
      onSummaryChange(result.summary);
      setRedemptionCode('');
      if (result.tokens > 0) {
        setRedemptionMessage(`已兑换 ${formatTokens(result.tokens)} Tokens，来自 ${result.package_name}`);
      } else if (result.summary.is_unlimited) {
        setRedemptionMessage(`无限额度有效至 ${formatDateTime(result.summary.unlimited_expires_at)}，来自 ${result.package_name}`);
      } else {
        setRedemptionMessage(`已兑换 ${formatTokens(result.tokens)} Tokens，来自 ${result.package_name}`);
      }
      void refresh({ preserveError: true });
    } catch {
      if (!isCurrent()) return;
      console.warn('Redemption request failed');
      setRedemptionCode('');
      setRedemptionError('卡密兑换失败，请检查卡密或联系管理员。');
    } finally {
      if (isCurrent()) {
        redemptionAbortControllerRef.current = null;
        setIsRedeeming(false);
      }
    }
  };

  const handleContinuePayment = async (order: PaymentOrder) => {
    if (isCheckoutSubmitting) return;
    const actionRequest = beginOrderAction();
    if (actionRequest === null) return;
    const requestGeneration = beginCheckoutRequest();
    if (requestGeneration === null) {
      finishOrderAction(actionRequest);
      return;
    }
    markOrderAction(order.id);
    setIsPurchasing(true);
    setError('');
    try {
      const requestSignal = checkoutAbortControllerRef.current?.signal;
      const checkout = await billingService.getPaymentCheckout(order.id, { signal: requestSignal });
      if (!isCheckoutRequestCurrent(requestGeneration) || !isOrderActionCurrent(actionRequest)) return;
      updateListedOrder(checkout.order);
      setPaymentStatus(checkout.order.status);
      setIsCheckoutSubmitting(true);
      setCheckoutForm(checkout);
      setActiveView('purchase');
    } catch (checkoutError) {
      if (!isCheckoutRequestCurrent(requestGeneration) || !isOrderActionCurrent(actionRequest)) return;
      console.warn('Failed to resume payment order', checkoutError);
      const unsettledConflict = resolveUnsettledPaymentOrderConflict(checkoutError);
      if (unsettledConflict) {
        setOrdersError(paymentOrderConflictMessage(unsettledConflict));
        if (unsettledConflict.latestOrder) updateListedOrder(unsettledConflict.latestOrder);
        if (unsettledConflict.orderId) {
          try {
            const nextOrder = await billingService.getPaymentOrder(unsettledConflict.orderId);
            if (checkoutRequestGenerationRef.current === requestGeneration) updateListedOrder(nextOrder);
          } catch (orderError) {
            console.warn('Failed to load conflicted payment order', orderError);
          }
        }
        await refreshPurchaseContext();
      } else {
        setOrdersError('订单无法继续支付，请刷新后重试。');
      }
    } finally {
      finishCheckoutRequest(requestGeneration);
      finishOrderAction(actionRequest);
    }
  };

  const handleSyncOrder = async (order: PaymentOrder) => {
    const actionRequest = beginOrderAction();
    if (actionRequest === null) return;
    markOrderAction(order.id);
    setOrdersError('');
    try {
      const nextOrder = await billingService.syncPaymentOrder(order.id, {
        signal: actionRequest.abortController.signal,
      });
      if (!isOrderActionCurrent(actionRequest)) return;
      updateListedOrder(nextOrder);
      await finishReturnedOrder(nextOrder, nextOrder.id === returnedPaymentOrderId);
      if (!isOrderActionCurrent(actionRequest)) return;
      await refreshPurchaseContext();
    } catch (syncError) {
      if (!isOrderActionCurrent(actionRequest)) return;
      console.warn('Failed to sync listed payment order', syncError);
      setOrdersError('订单状态暂时无法确认，请稍后重试。');
    } finally {
      finishOrderAction(actionRequest);
    }
  };

  const handleCancelOrder = async (order: PaymentOrder) => {
    const actionRequest = beginOrderAction();
    if (actionRequest === null) return;
    markOrderAction(order.id);
    setOrdersError('');
    try {
      const nextOrder = await billingService.cancelPaymentOrder(order.id, {
        signal: actionRequest.abortController.signal,
      });
      if (!isOrderActionCurrent(actionRequest)) return;
      updateListedOrder(nextOrder);
      touchOrdersNow();
      await refreshPurchaseContext();
    } catch (cancelError) {
      if (!isOrderActionCurrent(actionRequest)) return;
      console.warn('Failed to cancel payment order', cancelError);
      setOrdersError('订单取消失败，请刷新后重试。');
    } finally {
      finishOrderAction(actionRequest);
    }
  };

  const openPurchaseView = () => {
    setError('');
    setActiveView('purchase');
    if (!purchaseContext) void refreshPurchaseContext();
    if (!catalogVersion) void refreshProducts();
  };

  const returnToOverview = () => {
    if (isCheckoutSubmitting) return;
    invalidateCheckoutRequest();
    setError('');
    clearRedemptionPresentation();
    restorePurchaseButtonFocusRef.current = true;
    setActiveView('overview');
  };

  const returnToPurchase = () => {
    if (isCheckoutSubmitting) return;
    invalidateCheckoutRequest();
    setError('');
    setOrdersError('');
    setActiveView('purchase');
    void refreshPurchaseContext();
  };

  const handleRepeatPurchase = async (order: PaymentOrder) => {
    if (!paymentsEnabled) {
      setOrdersError('在线支付暂未开放，请稍后重试。');
      return;
    }
    const product = products.find((candidate) => candidate.sku === order.sku);
    if (!product) {
      setOrdersError('该套餐已下架或已更新，无法再次下单。请返回购买套餐重新选择。');
      void refreshProducts();
      return;
    }
    clearPurchaseAttemptForTerminalOrder(order);
    setOrdersError('');
    setActiveView('purchase');
    await handlePurchase(product);
  };

  const handleClose = () => {
    const focusTarget = returnFocusElement;
    if (isCheckoutSubmitting) return;
    invalidatePaymentRefreshLifecycle();
    invalidateRedemptionRequest();
    setIsRedeeming(false);
    invalidateCheckoutRequest();
    invalidateOrderLoadRequests();
    invalidatePurchaseContextRequest();
    invalidateProductsRequest();
    clearRedemptionPresentation();
    restorePurchaseButtonFocusRef.current = false;
    setActiveView('overview');
    onClose();
    window.requestAnimationFrame(() => {
      const visibleAvatarButton = Array.from(document.querySelectorAll<HTMLElement>('[data-token-quota-focus-return]'))
        .find((element) => element.offsetParent !== null);
      const visibleFocusTarget = focusTarget?.isConnected && focusTarget.offsetParent !== null
        ? focusTarget
        : visibleAvatarButton;
      visibleFocusTarget?.focus();
    });
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isCheckoutSubmitting) return;
      if (activeView === 'orders') {
        returnToPurchase();
      } else if (activeView === 'purchase') {
        returnToOverview();
      } else {
        handleClose();
      }
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.hasAttribute('hidden')
      && element.getAttribute('aria-hidden') !== 'true'
      && element.offsetParent !== null
    ));
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && (activeElement === lastElement || !dialog.contains(activeElement))) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-quota-dialog-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-950"
      >
        {/* 头部区域 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5 dark:border-gray-800">
          {activeView !== 'overview' ? (
            <div className="flex items-center gap-2.5">
              <button
                ref={backButtonRef}
                type="button"
                disabled={activeView === 'purchase' && isCheckoutSubmitting}
                onClick={activeView === 'orders' ? returnToPurchase : returnToOverview}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-gray-800 dark:hover:text-white dark:focus:ring-emerald-500/20"
                aria-label={activeView === 'orders' ? '返回购买套餐' : '返回额度概览'}
                title={activeView === 'orders' ? '返回购买套餐' : '返回额度概览'}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h2 id="token-quota-dialog-title" className="text-sm font-extrabold text-gray-900 dark:text-white">{activeView === 'orders' ? '我的订单' : '购买套餐'}</h2>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">{activeView === 'orders' ? '查看过往已创建订单' : '选择套餐后将直接跳转支付'}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <h2 id="token-quota-dialog-title" className="text-sm font-extrabold text-gray-900 dark:text-white">额度</h2>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">AI 服务 token 用量</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {activeView === 'overview' && (
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                aria-label="刷新额度"
                title="刷新额度"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
            {activeView === 'purchase' && (
              <button
                type="button"
                disabled={isCheckoutSubmitting}
                onClick={() => {
                  invalidateCheckoutRequest();
                  clearRedemptionPresentation();
                  setOrdersError('');
                  setActiveView('orders');
                }}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 focus:ring-emerald-200 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:focus:ring-emerald-500/20"
              >
                我的订单
              </button>
            )}
            <button
              type="button"
              disabled={isCheckoutSubmitting}
              onClick={handleClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-gray-800 dark:hover:text-white"
              aria-label="关闭额度弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {activeView === 'overview' ? (
          /* 额度概览与套餐页条件卸载，避免不可见控件仍进入键盘焦点 */
          <div className="min-h-0 space-y-4 overflow-y-auto p-4" data-quota-view="overview">
            <QuotaDashboard
              summary={summary}
              onOpenPurchase={openPurchaseView}
              purchaseButtonRef={purchaseButtonRef}
            />

            {error && (
              <div role="alert" aria-live="assertive" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-400">
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
          </div>
        ) : activeView === 'purchase' ? (
          <div className="min-h-0 space-y-5 overflow-y-auto p-4 sm:p-5" data-quota-view="purchase">
            <PurchaseCatalog
              products={products}
              paymentsEnabled={paymentsEnabled}
              isLoading={isLoadingProducts}
              isPurchasing={isPurchasing}
              isCheckoutSubmitting={isCheckoutSubmitting}
              isPurchaseContextReady={Boolean(purchaseContext && catalogVersion) && !isLoadingPurchaseContext && !isLoadingProducts}
              paymentStatus={paymentStatus}
              onPurchase={handlePurchase}
            />

            {(error || purchaseContextError) && (
              <div role="alert" aria-live="assertive" className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                <span>{error || purchaseContextError}</span>
                {canRetryPaymentSync && returnedPaymentOrderId && (
                  <button
                    type="button"
                    onClick={retryReturnedPaymentOrder}
                    className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                  >
                    重新查询支付状态
                  </button>
                )}
              </div>
            )}

            {isLoadingPurchaseContext && (
              <p role="status" aria-live="polite" className="mx-auto max-w-3xl text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                正在确认最新订单状态，完成后可购买。
              </p>
            )}

            {SHOW_REDEMPTION_CARD && (
              <div className="mx-auto max-w-3xl border-t border-gray-100 pt-5 dark:border-gray-800">
                <RedemptionCard
                  code={redemptionCode}
                  isRedeeming={isRedeeming}
                  redemptionMessage={redemptionMessage}
                  redemptionError={redemptionError}
                  onCodeChange={setRedemptionCode}
                  onRedeem={handleRedeem}
                />
              </div>
            )}

          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
            <PaymentOrdersPanel
              orders={orders}
              isLoading={isLoadingOrders}
              isLoadingMore={isLoadingMoreOrders}
              hasMore={ordersHasMore}
              error={ordersError}
              now={ordersNow}
              actionOrderId={orderActionId}
              onRefresh={() => void coordinatePaymentDataRefresh()}
              onLoadMore={() => void loadOrders({ append: true })}
              onContinuePayment={(order) => void handleContinuePayment(order)}
              onSync={(order) => void handleSyncOrder(order)}
              onCancel={(order) => void handleCancelOrder(order)}
              onRepeatPurchase={(order) => void handleRepeatPurchase(order)}
              onSelectNewPurchase={returnToPurchase}
            />
          </div>
        )}
        {activeView === 'purchase' && checkoutForm && (
          <form ref={checkoutFormRef} action={checkoutForm.action} method={checkoutForm.method} className="hidden" aria-hidden="true">
            {Object.entries(checkoutForm.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
          </form>
        )}
      </div>
    </div>
  );
};

export default TokenQuotaModal;
