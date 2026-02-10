import React from 'react';
import { MATCH_BADGE_STYLES } from '../../../constants/resumeConstants';
import { DEFAULT_MATCH_BADGE_TONE } from '../constants';
import type { MatchTrend } from '../../../types/analysis';

type MatchBadgeProps = {
    score: number;
    label?: string;
    tone?: keyof typeof MATCH_BADGE_STYLES;
    variant?: 'soft' | 'solid';
    className?: string;
    trend?: MatchTrend;
};

const DEFAULT_MATCH_BADGE_LABEL = '匹配度';

const TREND_LABELS: Record<MatchTrend, string> = {
    up: '↑',
    same: '→',
    down: '↓',
};

const TREND_CLASSES: Record<MatchTrend, string> = {
    up: 'text-emerald-600',
    same: 'text-gray-400',
    down: 'text-rose-500',
};

export const MatchBadge: React.FC<MatchBadgeProps & { children?: React.ReactNode }> = ({
    score,
    label,
    tone = DEFAULT_MATCH_BADGE_TONE,
    variant = 'soft',
    className = '',
    trend,
    children,
}) => {
    const resolvedLabel =
        typeof label === 'string' ? label.trim() : DEFAULT_MATCH_BADGE_LABEL;
    const labelPrefix = resolvedLabel ? `${resolvedLabel} ` : '';
    const shouldShowTrend = trend && trend !== 'same';
    const trendFallback = shouldShowTrend ? (
        <span className={`ml-1 ${TREND_CLASSES[trend]}`}>{TREND_LABELS[trend]}</span>
    ) : null;

    return (
        <span
            className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${MATCH_BADGE_STYLES[tone][variant]} ${className}`.trim()}
        >
            {labelPrefix}{score}%
            {children ?? trendFallback}
        </span>
    );
};

export const StaleBadge: React.FC = () => (
    <span className="inline-flex items-center whitespace-nowrap text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
        待更新
    </span>
);
