import React from 'react';
import { MATCH_BADGE_STYLES } from '../../../constants/resumeConstants';
import { DEFAULT_MATCH_BADGE_TONE } from '../constants';
import type { MatchTrend } from '../../../types/analysis';

type MatchBadgeProps = {
    score: number;
    tone?: keyof typeof MATCH_BADGE_STYLES;
    variant?: 'soft' | 'solid';
    className?: string;
    trend?: MatchTrend;
};

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

export const MatchBadge: React.FC<MatchBadgeProps> = ({
    score,
    tone = DEFAULT_MATCH_BADGE_TONE,
    variant = 'soft',
    className = '',
    trend,
}) => (
    <span
        className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-full ${MATCH_BADGE_STYLES[tone][variant]} ${className}`.trim()}
    >
        匹配度 {score}%
        {trend ? <span className={`ml-1 ${TREND_CLASSES[trend]}`}>{TREND_LABELS[trend]}</span> : null}
    </span>
);

export const StaleBadge: React.FC = () => (
    <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
        待更新
    </span>
);
