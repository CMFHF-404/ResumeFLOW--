import React, { useMemo, useState } from 'react';
import { BarChart3, Activity, LayoutGrid } from 'lucide-react';
import FunnelChart from './Analytics/FunnelChart';
import AIQualityChart from './Analytics/AIQualityChart';
import EditorUXChart from './Analytics/EditorUXChart';
import { useAdmin } from '../hooks/useAdmin';

type AnalyticsTab = 'funnel' | 'ai' | 'editor';

const TAB_CONFIG: Array<{
  id: AnalyticsTab;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'funnel',
    label: '核心漏斗',
    description: '注册到导出的转化链路',
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    id: 'ai',
    label: 'AI 质量',
    description: '润色与 JD 匹配效果',
    icon: <Activity className="w-4 h-4" />,
  },
  {
    id: 'editor',
    label: '编辑器体验',
    description: '排版与交互习惯',
    icon: <LayoutGrid className="w-4 h-4" />,
  },
];

const Analytics: React.FC = () => {
  const { isAdmin, loading, error } = useAdmin();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('funnel');

  const activeContent = useMemo(() => {
    switch (activeTab) {
      case 'ai':
        return <AIQualityChart />;
      case 'editor':
        return <EditorUXChart />;
      case 'funnel':
      default:
        return <FunnelChart />;
    }
  }, [activeTab]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        权限校验中...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        {error || '你暂无权限访问数据分析页面'}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-8 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary">
            <BarChart3 className="w-8 h-8" />
            <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">
              数据分析
            </span>
          </div>
          <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500">Analytics Dashboard</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-6xl mx-auto space-y-8 pb-16">
          <div className="flex flex-wrap gap-3">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 bg-white'
                }`}
              >
                {tab.icon}
                <span className="font-medium">{tab.label}</span>
                <span className="text-xs text-gray-400 hidden md:inline">{tab.description}</span>
              </button>
            ))}
          </div>

          {activeContent}
        </div>
      </main>
    </div>
  );
};

export default Analytics;
