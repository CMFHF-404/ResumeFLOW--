import type {
    ResumeBossGreeting,
    ResumePrintLayoutMeasurement,
} from '../../types/resume';
import { buildResumeAISnapshot } from '../../utils/resumeHelpers';
import { measureResumePrintLayout } from '../../utils/resumePrintLayout';
import { PRINT_LAYOUT_OVERFLOW_TOLERANCE_PX } from './constants';

export type BossGreetingSignatureParams = {
    jdText: string;
    summary: string;
    jobTitle?: string;
    company?: string;
    resumeText: string;
};

export type PersonalSummarySignatureParams = {
    jdText: string;
    context: {
        profile: {
            name: string;
            email: string;
            phone: string;
            location: string;
            linkedin: string;
        };
        workExperiences: Array<Record<string, unknown>>;
        projectExperiences: Array<Record<string, unknown>>;
        educationExperiences: Array<Record<string, unknown>>;
        certifications: Array<Record<string, unknown>>;
        skills: Array<Record<string, unknown>>;
    };
};

export type PendingPersistedBossGreeting = ResumeBossGreeting & {
    resumeId: string | null;
};

export const buildBossGreetingSignature = ({
    jdText,
    summary,
    jobTitle,
    company,
    resumeText,
}: BossGreetingSignatureParams) => JSON.stringify({
    jdText: jdText.trim(),
    summary,
    jobTitle: jobTitle ?? '',
    company: company ?? '',
    resumeText,
});

export const normalizePersistedBossGreeting = (value: unknown): ResumeBossGreeting | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = value as Partial<ResumeBossGreeting>;
    const greeting = typeof record.greeting === 'string' ? record.greeting.trim() : '';
    if (!greeting) {
        return null;
    }
    return {
        greeting,
        ...(typeof record.signature === 'string' && record.signature.trim()
            ? { signature: record.signature }
            : {}),
    };
};

export const buildPersonalSummarySignature = ({
    jdText,
    context,
}: PersonalSummarySignatureParams) => JSON.stringify({
    jdText: jdText.trim(),
    context,
});

export const waitForNextFrame = (callback: () => void) => {
    if (typeof window === 'undefined') {
        callback();
        return () => undefined;
    }
    const frameId = window.requestAnimationFrame(() => callback());
    return () => window.cancelAnimationFrame(frameId);
};

const sortSnapshotEntriesById = <T extends { id: string }>(items: T[]) => (
    [...items].sort((a, b) => a.id.localeCompare(b.id))
);

export const buildStableResumeSnapshotText = (snapshot: ReturnType<typeof buildResumeAISnapshot>) => JSON.stringify({
    experiences: sortSnapshotEntriesById(snapshot.experiences),
    educations: sortSnapshotEntriesById(snapshot.educations),
    certifications: sortSnapshotEntriesById(snapshot.certifications),
    skills: sortSnapshotEntriesById(snapshot.skills),
});

export const readErrorStatus = (error: unknown): number | undefined => (
    (error as { response?: { status?: number } } | null)?.response?.status
);

export const measureResumeLayout = (
    pageElement: HTMLElement | null,
    contentElement: HTMLElement | null
): ResumePrintLayoutMeasurement | null => {
    if (!pageElement || !contentElement) {
        return null;
    }

    return measureResumePrintLayout(
        pageElement,
        contentElement,
        PRINT_LAYOUT_OVERFLOW_TOLERANCE_PX
    );
};
