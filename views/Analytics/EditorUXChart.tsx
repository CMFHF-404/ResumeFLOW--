import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import AnalyticsCard from './AnalyticsCard';
import { analyticsService, type EditorUXData } from '../../services/analyticsService';

const MODULE_LABELS: Record<string, string> = {
  'experience:work': '工作经历',
  'experience:project': '项目经历',
  education: '教育经历',
  certification: '证书',
  skill_group: '技能',
  'section:work': '区块-工作',
  'section:project': '区块-项目',
  'section:education': '区块-教育',
  'section:certifications': '区块-证书',
  'section:skills': '区块-技能',
};

const formatUpdatedAt = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const EditorUXChart: React.FC = () => {
  const [data, setData] = useState<EditorUXData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await analyticsService.getEditorUXData();
        if (isActive) {
          setData(result);
        }
      } catch (err) {
        console.error('[Analytics] 加载编辑器体验数据失败:', err);
        if (isActive) {
          setError('加载编辑器体验数据失败');
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

  const layoutOption = useMemo(() => {
    const layoutModes = data?.layout_modes ?? [];
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
      },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          data: layoutModes.map((item) => ({
            name: item.mode,
            value: item.count,
          })),
        },
      ],
    };
  }, [data]);

  const smartPageOption = useMemo(() => {
    const series = data?.smart_one_page_series ?? [];
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: series.map((item) => item.date) },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'line',
          data: series.map((item) => item.count),
          smooth: true,
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: '#22c55e' },
        },
      ],
    };
  }, [data]);

  const heatmapOption = useMemo(() => {
    const heatmap = data?.module_reorder_heatmap;
    const modules = heatmap?.modules ?? [];
    const positions = heatmap?.positions ?? [];
    const values = heatmap?.values ?? [];
    const maxValue = values.reduce((max, item) => Math.max(max, item[2]), 0);

    return {
      tooltip: {
        position: 'top',
      },
      grid: {
        top: 30,
        bottom: 40,
        left: 120,
        right: 20,
      },
      xAxis: {
        type: 'category',
        data: positions.map((value) => `#${value}`),
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category',
        data: modules.map((value) => MODULE_LABELS[value] ?? value),
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: maxValue || 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
      },
      series: [
        {
          type: 'heatmap',
          data: values,
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
          },
        },
      ],
    };
  }, [data]);

  return (
    <AnalyticsCard
      title="编辑器交互体验"
      subtitle="关注排版偏好、智能一页触发率与模块排序行为"
      updatedAt={formatUpdatedAt(data?.updated_at)}
      isLoading={loading}
      error={error}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64">
          <ReactECharts style={{ height: '100%' }} option={layoutOption} notMerge />
        </div>
        <div className="h-64">
          <ReactECharts style={{ height: '100%' }} option={smartPageOption} notMerge />
        </div>
      </div>
      <div className="h-80">
        <ReactECharts style={{ height: '100%' }} option={heatmapOption} notMerge />
      </div>
    </AnalyticsCard>
  );
};

export default EditorUXChart;
