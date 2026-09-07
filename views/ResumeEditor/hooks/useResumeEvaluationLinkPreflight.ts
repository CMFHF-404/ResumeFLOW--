import { useCallback, useLayoutEffect, useRef } from 'react';
import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import type { ExperienceListItem } from '../../../services/experienceService';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../../../services/resumeService';
import {
    assertResumeEvaluationLinkSignatureCurrent,
    assertResumeEvaluationLinkTargetCurrent,
    buildSelectedExperienceLinkCandidates,
    ensureResumeExperienceLinks,
} from './resumeExperienceLinkPersistence';

type UseResumeEvaluationLinkPreflightParams = {
    authUserKey: string | null;
    resumeId: string | null;
    evaluationSignature: string;
    selectedExperienceIds: ReadonlySet<string>;
    resumeExperienceMap: Map<string, ResumeExperienceItem>;
    experienceSourceMap: Map<string, ExperienceListItem>;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    setResumeExperienceMap: (nextMap: Map<string, ResumeExperienceItem>) => void;
};

export const useResumeEvaluationLinkPreflight = ({
    authUserKey,
    resumeId,
    evaluationSignature,
    selectedExperienceIds,
    resumeExperienceMap,
    experienceSourceMap,
    applyResumeDetail,
    setResumeExperienceMap,
}: UseResumeEvaluationLinkPreflightParams) => {
    const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
    const activeResumeIdRef = useRef(resumeId);
    const activeEvaluationSignatureRef = useRef(evaluationSignature);
    useLayoutEffect(() => {
        activeResumeIdRef.current = resumeId;
        activeEvaluationSignatureRef.current = evaluationSignature;
    }, [evaluationSignature, resumeId]);

    return useCallback(async () => {
        const requestedResumeId = resumeId;
        const requestedEvaluationSignature = evaluationSignature;
        const operation = await ownerGuard.beginOperation();
        const assertOperationCurrent = async () => {
            await ownerGuard.assertOperationCurrent(operation);
            assertResumeEvaluationLinkTargetCurrent(
                requestedResumeId,
                activeResumeIdRef.current,
            );
            assertResumeEvaluationLinkSignatureCurrent(
                requestedEvaluationSignature,
                activeEvaluationSignatureRef.current,
            );
        };
        const candidates = buildSelectedExperienceLinkCandidates(
            selectedExperienceIds,
            resumeExperienceMap,
            experienceSourceMap,
        );
        const result = await ensureResumeExperienceLinks({
            resumeId: requestedResumeId,
            candidates,
            resumeExperienceMap,
            expectedAuthCacheKey: operation.expectedAuthCacheKey,
            assertOwnerCurrent: assertOperationCurrent,
            persistAssembly: (targetResumeId, payload, options) => resumeService.updateAssembly(
                targetResumeId,
                payload,
                options,
            ),
            applyResumeDetail,
            setResumeExperienceMap,
        });
        return {
            ...result,
            assertCurrent: assertOperationCurrent,
        };
    }, [
        applyResumeDetail,
        evaluationSignature,
        experienceSourceMap,
        ownerGuard,
        resumeExperienceMap,
        resumeId,
        selectedExperienceIds,
        setResumeExperienceMap,
    ]);
};
