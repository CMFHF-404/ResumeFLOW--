import type { ExperienceListItem } from '../../../services/experienceService';
import type {
    ResumeDetail,
    ResumeExperienceItem,
} from '../../../services/resumeService';

// RESUME_EVALUATION_LINK_PREFLIGHT_TEST_START
export type ResumeExperienceLinkCandidate = {
    masterId: string;
    versionId?: string | null;
};

type EnsureResumeExperienceLinksParams = {
    resumeId: string | null;
    candidates: readonly ResumeExperienceLinkCandidate[];
    resumeExperienceMap: Map<string, ResumeExperienceItem>;
    expectedAuthCacheKey: string;
    assertOwnerCurrent: () => Promise<void>;
    persistAssembly: (
        resumeId: string,
        payload: {
            operations: Array<{
                op: 'add';
                experience_version_id: string;
            }>;
        },
        options: { expectedAuthCacheKey: string },
    ) => Promise<ResumeDetail>;
    applyResumeDetail: (detail: ResumeDetail) => void;
    setResumeExperienceMap: (nextMap: Map<string, ResumeExperienceItem>) => void;
};

type ResumeEvaluationLinkSequence<T> = {
    ensureLinks: () => Promise<unknown>;
    flushConfig: () => Promise<unknown>;
    generateEvaluation: () => Promise<T>;
};

export class ResumeEvaluationLinkTargetChangedError extends Error {
    constructor() {
        super('Resume changed while preparing selected experience links.');
        this.name = 'ResumeEvaluationLinkTargetChangedError';
    }
}

export const assertResumeEvaluationLinkTargetCurrent = (
    requestedResumeId: string | null,
    currentResumeId: string | null,
) => {
    if (!requestedResumeId || currentResumeId !== requestedResumeId) {
        throw new ResumeEvaluationLinkTargetChangedError();
    }
};

export class ResumeEvaluationLinkSignatureChangedError extends Error {
    constructor() {
        super('Resume evaluation source signature changed during link preflight.');
        this.name = 'ResumeEvaluationLinkSignatureChangedError';
    }
}

export const assertResumeEvaluationLinkSignatureCurrent = (
    requestedEvaluationSignature: string,
    currentEvaluationSignature: string,
) => {
    if (currentEvaluationSignature !== requestedEvaluationSignature) {
        throw new ResumeEvaluationLinkSignatureChangedError();
    }
};

const buildResumeExperienceLinkMap = (detail: ResumeDetail) => new Map(
    detail.experiences.map((item) => [item.experience.master_experience_id, item]),
);

export const buildSelectedExperienceLinkCandidates = (
    selectedMasterIds: Iterable<string>,
    resumeExperienceMap: Map<string, ResumeExperienceItem>,
    experienceSourceMap: Map<string, ExperienceListItem>,
): ResumeExperienceLinkCandidate[] => {
    const candidates: ResumeExperienceLinkCandidate[] = [];
    const seen = new Set<string>();
    for (const rawMasterId of selectedMasterIds) {
        const masterId = rawMasterId.trim();
        if (!masterId || seen.has(masterId)) continue;
        seen.add(masterId);
        const existing = resumeExperienceMap.get(masterId);
        if (existing?.id) {
            candidates.push({
                masterId,
                versionId: existing.experience_version_id,
            });
            continue;
        }
        const source = experienceSourceMap.get(masterId);
        if (!source) {
            throw new Error(`Selected experience source is missing: ${masterId}`);
        }
        const versionId = source.latest_version?.id;
        if (!versionId) {
            throw new Error(`Selected experience version is missing: ${masterId}`);
        }
        candidates.push({ masterId, versionId });
    }
    return candidates;
};

export const ensureResumeExperienceLinks = async ({
    resumeId,
    candidates,
    resumeExperienceMap,
    expectedAuthCacheKey,
    assertOwnerCurrent,
    persistAssembly,
    applyResumeDetail,
    setResumeExperienceMap,
}: EnsureResumeExperienceLinksParams) => {
    if (!resumeId) {
        throw new Error('Resume is required before linking selected experiences.');
    }
    const uniqueCandidates = Array.from(
        new Map(candidates.map((candidate) => [candidate.masterId, candidate])).values(),
    );
    const missingCandidates = uniqueCandidates.filter(
        (candidate) => !resumeExperienceMap.get(candidate.masterId)?.id,
    );
    for (const candidate of missingCandidates) {
        if (!candidate.versionId) {
            throw new Error(`Selected experience version is missing: ${candidate.masterId}`);
        }
    }

    await assertOwnerCurrent();
    if (missingCandidates.length === 0) {
        return {
            detail: null,
            nextMap: resumeExperienceMap,
            addedLinkIds: [] as string[],
        };
    }

    const detail = await persistAssembly(resumeId, {
        operations: missingCandidates.map((candidate) => ({
            op: 'add' as const,
            experience_version_id: candidate.versionId as string,
        })),
    }, { expectedAuthCacheKey });
    await assertOwnerCurrent();

    const nextMap = buildResumeExperienceLinkMap(detail);
    const unresolvedMasterIds = uniqueCandidates
        .filter((candidate) => !nextMap.get(candidate.masterId)?.id)
        .map((candidate) => candidate.masterId);
    if (unresolvedMasterIds.length > 0) {
        throw new Error(`Resume experience links were not persisted: ${unresolvedMasterIds.join(',')}`);
    }
    const addedLinkIds = missingCandidates.map(
        (candidate) => nextMap.get(candidate.masterId)?.id as string,
    );
    await assertOwnerCurrent();
    applyResumeDetail(detail);
    setResumeExperienceMap(nextMap);
    return { detail, nextMap, addedLinkIds };
};

export const runResumeEvaluationAfterLinkPreflight = async <T>({
    ensureLinks,
    flushConfig,
    generateEvaluation,
}: ResumeEvaluationLinkSequence<T>): Promise<T> => {
    const receipt = await ensureLinks();
    const assertCurrent = (
        typeof receipt === 'object'
        && receipt !== null
        && 'assertCurrent' in receipt
        && typeof receipt.assertCurrent === 'function'
    )
        ? receipt.assertCurrent as () => Promise<void>
        : null;
    await assertCurrent?.();
    await flushConfig();
    await assertCurrent?.();
    return generateEvaluation();
};
// RESUME_EVALUATION_LINK_PREFLIGHT_TEST_END
