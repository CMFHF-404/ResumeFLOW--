import React from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import type { TokenUsageAggregate } from '../services/billingService';
import { formatTokenAmount as formatTokens } from '../utils/quotaDisplay';

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

  const closedPath = React.useMemo(() => {
    if (!bezierPath || !usageByDay.length) return '';
    const firstX = usageByDay.length === 1 ? width / 2 : padding;
    const lastX = usageByDay.length === 1 ? width / 2 : width - padding;
    return `${bezierPath} L ${lastX.toFixed(1)} ${chartBottom.toFixed(1)} L ${firstX.toFixed(1)} ${chartBottom.toFixed(1)} Z`;
  }, [bezierPath, chartBottom, usageByDay]);

  const labels = React.useMemo(() => {
    if (usageByDay.length < 2) return [];
    const formatKey = (key: string) => key.substring(5);
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

        <line x1={padding} y1={chartBottom} x2={width - padding} y2={chartBottom} stroke="currentColor" className="text-gray-200 dark:text-gray-800" strokeWidth="1" />
        <line x1={padding} y1={chartTop + chartHeight / 2} x2={width - padding} y2={chartTop + chartHeight / 2} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeDasharray="3,3" strokeWidth="1" />
        <line x1={padding} y1={chartTop} x2={width - padding} y2={chartTop} stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeDasharray="3,3" strokeWidth="1" />

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
                  <circle
                    cx={cx}
                    cy={cy}
                    r="12"
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
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
            <div className="absolute left-1/2 bottom-1 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border-r border-b border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900" />
          </div>
        );
      })()}

      {labels.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 text-[10px] font-semibold text-gray-400">
          {labels.map((label, index) => (
            <span
              key={index}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: label.x, transform: label.x === '0%' ? 'none' : label.x === '100%' ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {label.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

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

export const TokenQuotaCharts: React.FC<{
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
