import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ExperienceListItem } from '../../../services/experienceService';
import type { Certification as CertificationRecord } from '../../../services/certificationsService';
import type { UserSkill } from '../../../services/skillsService';
import type { Profile } from '../../../services/profileService';
import type { ResumeDetail } from '../../../services/resumeService';
import type {
    CertificationView,
    EducationView,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
} from '../../../types/resume';
import { experienceService } from '../../../services/experienceService';
import { certificationsService } from '../../../services/certificationsService';
import { skillsService } from '../../../services/skillsService';
import { profileService } from '../../../services/profileService';
import { resumeService } from '../../../services/resumeService';
import ResumePreview, { type ResumePreviewProps } from '../../ResumeEditor/components/ResumePreview';
import {
    buildCertificationView,
    buildEducationView,
    buildResumeExperienceMap,
    buildResumeExperienceView,
    buildSkillGroups,
    compareByDateDesc,
    compareCertificationByDateDesc,
    normalizeSectionOrder,
    resolveProfileSnapshot,
    resolveSelectionSet,
    sortByCategory,
} from '../../ResumeEditor/helpers';
import {
    FONT_SIZE_DEFAULT,
    LINE_HEIGHT_DEFAULT,
    LIST_SPACING_BY_DENSITY,
    PREVIEW_PADDING_MM,
    SECTION_SPACING_CLASS_BY_DENSITY,
} from '../../ResumeEditor/constants';

export type ResumePreviewModalProps = {
    isOpen: boolean;
    resumeId: string | null;
    resumeName?: string;
    onClose: () => void;
};

type PreviewState = {
    profile: ResumeEditorProfile;
    sectionOrder: string[];
    selectedWorkItems: ResumeExperienceView[];
    selectedProjectItems: ResumeExperienceView[];
    educations: EducationView[];
    selectedEduIds: Set<string>;
    sortedCertifications: CertificationView[];
    selectedCertIds: Set<string>;
    selectedSkillGroups: SkillGroupView[];
    density: 'compact' | 'standard' | 'spacious';
};

type PreviewSnapshot = {
    resumeId: string;
    state: PreviewState;
};

const DEFAULT_TITLE = '简历预览';
const LOADING_TEXT = '正在加载简历预览...';
const ERROR_TEXT = '加载简历预览失败，请稍后重试';
const DEFAULT_SPACING_CLASS = SECTION_SPACING_CLASS_BY_DENSITY.standard;
const DEFAULT_TOP_PADDING_PX = PREVIEW_PADDING_MM * (96 / 25.4);

const buildSpacingValue = (baseSpacing: number, lineHeightValue: number) => {
    const scale = Math.min(1, lineHeightValue / LINE_HEIGHT_DEFAULT);
    return `${(baseSpacing * scale).toFixed(3)}em`;
};

const applyExplicitOrder = <T,>(
    items: T[],
    getId: (item: T) => string,
    orderedIds?: string[]
) => {
    if (!orderedIds || orderedIds.length === 0 || items.length <= 1) {
        return items;
    }
    const index = new Map(items.map((item) => [getId(item), item]));
    const used = new Set<string>();
    const next: T[] = [];

    orderedIds.forEach((id) => {
        const resolved = index.get(id);
        if (!resolved || used.has(id)) {
            return;
        }
        used.add(id);
        next.push(resolved);
    });

    items.forEach((item) => {
        const id = getId(item);
        if (used.has(id)) {
            return;
        }
        next.push(item);
    });

    return next;
};

const resolveFallbackSelection = (ids: Array<string | number> | undefined, fallbackIds: string[]) => {
    const selection = resolveSelectionSet(ids);
    return selection.size > 0 ? selection : new Set(fallbackIds);
};

const resolveExperienceSelection = (
    ids: Array<string | number> | undefined,
    resumeMap: Map<string, unknown>,
    allItems: ResumeExperienceView[]
) => {
    const selection = resolveSelectionSet(ids);
    if (selection.size > 0) {
        return selection;
    }
    if (resumeMap.size > 0) {
        return new Set(resumeMap.keys());
    }
    return new Set(allItems.map((item) => item.id));
};

const buildSelectedSkillGroups = (groups: SkillGroupView[], selectedIds: Set<string>) => {
    return groups
        .map((group) => ({
            name: group.name,
            skills: group.skills.filter((skill) => selectedIds.has(skill.id)),
        }))
        .filter((group) => group.skills.length > 0);
};

const resolveSpacingClass = (density?: PreviewState['density']) => {
    return SECTION_SPACING_CLASS_BY_DENSITY[density ?? 'standard'] ?? DEFAULT_SPACING_CLASS;
};

const buildPreviewTitle = (resumeName?: string) => {
    return resumeName ? `${DEFAULT_TITLE} - ${resumeName}` : DEFAULT_TITLE;
};

