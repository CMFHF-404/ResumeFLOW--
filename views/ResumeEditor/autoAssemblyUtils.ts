import type { JDAnalysisResult } from '../../services/aiService';
import type { LayoutSnapshot, SmartPageLayout } from './layoutUtils';
import { clampMatchScore } from '../../utils/resumeHelpers';
import { DEFAULT_MATCH_SCORE_FILTER } from './constants';

export type OrderedScoreItem = {
    id: string;
    score: number;
    index: number;
};

export type AutoAssemblySelection = {
    hasMatchedExperience: boolean;
    experienceIds: string[];
    certificationIds: string[];
    skillIds: string[];
    experienceRemovalQueue: string[];
    certificationRemovalQueue: string[];
    skillRemovalQueue: string[];
};

export type ManualSelectionSnapshot = {
    experienceIds: string[];
    certificationIds: string[];
    skillIds: string[];
};

export const toMatchScoreMap = (entries?: Array<{ id: string; score: number }>) => {
    const map = new Map<string, number>();
    (entries || []).forEach((entry) => {
        const score = clampMatchScore(entry.score);
        if (score !== undefined) {
            map.set(entry.id, score);
        }
    });
    return map;
};

export const compareByScoreAsc = (a: OrderedScoreItem, b: OrderedScoreItem) => {
    if (a.score !== b.score) {
        return a.score - b.score;
    }
    return a.index - b.index;
};

export const compareByScoreDesc = (a: OrderedScoreItem, b: OrderedScoreItem) => {
    if (a.score !== b.score) {
        return b.score - a.score;
    }
    return a.index - b.index;
};

export const buildOrderedScoreItems = <T extends { id: string }>(
    items: T[],
    scoreMap: Map<string, number>
) => items.map((item, index) => ({
    id: item.id,
    score: scoreMap.get(item.id) ?? 0,
    index,
}));

export const pickTopIds = (
    items: OrderedScoreItem[],
    limit: number
) => items
    .slice()
    .sort(compareByScoreDesc)
    .slice(0, limit)
    .map((item) => item.id);

export const pickThresholdIds = (
    items: OrderedScoreItem[],
    threshold: number
) => items
    .filter((item) => item.score > threshold)
    .map((item) => item.id);

export const buildRemovalQueue = (
    selectedIds: Set<string>,
    orderedItems: OrderedScoreItem[]
) => orderedItems
    .filter((item) => selectedIds.has(item.id))
    .slice()
    .sort(compareByScoreAsc)
    .map((item) => item.id);

export const buildSelectionSnapshot = (
    selectedExpIds: Set<string>,
    selectedCertIds: Set<string>,
    selectedSkillIds: Set<string>
): ManualSelectionSnapshot => ({
    experienceIds: [...selectedExpIds],
    certificationIds: [...selectedCertIds],
    skillIds: [...selectedSkillIds],
});

export const buildAutoAssemblySelectionFilter = (
    result: JDAnalysisResult,
    selection: Pick<ManualSelectionSnapshot, 'experienceIds' | 'certificationIds' | 'skillIds'>
) => {
    const experienceScoreMap = toMatchScoreMap(result.experienceMatches);
    const certificationScoreMap = toMatchScoreMap(result.certificationMatches);
    const skillScoreMap = toMatchScoreMap(result.skillMatches);
    const selectedScores = [
        ...selection.experienceIds.map((id) => experienceScoreMap.get(id)),
        ...selection.certificationIds.map((id) => certificationScoreMap.get(id)),
        ...selection.skillIds.map((id) => skillScoreMap.get(id)),
    ].filter((score): score is number => typeof score === 'number' && score > 0);
    if (selectedScores.length === 0) {
        return DEFAULT_MATCH_SCORE_FILTER;
    }
    const minSelectedScore = Math.min(...selectedScores);
    return Math.max(0, Math.min(100, Math.floor(minSelectedScore / 10) * 10));
};

export const buildLayoutSnapshot = (
    layout: SmartPageLayout,
    isSmartPageApplied: boolean
): LayoutSnapshot => ({
    ...layout,
    isSmartPageApplied,
});

export const toggleSelectionSnapshotIds = (ids: string[], targetId: string) => (
    ids.includes(targetId) ? ids.filter((id) => id !== targetId) : [...ids, targetId]
);

export const toggleGroupedSelectionSnapshotIds = (ids: string[], targetIds: string[]) => {
    const next = new Set(ids);
    const shouldSelect = targetIds.some((id) => !next.has(id));
    targetIds.forEach((id) => {
        if (shouldSelect) {
            next.add(id);
            return;
        }
        next.delete(id);
    });
    return [...next];
};

export const hasPositiveMatchScore = (item: OrderedScoreItem) => item.score > 0;
