import React from 'react';

type AnalyticsCardProps = {
  title: string;
  subtitle?: string;
  updatedAt?: string;
  isLoading?: boolean;
  error?: string | null;
  children: React.ReactNode;
};

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({
  title,
  subtitle,
  updatedAt,
  isLoading,
  error,
  children,
}) => (
  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-4">
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        {updatedAt ? (
          <span className="text-xs text-gray-400">更新于 {updatedAt}</span>
        ) : null}
      </div>
      {subtitle ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      ) : null}
    </div>
    {isLoading ? (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        数据加载中...
      </div>
    ) : error ? (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        {error}
      </div>
    ) : (
      children
    )}
  </div>
);

export default AnalyticsCard;
