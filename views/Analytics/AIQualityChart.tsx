import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import AnalyticsCard from './AnalyticsCard';
import { analyticsService, type AIQualityData } from '../../services/analyticsService';

const formatUpdatedAt = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const AIQualityChart: React.FC = () => {
  const [data, setData] = useState<AIQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await analyticsService.getAIQualityData();
        if (isActive) {
          setData(result);
        }
      } catch (err) {
        console.error('[Analytics] 加载 AI 质量数据失败:', err);
        if (isActive) {
          setError('加载 AI 质量数据失败');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      isActive = false;
    };
  }, []);

  const pieOption = useMemo(() => {
    const actions = data?.polish_actions ?? [];
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
      },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          data: actions.map((item) => ({
            name: item.action,
            value: item.count,
          })),
        },
      ],
    };
  }, [data]);

  const barOption = useMemo(() => {
    const dist = data?.match_score_distribution ?? [];
    return {
      tooltip: {
        trigger: 'axis',
      },
      xAxis: {
        type: 'category',
        data: dist.map((item) => item.range),
      },
      yAxis: {
        type: 'value',
      },
      series: [
        {
          type: 'bar',
          data: dist.map((item) => item.count),
          itemStyle: { color: '#6366f1' },
        },
      ],
    };
  }, [data]);

  const lineOption = useMemo(() => {
    const series = data?.latency_series ?? [];
    return {
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        data: ['P50', 'P95', 'P99'],
        bottom: 0,
      },
      grid: {
        left: 40,
        right: 20,
        top: 20,
        bottom: 40,
      },
      xAxis: {
        type: 'category',
        data: series.map((item) => item.date),
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: '{value} ms',
        },
      },
      series: [
        {
          name: 'P50',
          type: 'line',
          data: series.map((item) => item.p50),
          smooth: true,
        },
        {
          name: 'P95',
          type: 'line',
          data: series.map((item) => item.p95),
          smooth: true,
        },
        {
          name: 'P99',
          type: 'line',
          data: series.map((item) => item.p99),
          smooth: true,
        },
      ],
    };
  }, [data]);

  return (
    <AnalyticsCard
      title="AI 质量与满意度"
      subtitle="统计 AI 润色接受率、JD 匹配度分布与响应时长"
      updatedAt={formatUpdatedAt(data?.updated_at)}
      isLoading={loading}
      error={error}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64">
          <ReactECharts style={{ height: '100%' }} option={pieOption} notMerge />
        </div>
        <div className="h-64">
          <ReactECharts style={{ height: '100%' }} option={barOption} notMerge />
        </div>
      </div>
      <div className="h-72">
        <ReactECharts style={{ height: '100%' }} option={lineOption} notMerge />
      </div>
    </AnalyticsCard>
  );
};

export default AIQualityChart;