const DEFAULT_BULLET_SPACING_VALUE = buildSpacingValue(
    LIST_SPACING_BY_DENSITY.compact,
    LINE_HEIGHT_DEFAULT
);

const buildPreviewState = (
    detail: ResumeDetail,
    profileData: Profile | null,
    experiences: ExperienceListItem[],
    educationExperiences: ExperienceListItem[],
    certifications: CertificationRecord[],
    skills: UserSkill[]
): PreviewState => {
    const config = (detail.resume?.config || {}) as ResumeEditorConfig;
    const density = config.layout?.density ?? 'standard';
    const sectionOrder = normalizeSectionOrder(config.layout?.sectionOrder);
    const orders = config.layout?.orders;
    const resumeMap = buildResumeExperienceMap(detail);
    const experienceViews = sortByCategory(
        experiences.map((item) => buildResumeExperienceView(item, resumeMap.get(item.master.id))),
        compareByDateDesc
    );
    const workViews = experienceViews.filter((item) => item.category === 'work');
    const projectViews = experienceViews.filter((item) => item.category === 'project');
    const orderedWork = applyExplicitOrder(workViews, (item) => item.id, orders?.workExperienceIds);
    const orderedProject = applyExplicitOrder(projectViews, (item) => item.id, orders?.projectExperienceIds);
    const selectedExpIds = resolveExperienceSelection(config.selection?.experienceIds, resumeMap, experienceViews);
    const selectedWorkItems = orderedWork.filter((item) => selectedExpIds.has(item.id));
    const selectedProjectItems = orderedProject.filter((item) => selectedExpIds.has(item.id));

    const educationViews = educationExperiences.map(buildEducationView);
    const orderedEducations = applyExplicitOrder(educationViews, (item) => item.id, orders?.educationIds);
    const selectedEduIds = resolveFallbackSelection(
        config.selection?.educationIds,
        orderedEducations.map((item) => item.id)
    );

    const certificationViews = certifications
        .map(buildCertificationView)
        .sort(compareCertificationByDateDesc);
    const orderedCerts = applyExplicitOrder(certificationViews, (item) => item.id, orders?.certificationIds);
    const selectedCertIds = resolveFallbackSelection(
        config.selection?.certificationIds,
        orderedCerts.map((item) => item.id)
    );

    const skillGroups = buildSkillGroups(skills);
    const orderedSkillGroups = applyExplicitOrder(skillGroups, (group) => group.name, orders?.skillGroupNames);
    const selectedSkillIds = resolveFallbackSelection(
        config.selection?.skillIds,
        skills.map((skill) => skill.id)
    );

    return {
        profile: resolveProfileSnapshot(config, profileData || undefined),
        sectionOrder,
        selectedWorkItems,
        selectedProjectItems,
        educations: orderedEducations,
        selectedEduIds,
        sortedCertifications: orderedCerts,
        selectedCertIds,
        selectedSkillGroups: buildSelectedSkillGroups(orderedSkillGroups, selectedSkillIds),
        density,
    };
};

const useResumePreviewState = (isOpen: boolean, resumeId: string | null) => {
    const [previewSnapshot, setPreviewSnapshot] = useState<PreviewSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !resumeId) {
            setPreviewSnapshot(null);
            setIsLoading(false);
            setError(null);
            return;
        }
        let cancelled = false;
        const currentResumeId = resumeId;
        const loadPreview = async () => {
            setIsLoading(true);
            setError(null);
            setPreviewSnapshot(null);
            try {
                const detail = await resumeService.get(currentResumeId);
                const [
                    profileData,
                    experiences,
                    educationExperiences,
                    certifications,
                    skills,
                ] = await Promise.all([
                    profileService.getProfile().catch(() => null),
                    Promise.all([
                        experienceService.list('work'),
                        experienceService.list('project'),
                    ]).then((items) => items.flat()),
                    experienceService.list('education'),
                    certificationsService.list(),
                    skillsService.list(),
                ]);
                if (cancelled) {
                    return;
                }
                setPreviewSnapshot({
                    resumeId: currentResumeId,
                    state: buildPreviewState(
                        detail,
                        profileData,
                        experiences,
                        educationExperiences,
                        certifications,
                        skills
                    ),
                });
            } catch (err) {
                console.error('[ResumePreviewModal] 加载预览失败:', err);
                if (!cancelled) {
                    setError(ERROR_TEXT);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };
        loadPreview();
        return () => {
            cancelled = true;
        };
    }, [isOpen, resumeId]);

    return { previewSnapshot, isLoading, error };
};

type PreviewShellProps = {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
};

type PreviewBodyProps = {
    isLoading: boolean;
    error: string | null;
    previewProps: ResumePreviewProps | null;
};

