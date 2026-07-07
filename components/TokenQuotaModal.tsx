import React from 'react';
import { BarChart3, ExternalLink, HeartHandshake, KeyRound, RefreshCw, TrendingUp, Wallet, X } from 'lucide-react';
import {
  billingService,
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

const TAOBAO_PRODUCT_LINKS = [
  {
    label: '包月套餐',
    href: 'https://item.taobao.com/item.htm?ft=t&id=1065655992699',
    className:
      'border-amber-200 bg-amber-500 text-white shadow-sm hover:bg-amber-600 focus:ring-amber-200 dark:border-amber-400/30 dark:bg-amber-500 dark:hover:bg-amber-400',
  },
  {
    label: '按量付费',
    href: 'https://item.taobao.com/item.htm?ft=t&id=1063261946760',
    className:
      'border-emerald-200 bg-white text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 focus:ring-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20',
  },
] as const;

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
  onOpenRedeem: () => void;
  isRedeemOpen: boolean;
}> = ({ summary, onOpenRedeem, isRedeemOpen }) => {
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
          type="button"
          onClick={onOpenRedeem}
          className="inline-flex items-center gap-1 font-bold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 focus:outline-none"
        >
          <span>{isRedeemOpen ? '收起兑换' : '购买额度 / 兑换卡密'}</span>
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

// ==========================================
// 6. 卡密兑换区
// ==========================================
// ==========================================
// 6. 卡密兑换卡片 (优化样式并融入购买引导)
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
      <div className="flex flex-col gap-4 md:flex-row md:items-stretch md:divide-x md:divide-emerald-100/50 dark:md:divide-emerald-900/20">
        {/* 左侧：如何获取额度 */}
        <div className="flex flex-1 flex-col justify-between pr-0 md:pr-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                <HeartHandshake className="h-3 w-3" />
              </span>
              <span>如何获取额度</span>
            </div>
            <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              选择适合的商品入口完成购买，付款后按商品说明获取卡密并在右侧兑换为 AI 服务额度。
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TAOBAO_PRODUCT_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-extrabold transition active:scale-95 focus:outline-none focus:ring-2 ${item.className}`}
              >
                <span>{item.label}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
        </div>

        {/* 右侧：卡密兑换 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRedeem();
          }}
          className="flex flex-1 flex-col justify-between pl-0 pt-3 md:pl-4 md:pt-0"
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
}) => {
  const [usageEvents, setUsageEvents] = React.useState<TokenUsageEvent[]>([]);
  const [usageByDay, setUsageByDay] = React.useState<TokenUsageAggregate[]>([]);
  const [usageByEntrypoint, setUsageByEntrypoint] = React.useState<TokenUsageAggregate[]>([]);
  const [redemptionCode, setRedemptionCode] = React.useState('');
  const [redemptionMessage, setRedemptionMessage] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isRedeeming, setIsRedeeming] = React.useState(false);
  const [isRedeemOpen, setIsRedeemOpen] = React.useState(false);
  const [error, setError] = React.useState('');

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
          <QuotaDashboard
            summary={summary}
            onOpenRedeem={() => setIsRedeemOpen(!isRedeemOpen)}
            isRedeemOpen={isRedeemOpen}
          />

          {isRedeemOpen && (
            <div className="animate-in fade-in slide-in-from-top-3 duration-200">
              <RedemptionCard
                code={redemptionCode}
                isRedeeming={isRedeeming}
                redemptionMessage={redemptionMessage}
                onCodeChange={setRedemptionCode}
                onRedeem={handleRedeem}
              />
            </div>
          )}

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
      </div>
    </div>
  );
};

export default TokenQuotaModal;
