import React from 'react';
import { ArrowLeft, BarChart3, CreditCard, KeyRound, LoaderCircle, RefreshCw, TrendingUp, Wallet, X } from 'lucide-react';
import {
  billingService,
  type BillingProduct,
  type PaymentCheckoutForm,
  type PaymentOrder,
  type TokenQuotaSummary,
  type TokenUsageAggregate,
  type TokenUsageEvent,
} from '../services/billingService';

type QuotaModalView = 'overview' | 'purchase';

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
          <span>购买额度 / 兑换卡密</span>
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
    case 'expired': return '订单已过期，请重新选择套餐。';
    case 'failed': return '订单未完成，请重试或选择其他套餐。';
    default: return '';
  }
};

const PurchaseCatalog: React.FC<{
  products: BillingProduct[];
  paymentsEnabled: boolean;
  isLoading: boolean;
  isPurchasing: boolean;
  paymentStatus: PaymentUiStatus;
  onPurchase: (product: BillingProduct) => void;
}> = ({ products, paymentsEnabled, isLoading, isPurchasing, paymentStatus, onPurchase }) => {
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
    const benefit = isUnlimited
      ? `${product.unlimited_duration_days ?? 0} 天不限量`
      : `${formatTokens(product.token_amount)} Tokens`;
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
        <p className="mt-3 min-h-8 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{product.description}</p>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <strong className={`text-xl tracking-tight ${isUnlimited ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatPrice(product.amount_fen, product.currency)}</strong>
          {paymentsEnabled && (
            <button
              type="button"
              disabled={isPurchasing}
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
    return <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">在线支付暂未开放；您仍可使用下方卡密兑换。</div>;
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
        <p className="mt-2 text-[10px] font-semibold text-gray-400">易付通收银台 · 一次购买 · 不自动续费</p>
        {paymentStatus && (
          <p role="status" aria-live="polite" className={`mt-2 text-[10px] font-bold ${paymentStatus === 'fulfilled' ? 'text-emerald-600 dark:text-emerald-400' : paymentStatus === 'failed' || paymentStatus === 'expired' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-300'}`}>
            {paymentStatusCopy(paymentStatus)}
          </p>
        )}
      </div>
      {!paymentsEnabled && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
          在线支付暂未开放；套餐购买按钮已隐藏，您仍可使用卡密兑换。
        </div>
      )}
      <div
        id="billing-plan-panel"
        role="tabpanel"
        aria-labelledby={`billing-tab-${activeTab}`}
        className="animate-in fade-in slide-in-from-bottom-1 duration-200"
      >
        <div className={`grid grid-cols-1 gap-2 ${activeTab === 'tokens' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          {activeProducts.map(renderProduct)}
        </div>
      </div>
    </section>
  );
};

// ==========================================
// 卡密兑换卡片
// ==========================================
const RedemptionCard: React.FC<{
  code: string;
  isRedeeming: boolean;
  redemptionMessage: string;
  onCodeChange: (value: string) => void;
  onRedeem: () => void;
}> = ({
  code,
  isRedeeming,
  redemptionMessage,
  onCodeChange,
  onRedeem,
}) => {
  return (
    <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-teal-50/20 p-4 shadow-sm dark:border-emerald-500/10 dark:from-emerald-950/10 dark:to-teal-950/5">
      <div className="flex flex-col gap-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
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
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2.5">
              输入您的卡密以兑换对应的 AI 服务额度。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="RF-XXXX-XXXX-XXXX-XXXX"
                className="h-9 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold tracking-wide text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-gray-800 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-700 dark:focus:border-emerald-500 dark:focus:ring-emerald-500/10"
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
              <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                {redemptionMessage}
              </div>
            )}
          </div>
        </form>
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
  const [isLoading, setIsLoading] = React.useState(false);
  const [isRedeeming, setIsRedeeming] = React.useState(false);
  const [activeView, setActiveView] = React.useState<QuotaModalView>('overview');
  const [error, setError] = React.useState('');
  const [products, setProducts] = React.useState<BillingProduct[]>([]);
  const [paymentsEnabled, setPaymentsEnabled] = React.useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = React.useState(false);
  const [isPurchasing, setIsPurchasing] = React.useState(false);
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentUiStatus>(null);
  const [checkoutForm, setCheckoutForm] = React.useState<PaymentCheckoutForm | null>(null);
  const checkoutFormRef = React.useRef<HTMLFormElement | null>(null);
  const returnedOrderRef = React.useRef<string | null>(null);
  const purchaseInFlightRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const purchaseButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const backButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const restorePurchaseButtonFocusRef = React.useRef(false);
  const [paymentSyncRetryRequest, setPaymentSyncRetryRequest] = React.useState(0);
  const [canRetryPaymentSync, setCanRetryPaymentSync] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [nextSummary, usage] = await Promise.all([
        billingService.getSummary({ force: true }),
        billingService.getUsage(80),
      ]);
      onSummaryChange(nextSummary);
      setUsageEvents(usage.events);
      setUsageByDay(usage.usage_by_day);
      setUsageByEntrypoint(usage.usage_by_entrypoint);
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

  React.useEffect(() => {
    if (!isOpen) {
      setActiveView('overview');
      return;
    }
    if (initialView === 'purchase' || returnedPaymentOrderId) {
      setActiveView('purchase');
    }
  }, [initialView, isOpen, returnedPaymentOrderId]);

  React.useEffect(() => {
    if (!isOpen) return;
    const animationFrame = window.requestAnimationFrame(() => {
      if (activeView === 'purchase') {
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
    let cancelled = false;
    setIsLoadingProducts(true);
    billingService.getProducts()
      .then((response) => {
        if (!cancelled) {
          setProducts(response.products);
          setPaymentsEnabled(response.payments_enabled);
        }
      })
      .catch((productError) => {
        console.warn('Failed to load billing products', productError);
        if (!cancelled) {
          setProducts([]);
          setPaymentsEnabled(false);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProducts(false);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || activeView !== 'purchase' || !checkoutForm || !checkoutFormRef.current) return;
    checkoutFormRef.current.submit();
  }, [activeView, checkoutForm, isOpen]);

  const finishReturnedOrder = React.useCallback(async (order: PaymentOrder) => {
    setPaymentStatus(order.status);
    if (order.status !== 'fulfilled') return false;
    billingService.clearBillingCache();
    try {
      const nextSummary = order.summary ?? await billingService.getSummary({ force: true });
      onSummaryChange(nextSummary);
    } catch (summaryError) {
      console.warn('Payment fulfilled but quota refresh failed', summaryError);
    }
    await refresh();
    onPaymentOrderHandled?.();
    return true;
  }, [onPaymentOrderHandled, onSummaryChange, refresh]);

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
        if (await finishReturnedOrder(order)) return;
        if (order.status === 'failed' || order.status === 'expired') {
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
  }, [finishReturnedOrder, isOpen, onPaymentOrderHandled, paymentSyncRetryRequest, returnedPaymentOrderId]);

  const retryReturnedPaymentOrder = () => {
    if (!returnedPaymentOrderId) return;
    returnedOrderRef.current = null;
    setCanRetryPaymentSync(false);
    setError('');
    setPaymentSyncRetryRequest((request) => request + 1);
  };

  const handlePurchase = async (product: BillingProduct) => {
    if (purchaseInFlightRef.current || isPurchasing || !paymentsEnabled) return;
    purchaseInFlightRef.current = true;
    setIsPurchasing(true);
    setPaymentStatus('creating');
    setError('');
    try {
      const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `billing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const order = await billingService.createPaymentOrder(product.sku, idempotencyKey);
      setPaymentStatus(order.status);
      const checkout = await billingService.getPaymentCheckout(order.id);
      setPaymentStatus(checkout.order.status);
      setCheckoutForm(checkout);
    } catch (purchaseError) {
      console.error(purchaseError);
      setPaymentStatus('failed');
      setError('订单创建失败，请稍后重试。');
    } finally {
      purchaseInFlightRef.current = false;
      setIsPurchasing(false);
    }
  };

  const handleRedeem = async () => {
    const code = redemptionCode.trim();
    if (!code || isRedeeming) {
      return;
    }
    setIsRedeeming(true);
    setError('');
    setRedemptionMessage('');
    try {
      const result = await billingService.redeemCode(code);
      onSummaryChange(result.summary);
      setRedemptionCode('');
      if (result.tokens > 0) {
        setRedemptionMessage(`已兑换 ${formatTokens(result.tokens)} Tokens，来自 ${result.package_name}`);
      } else if (result.summary.is_unlimited) {
        setRedemptionMessage(`无限额度有效至 ${formatDateTime(result.summary.unlimited_expires_at)}，来自 ${result.package_name}`);
      } else {
        setRedemptionMessage(`已兑换 ${formatTokens(result.tokens)} Tokens，来自 ${result.package_name}`);
      }
      void refresh();
    } catch (redeemError) {
      console.error(redeemError);
      setError('卡密兑换失败，请检查卡密或联系管理员。');
    } finally {
      setIsRedeeming(false);
    }
  };

  const openPurchaseView = () => {
    setError('');
    setActiveView('purchase');
  };

  const returnToOverview = () => {
    setError('');
    restorePurchaseButtonFocusRef.current = true;
    setActiveView('overview');
  };

  const handleClose = () => {
    const focusTarget = returnFocusElement;
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
      if (activeView === 'purchase') {
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
          {activeView === 'purchase' ? (
            <div className="flex items-center gap-2.5">
              <button
                ref={backButtonRef}
                type="button"
                onClick={returnToOverview}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:hover:bg-gray-800 dark:hover:text-white dark:focus:ring-emerald-500/20"
                aria-label="返回额度概览"
                title="返回额度概览"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h2 id="token-quota-dialog-title" className="text-sm font-extrabold text-gray-900 dark:text-white">购买套餐</h2>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">选择套餐或兑换卡密</p>
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
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
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
          </div>
        ) : (
          <div className="min-h-0 space-y-5 overflow-y-auto p-4 sm:p-5" data-quota-view="purchase">
            <PurchaseCatalog
              products={products}
              paymentsEnabled={paymentsEnabled}
              isLoading={isLoadingProducts}
              isPurchasing={isPurchasing}
              paymentStatus={paymentStatus}
              onPurchase={handlePurchase}
            />

            {error && (
              <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                <span>{error}</span>
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

            <div className="mx-auto max-w-3xl border-t border-gray-100 pt-5 dark:border-gray-800">
              <RedemptionCard
                code={redemptionCode}
                isRedeeming={isRedeeming}
                redemptionMessage={redemptionMessage}
                onCodeChange={setRedemptionCode}
                onRedeem={handleRedeem}
              />
            </div>
          </div>
        )}
        {checkoutForm && (
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
