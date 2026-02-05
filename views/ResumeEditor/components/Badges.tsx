import React from 'react';
import { MATCH_BADGE_STYLES } from '../../../constants/resumeConstants';
import { DEFAULT_MATCH_BADGE_TONE } from '../constants';

type MatchBadgeProps = {
    score: number;
    tone?: keyof typeof MATCH_BADGE_STYLES;
    variant?: 'soft' | 'solid';
    className?: string;
};

export const MatchBadge: React.FC<MatchBadgeProps> = ({
    score,
    tone = DEFAULT_MATCH_BADGE_TONE,
    variant = 'soft',
    className = '',
}) => (
    <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${MATCH_BADGE_STYLES[tone][variant]} ${className}`.trim()}
    >
        匹配度 {score}%
    </span>
);

export const StaleBadge: React.FC = () => (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
        待更新
    </span>
);