const PreviewShell: React.FC<PreviewShellProps> = ({ title, onClose, children }) => (
    <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        onClick={onClose}
    >
        <div
            className="bg-white dark:bg-surface-dark rounded-2xl shadow-2xl w-[92vw] max-w-6xl h-[88vh] flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">{title}</h3>
                <button
                    onClick={onClose}
                    className="p-2 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 transition-colors"
                    type="button"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 dark:bg-gray-900/50">
                {children}
            </div>
        </div>
    </div>
);

const PreviewBody: React.FC<PreviewBodyProps> = ({ isLoading, error, previewProps }) => {
    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
                {LOADING_TEXT}
            </div>
        );
    }
    if (error) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-red-500">
                {error}
            </div>
        );
    }
    if (previewProps) {
        return <ResumePreview {...previewProps} />;
    }
    return (
        <div className="h-full flex items-center justify-center text-sm text-gray-500">
            {LOADING_TEXT}
        </div>
    );
};

const noopSectionDragStart: ResumePreviewProps['onSectionDragStart'] = () => undefined;
const noopItemDragStart: ResumePreviewProps['onItemDragStart'] = () => undefined;
const noopDragHover: ResumePreviewProps['onSectionDragHover'] = () => undefined;
const noopItemDragHover: ResumePreviewProps['onItemDragHover'] = () => undefined;
const noopDragDrop: ResumePreviewProps['onSectionDrop'] = () => undefined;
const noopItemDrop: ResumePreviewProps['onItemDrop'] = () => undefined;
const noopDragEnd = () => undefined;
const noopNavigate: ResumePreviewProps['onNavigateTab'] = () => undefined;
const noopEdit: ResumePreviewProps['onEditExperience'] = () => undefined;

const buildResumePreviewProps = (
    previewState: PreviewState,
    previewRef: React.RefObject<HTMLDivElement>,
    previewContentRef: React.RefObject<HTMLDivElement>,
    spacingClass: string,
    listSpacingValue: string
): ResumePreviewProps => ({
    readOnly: true,
    previewRef,
    previewContentRef,
    previewScope: 'dashboard-modal',
    lineHeight: LINE_HEIGHT_DEFAULT,
    fontSize: FONT_SIZE_DEFAULT,
    listSpacingValue,
    bulletSpacingValue: DEFAULT_BULLET_SPACING_VALUE,
    topPaddingPx: DEFAULT_TOP_PADDING_PX,
    profile: previewState.profile,
    sectionSpacingClass: spacingClass,
    listSpacingClass: 'space-y-[var(--rf-list-spacing)]',
    sectionOrder: previewState.sectionOrder,
    selectedWorkItems: previewState.selectedWorkItems,
    selectedProjectItems: previewState.selectedProjectItems,
    educations: previewState.educations,
    selectedEduIds: previewState.selectedEduIds,
    sortedCertifications: previewState.sortedCertifications,
    selectedCertIds: previewState.selectedCertIds,
    selectedSkillGroups: previewState.selectedSkillGroups,
    isDragging: false,
    draggedItemKey: null,
    draggedSectionId: null,
    onSectionDragStart: noopSectionDragStart,
    onSectionDragHover: noopDragHover,
    onSectionDrop: noopDragDrop,
    onItemDragStart: noopItemDragStart,
    onItemDragHover: noopItemDragHover,
    onItemDrop: noopItemDrop,
    onDragEnd: noopDragEnd,
    onNavigateTab: noopNavigate,
    onEditExperience: noopEdit,
    onEditCertification: noopEdit,
    onEditSkill: noopEdit,
});

const ResumePreviewModal: React.FC<ResumePreviewModalProps> = ({
    isOpen,
    resumeId,
    resumeName,
    onClose,
}) => {
    const { previewSnapshot, isLoading, error } = useResumePreviewState(isOpen, resumeId);
    const previewState =
        previewSnapshot && resumeId && previewSnapshot.resumeId === resumeId
            ? previewSnapshot.state
            : null;
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const spacingClass = resolveSpacingClass(previewState?.density);
    const density = previewState?.density ?? 'standard';
    const listSpacingValue = buildSpacingValue(LIST_SPACING_BY_DENSITY[density], LINE_HEIGHT_DEFAULT);
    const previewProps = previewState
        ? buildResumePreviewProps(
            previewState,
            previewRef,
            previewContentRef,
            spacingClass,
            listSpacingValue
        )
        : null;

    if (!isOpen) {
        return null;
    }

    const title = buildPreviewTitle(resumeName);

    return (
        <PreviewShell title={title} onClose={onClose}>
            <PreviewBody isLoading={isLoading} error={error} previewProps={previewProps} />
        </PreviewShell>
    );
};

export default ResumePreviewModal;

