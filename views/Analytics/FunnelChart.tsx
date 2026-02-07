import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import AnalyticsCard from './AnalyticsCard';
import { analyticsService, type FunnelData } from '../../services/analyticsService';

const formatUpdatedAt = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const buildSeriesData = (data?: FunnelData) => {
  const steps = data?.steps ?? [];
  return steps.map((step) => ({
    value: step.count,
    name: step.name,
    itemStyle: {
      color: step.dropoff_rate > 0.5 ? '#f97316' : '#6366f1',
    },
  }));
};

const FunnelChart: React.FC = () => {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await analyticsService.getFunnelData();
        if (isActive) {
          setData(result);
        }
      } catch (err) {
        console.error('[Analytics] 加载漏斗数据失败:', err);
        if (isActive) {
          setError('加载漏斗数据失败');
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

  const option = useMemo(() => {
    const seriesData = buildSeriesData(data || undefined);
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c}',
      },
      series: [
        {
          type: 'funnel',
          left: '10%',
          width: '80%',
          top: 20,
          bottom: 20,
          label: {
            show: true,
            position: 'inside',
            formatter: '{b}\\n{c}',
            color: '#fff',
            fontSize: 12,
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 1,
          },
          data: seriesData,
        },
      ],
    };
  }, [data]);

  return (
    <AnalyticsCard
      title="核心漏斗"
      subtitle="追踪用户从访问到导出 PDF 的转化路径"
      updatedAt={formatUpdatedAt(data?.updated_at)}
      isLoading={loading}
      error={error}
    >
      <div className="h-80">
        <ReactECharts style={{ height: '100%' }} option={option} notMerge />
      </div>
    </AnalyticsCard>
  );
};

export default FunnelChart;
