import {
    useCallback,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { aiService } from '../services/aiService';
import {
    certificationsService,
    Certification as CertificationRecord,
    type CertificationCreatePayload,
} from '../services/certificationsService';
import {
    experienceService,
    type ExperienceDetail,
    type ExperienceListItem,
    type ExperienceUpdatePayload,
    type ExperienceVersion,
} from '../services/experienceService';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../services/resumeService';
import { skillsService, type UserSkill } from '../services/skillsService';
import type {
    CertificationEditDraft,
    CertificationView,
    ConfirmDialogState,
    DatePayloadFallback,
    EducationEditDraft,
    EducationView,
    ExperienceEditDraft,
    ResumeExperienceView,
    SkillDraftContext,
    SkillEditDraft,
    SkillGroupView,
    StarFieldKey,
    StarFields,
} from '../types/resume';

const createDraftId = (prefix: string) => {
    const random = Math.random().toString(16).slice(2, 6);
    return `${prefix}-${Date.now()}-${random}`;
};

const isDraftId = (id: string, prefix: string) => id.startsWith(prefix);

const addToSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    next.add(id);
    return next;
};

const removeFromSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    next.delete(id);
    return next;
};

const toggleInSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    return next;
};

const setMapEntry = <K, V>(prev: Map<K, V>, key: K, value: V) => {
    const next = new Map(prev);
    next.set(key, value);
    return next;
};

const deleteMapEntry = <K, V>(prev: Map<K, V>, key: K) => {
    const next = new Map(prev);
    next.delete(key);
    return next;
};

const runWithFlag = async <T>(
    id: string,
    flagSet: Set<string>,
    setFlagSet: Dispatch<SetStateAction<Set<string>>>,
    task: () => Promise<T>
) => {
    if (flagSet.has(id)) {
        return null;
    }
    setFlagSet((prev) => addToSet(prev, id));
    try {
        return await task();
    } finally {
        setFlagSet((prev) => removeFromSet(prev, id));
    }
};

type ExperienceDefaults = {
    experienceTitleByCategory: Record<ResumeExperienceView['category'], string>;
    experienceCompanyByCategory: Record<ResumeExperienceView['category'], string>;
    skillName: string;
    skillCategory: string;
};

type ExperienceHelpers = {
    buildResumeExperienceView: (item: ExperienceListItem, resumeItem?: ResumeExperienceItem) => ResumeExperienceView;
    buildDraftExperienceView: (category: ResumeExperienceView['category'], draftId: string) => ResumeExperienceView;
    buildExperienceEditDraft: (item: ResumeExperienceView) => ExperienceEditDraft;
    buildResumeExperienceMap: (detail: ResumeDetail | null) => Map<string, ResumeExperienceItem>;
    buildExperienceDate: (start?: string, end?: string, isCurrent?: boolean) => string;
    buildStarFields: (star?: Record<string, any>) => StarFields;
    mergeStarFields: (base: StarFields, updates: Partial<StarFields>) => StarFields;
    resolveExperienceDatePayload: (draft: ExperienceEditDraft, fallback?: DatePayloadFallback) => {
        startDate?: string;
        endDate?: string;
        isCurrent: boolean;
    };
    resolveEducationDatePayload: (draft: EducationEditDraft, fallback?: DatePayloadFallback) => {
        startDate?: string;
        endDate?: string;
        isCurrent: boolean;
    };
    resolveSafeDateRange: (start: string, end: string) => { start: string; end: string };
    isPresentLabel: (value?: string) => boolean;
    sortByCategory: (
        items: ResumeExperienceView[],
        compare: (a: ResumeExperienceView, b: ResumeExperienceView) => number
    ) => ResumeExperienceView[];
    compareByDateDesc: (a: ResumeExperienceView, b: ResumeExperienceView) => number;
    buildEducationDraft: (source?: ExperienceListItem, draftId?: string) => EducationEditDraft;
    buildDraftEducationView: (draftId: string, draft: EducationEditDraft) => EducationView;
    buildEducationView: (item: ExperienceListItem) => EducationView;
    buildEducationVersionPayload: (
        source: ExperienceListItem | null,
        draft: EducationEditDraft
    ) => ExperienceUpdatePayload['version'];
    buildCertificationDraft: (source?: CertificationRecord) => CertificationEditDraft;
    buildDraftCertificationView: (draftId: string, draft: CertificationEditDraft) => CertificationView;
    buildCertificationView: (record: CertificationRecord) => CertificationView;
    buildCertificationPayload: (draft: CertificationEditDraft) => CertificationCreatePayload;
    buildSkillGroups: (skills: UserSkill[]) => SkillGroupView[];
};

type ConfirmCopy = {
    experience: { title: string; description: string };
    education: { title: string; description: string };
    certification: { title: string; description: string };
    skill: { title: string; description: string };
    skillCategory: { title: string; description: string };
};

type DraftPrefixes = {
    experience: string;
    education: string;
    certification: string;
};

type ExperienceDomain = {
    items: ResumeExperienceView[];
    setItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    resumeMap: Map<string, ResumeExperienceItem>;
    setResumeMap: Dispatch<SetStateAction<Map<string, ResumeExperienceItem>>>;
    sourceMap: Map<string, ExperienceListItem>;
    setSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
};

type EducationDomain = {
    items: EducationView[];
    setItems: Dispatch<SetStateAction<EducationView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    sourceMap: Map<string, ExperienceListItem>;
    setSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
};

type CertificationDomain = {
    items: CertificationView[];
    setItems: Dispatch<SetStateAction<CertificationView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    sourceMap: Map<string, CertificationRecord>;
    setSourceMap: Dispatch<SetStateAction<Map<string, CertificationRecord>>>;
};

type SkillDomain = {
    groups: SkillGroupView[];
    setGroups: Dispatch<SetStateAction<SkillGroupView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
};

type MatchScoreDomain = {
    setCertificationMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
    setSkillMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
};

type UseExperienceActionsOptions = {
    resumeId: string | null;
    jdText: string;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    experience: ExperienceDomain;
    education: EducationDomain;
    certification: CertificationDomain;
    skill: SkillDomain;
    jdMatch: MatchScoreDomain;
    helpers: ExperienceHelpers;
    defaults: ExperienceDefaults;
    confirmCopy: ConfirmCopy;
    draftPrefixes: DraftPrefixes;
};

type UseExperienceActionsResult = {
    confirmDialog: ConfirmDialogState | null;
    handleConfirmDelete: () => void;
    handleCancelDelete: () => void;
    experience: {
        editingExpId: string | null;
        editingDraft: ExperienceEditDraft | null;
        syncToMaster: boolean;
        setSyncToMaster: Dispatch<SetStateAction<boolean>>;
        isSavingExperience: boolean;
        isAddingExperience: boolean;
        isPolishing: boolean;
        deletingExperienceIds: Set<string>;
        handleAddExperience: (category: ResumeExperienceView['category']) => Promise<void>;
        startEditingExperience: (id: string) => void;
        cancelEditingExperience: () => void;
        updateEditingStar: (field: StarFieldKey, value: string) => void;
        updateEditingMeta: (field: 'company' | 'title', value: string) => void;
        updateEditingDate: (field: 'startDate' | 'endDate', value: string) => void;
        handleSaveExperience: () => Promise<void>;
        handlePolishWithJD: () => Promise<void>;
        requestDeleteExperience: (id: string) => void;
    };
    education: {
        editingEducationId: string | null;
        educationDraft: EducationEditDraft | null;
        isSavingEducation: boolean;
        deletingEducationIds: Set<string>;
        beginCreateEducation: () => void;
        beginEditEducation: (id: string) => void;
        cancelEducationEdit: () => void;
        updateEducationDraft: (field: keyof EducationEditDraft, value: string) => void;
        updateEducationDate: (field: 'startDate' | 'endDate', value: string) => void;
        handleSaveEducation: () => Promise<void>;
        requestDeleteEducation: (id: string) => void;
    };
    certification: {
        editingCertificationId: string | null;
        certificationDraft: CertificationEditDraft | null;
        isSavingCertification: boolean;
        deletingCertificationIds: Set<string>;
        beginCreateCertification: () => void;
        beginEditCertification: (id: string) => void;
        cancelCertificationEdit: () => void;
        updateCertificationDraft: (field: keyof CertificationEditDraft, value: string) => void;
        handleSaveCertification: () => Promise<void>;
        requestDeleteCertification: (id: string) => void;
    };
    skill: {
        editingSkillId: string | null;
        skillDraft: SkillEditDraft | null;
        skillDraftContext: SkillDraftContext | null;
        isSavingSkill: boolean;
        deletingSkillIds: Set<string>;
        deletingSkillCategories: Set<string>;
        renamingCategoryTarget: string | null;
        renamingCategoryDraft: string;
        setRenamingCategoryTarget: Dispatch<SetStateAction<string | null>>;
        setRenamingCategoryDraft: Dispatch<SetStateAction<string>>;
        beginCreateSkillType: () => void;
        beginCreateSkillInGroup: (groupName: string) => void;
        beginEditSkill: (id: string) => void;
        cancelSkillEdit: () => void;
        updateSkillDraft: (field: keyof SkillEditDraft, value: string) => void;
        handleSaveSkill: () => Promise<void>;
        handleRenameCategory: (oldName: string, newName: string) => Promise<void>;
        requestDeleteSkill: (id: string) => void;
        requestDeleteSkillCategory: (categoryName: string) => void;
    };
    selection: {
        toggleExperienceSelection: (id: string) => void;
        toggleEducationSelection: (id: string) => void;
        toggleCertificationSelection: (id: string) => void;
        toggleSkillSelection: (id: string) => void;
    };
};

type ExperienceState = {
    editingExpId: string | null;
    setEditingExpId: Dispatch<SetStateAction<string | null>>;
    editingDraft: ExperienceEditDraft | null;
    setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
    syncToMaster: boolean;
    setSyncToMaster: Dispatch<SetStateAction<boolean>>;
    isSavingExperience: boolean;
    setIsSavingExperience: Dispatch<SetStateAction<boolean>>;
    isAddingExperience: boolean;
    setIsAddingExperience: Dispatch<SetStateAction<boolean>>;
    isPolishing: boolean;
    setIsPolishing: Dispatch<SetStateAction<boolean>>;
    deletingExperienceIds: Set<string>;
    setDeletingExperienceIds: Dispatch<SetStateAction<Set<string>>>;
};

type EducationState = {
    editingEducationId: string | null;
    setEditingEducationId: Dispatch<SetStateAction<string | null>>;
    educationDraft: EducationEditDraft | null;
    setEducationDraft: Dispatch<SetStateAction<EducationEditDraft | null>>;
    isSavingEducation: boolean;
    setIsSavingEducation: Dispatch<SetStateAction<boolean>>;
    deletingEducationIds: Set<string>;
    setDeletingEducationIds: Dispatch<SetStateAction<Set<string>>>;
};

type CertificationState = {
    editingCertificationId: string | null;
    setEditingCertificationId: Dispatch<SetStateAction<string | null>>;
    certificationDraft: CertificationEditDraft | null;
    setCertificationDraft: Dispatch<SetStateAction<CertificationEditDraft | null>>;
    isSavingCertification: boolean;
    setIsSavingCertification: Dispatch<SetStateAction<boolean>>;
    deletingCertificationIds: Set<string>;
    setDeletingCertificationIds: Dispatch<SetStateAction<Set<string>>>;
};

type SkillState = {
    editingSkillId: string | null;
    setEditingSkillId: Dispatch<SetStateAction<string | null>>;
    skillDraft: SkillEditDraft | null;
    setSkillDraft: Dispatch<SetStateAction<SkillEditDraft | null>>;
    skillDraftContext: SkillDraftContext | null;
    setSkillDraftContext: Dispatch<SetStateAction<SkillDraftContext | null>>;
    isSavingSkill: boolean;
    setIsSavingSkill: Dispatch<SetStateAction<boolean>>;
    deletingSkillIds: Set<string>;
    setDeletingSkillIds: Dispatch<SetStateAction<Set<string>>>;
    deletingSkillCategories: Set<string>;
    setDeletingSkillCategories: Dispatch<SetStateAction<Set<string>>>;
    renamingCategoryTarget: string | null;
    setRenamingCategoryTarget: Dispatch<SetStateAction<string | null>>;
    renamingCategoryDraft: string;
    setRenamingCategoryDraft: Dispatch<SetStateAction<string>>;
};

const useExperienceState = (): ExperienceState => {
    const [editingExpId, setEditingExpId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<ExperienceEditDraft | null>(null);
    const [syncToMaster, setSyncToMaster] = useState(true);
    const [isSavingExperience, setIsSavingExperience] = useState(false);
    const [isAddingExperience, setIsAddingExperience] = useState(false);
    const [isPolishing, setIsPolishing] = useState(false);
    const [deletingExperienceIds, setDeletingExperienceIds] = useState<Set<string>>(new Set());

    return {
        editingExpId,
        setEditingExpId,
        editingDraft,
        setEditingDraft,
        syncToMaster,
        setSyncToMaster,
        isSavingExperience,
        setIsSavingExperience,
        isAddingExperience,
        setIsAddingExperience,
        isPolishing,
        setIsPolishing,
        deletingExperienceIds,
        setDeletingExperienceIds,
    };
};

const useEducationState = (): EducationState => {
    const [editingEducationId, setEditingEducationId] = useState<string | null>(null);
    const [educationDraft, setEducationDraft] = useState<EducationEditDraft | null>(null);
    const [isSavingEducation, setIsSavingEducation] = useState(false);
    const [deletingEducationIds, setDeletingEducationIds] = useState<Set<string>>(new Set());

    return {
        editingEducationId,
        setEditingEducationId,
        educationDraft,
        setEducationDraft,
        isSavingEducation,
        setIsSavingEducation,
        deletingEducationIds,
        setDeletingEducationIds,
    };
};

const useCertificationState = (): CertificationState => {
    const [editingCertificationId, setEditingCertificationId] = useState<string | null>(null);
    const [certificationDraft, setCertificationDraft] = useState<CertificationEditDraft | null>(null);
    const [isSavingCertification, setIsSavingCertification] = useState(false);
    const [deletingCertificationIds, setDeletingCertificationIds] = useState<Set<string>>(new Set());

    return {
        editingCertificationId,
        setEditingCertificationId,
        certificationDraft,
        setCertificationDraft,
        isSavingCertification,
        setIsSavingCertification,
        deletingCertificationIds,
        setDeletingCertificationIds,
    };
};

const useSkillState = (): SkillState => {
    const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
    const [skillDraft, setSkillDraft] = useState<SkillEditDraft | null>(null);
    const [skillDraftContext, setSkillDraftContext] = useState<SkillDraftContext | null>(null);
    const [isSavingSkill, setIsSavingSkill] = useState(false);
    const [deletingSkillIds, setDeletingSkillIds] = useState<Set<string>>(new Set());
    const [deletingSkillCategories, setDeletingSkillCategories] = useState<Set<string>>(new Set());
    const [renamingCategoryTarget, setRenamingCategoryTarget] = useState<string | null>(null);
    const [renamingCategoryDraft, setRenamingCategoryDraft] = useState('');

    return {
        editingSkillId,
        setEditingSkillId,
        skillDraft,
        setSkillDraft,
        skillDraftContext,
        setSkillDraftContext,
        isSavingSkill,
        setIsSavingSkill,
        deletingSkillIds,
        setDeletingSkillIds,
        deletingSkillCategories,
        setDeletingSkillCategories,
        renamingCategoryTarget,
        setRenamingCategoryTarget,
        renamingCategoryDraft,
        setRenamingCategoryDraft,
    };
};

type ExperienceEditHandlers = {
    startEditingExperience: (id: string) => void;
    cancelEditingExperience: () => void;
    updateEditingStar: (field: StarFieldKey, value: string) => void;
    updateEditingMeta: (field: 'company' | 'title', value: string) => void;
    updateEditingDate: (field: 'startDate' | 'endDate', value: string) => void;
};

type ExperienceDraftHandlers = {
    addDraftExperience: (category: ResumeExperienceView['category']) => void;
    removeDraftExperience: (draftId: string) => void;
    replaceDraftExperience: (draftId: string, detail: ExperienceDetail) => void;
};

const createExperienceDraftLifecycleHandlers = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    state: ExperienceState,
    prefixes: DraftPrefixes
): ExperienceDraftHandlers => {
    const addDraftExperience = (category: ResumeExperienceView['category']) => {
        const draftId = createDraftId(prefixes.experience);
        const draftView = helpers.buildDraftExperienceView(category, draftId);
        domain.setItems((prev) =>
            helpers.sortByCategory([...prev, draftView], helpers.compareByDateDesc)
        );
        domain.setSelectedIds((prev) => addToSet(prev, draftId));
        state.setEditingExpId(draftId);
        state.setEditingDraft(helpers.buildExperienceEditDraft(draftView));
        state.setSyncToMaster(true);
    };

    const removeDraftExperience = (draftId: string) => {
        domain.setItems((prev) => prev.filter((item) => item.id !== draftId));
        domain.setSelectedIds((prev) => removeFromSet(prev, draftId));
    };

    const replaceDraftExperience = (draftId: string, detail: ExperienceDetail) => {
        const newItem: ExperienceListItem = {
            master: detail.master,
            latest_version: detail.latest_version,
        };
        domain.setSourceMap((prev) => setMapEntry(prev, detail.master.id, newItem));
        const nextView = helpers.buildResumeExperienceView(
            newItem,
            domain.resumeMap.get(detail.master.id)
        );
        domain.setItems((prev) => {
            const next = prev.filter((item) => item.id !== draftId);
            return helpers.sortByCategory([...next, nextView], helpers.compareByDateDesc);
        });
        domain.setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(draftId);
            next.add(detail.master.id);
            return next;
        });
    };

    return {
        addDraftExperience,
        removeDraftExperience,
        replaceDraftExperience,
    };
};

const createExperienceEditHandlers = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    state: ExperienceState,
    draftHandlers: ExperienceDraftHandlers
): ExperienceEditHandlers => {
    const startEditingExperience = (id: string) => {
        const item = domain.items.find((entry) => entry.id === id);
        if (!item) {
            return;
        }
        state.setEditingExpId(id);
        state.setEditingDraft(helpers.buildExperienceEditDraft(item));
        state.setSyncToMaster(true);
    };

    const cancelEditingExperience = () => {
        if (state.editingDraft?.isDraft && state.editingDraft.masterId) {
            draftHandlers.removeDraftExperience(state.editingDraft.masterId);
        }
        state.setEditingExpId(null);
        state.setEditingDraft(null);
    };

    const updateEditingStar = (field: StarFieldKey, value: string) => {
        state.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                star: {
                    ...prev.star,
                    [field]: value,
                },
            };
        });
    };

    const updateEditingMeta = (field: 'company' | 'title', value: string) => {
        state.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    const updateEditingDate = (field: 'startDate' | 'endDate', value: string) => {
        state.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            if (field === 'endDate') {
                const nextRange = helpers.resolveSafeDateRange(prev.startDate, value);
                const resolvedEnd = helpers.isPresentLabel(value) ? value : nextRange.end;
                return {
                    ...prev,
                    endDate: resolvedEnd,
                    isCurrent: helpers.isPresentLabel(resolvedEnd),
                };
            }
            const nextRange = helpers.resolveSafeDateRange(value, prev.endDate);
            return {
                ...prev,
                startDate: nextRange.start,
                endDate: nextRange.end,
                isCurrent: nextRange.end ? prev.isCurrent : false,
            };
        });
    };

    return {
        startEditingExperience,
        cancelEditingExperience,
        updateEditingStar,
        updateEditingMeta,
        updateEditingDate,
    };
};

type ExperienceUpdateHelpers = {
    applyExperienceUpdate: (masterId: string, update: Partial<ResumeExperienceView>) => void;
    applyExperienceVersionUpdate: (
        masterId: string,
        version?: ExperienceVersion,
        fallbackStar?: StarFields
    ) => void;
};

const createExperienceUpdateHelpers = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers
): ExperienceUpdateHelpers => {
    const applyExperienceUpdate = (masterId: string, update: Partial<ResumeExperienceView>) => {
        domain.setItems((prev) =>
            prev.map((item) => (item.id === masterId ? { ...item, ...update } : item))
        );
    };

    const applyExperienceVersionUpdate = (
        masterId: string,
        version?: ExperienceVersion,
        fallbackStar?: StarFields
    ) => {
        if (!version) {
            return;
        }
        const star = helpers.buildStarFields(version.star ?? fallbackStar);
        applyExperienceUpdate(masterId, {
            title: version.title ?? '',
            company: version.org ?? '',
            startDate: version.start_date,
            endDate: version.end_date,
            isCurrent: version.is_current,
            date: helpers.buildExperienceDate(
                version.start_date,
                version.end_date,
                version.is_current
            ),
            star,
            experienceVersionId: version.id,
        });
    };

    return {
        applyExperienceUpdate,
        applyExperienceVersionUpdate,
    };
};

const buildMasterUpdatePayload = (
    source: ExperienceListItem,
    draft: ExperienceEditDraft,
    resolveExperienceDatePayload: ExperienceHelpers['resolveExperienceDatePayload']
) => {
    const latest = source.latest_version;
    const title = draft.title.trim() || latest?.title || '';
    const org = draft.company.trim() || latest?.org;
    const dates = resolveExperienceDatePayload(draft, latest);
    return {
        title,
        org,
        location: latest?.location,
        start_date: dates.startDate,
        end_date: dates.endDate,
        is_current: dates.isCurrent,
        summary: latest?.summary,
        highlights: latest?.highlights || [],
        tags: latest?.tags || [],
        star: draft.star,
    };
};

const syncExperienceToMaster = async (
    masterId: string,
    draft: ExperienceEditDraft,
    sourceMap: ExperienceDomain['sourceMap'],
    setSourceMap: ExperienceDomain['setSourceMap'],
    updateHelpers: ExperienceUpdateHelpers,
    resolveExperienceDatePayload: ExperienceHelpers['resolveExperienceDatePayload']
) => {
    const source = sourceMap.get(masterId);
    if (!source) {
        throw new Error('缺少经历源数据，无法同步到经历库');
    }
    const resolvedTitle = draft.title.trim() || source.latest_version?.title || '';
    if (!resolvedTitle) {
        throw new Error('缺少经历标题，无法同步到经历库');
    }
    const payload = buildMasterUpdatePayload(source, draft, resolveExperienceDatePayload);
    const detail: ExperienceDetail = await experienceService.update(masterId, { version: payload });
    const updatedVersion = detail.latest_version || source.latest_version;
    setSourceMap((prev) =>
        setMapEntry(prev, masterId, {
            ...source,
            latest_version: updatedVersion,
        })
    );
    updateHelpers.applyExperienceVersionUpdate(masterId, updatedVersion, draft.star);
};

const ensureResumeLink = async (
    resumeId: string | null,
    masterId: string,
    versionId: string | undefined,
    resumeMap: ExperienceDomain['resumeMap'],
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    buildResumeExperienceMap: ExperienceHelpers['buildResumeExperienceMap']
) => {
    if (!resumeId) {
        return null;
    }
    const existing = resumeMap.get(masterId);
    if (existing?.id) {
        return existing.id;
    }
    if (!versionId) {
        return null;
    }
    const detail = await resumeService.updateAssembly(resumeId, {
        operations: [
            {
                op: 'add',
                experience_version_id: versionId,
            },
        ],
    });
    applyResumeDetail(detail);
    const nextMap = buildResumeExperienceMap(detail);
    return nextMap.get(masterId)?.id ?? null;
};

const buildExperienceOverridePayload = (
    draft: ExperienceEditDraft,
    fallback: ResumeExperienceView | undefined,
    resolveExperienceDatePayload: ExperienceHelpers['resolveExperienceDatePayload']
) => {
    const title = draft.title.trim();
    const org = draft.company.trim();
    const dates = resolveExperienceDatePayload(
        draft,
        fallback
            ? {
                  start_date: fallback.startDate,
                  end_date: fallback.endDate,
                  is_current: fallback.isCurrent,
              }
            : undefined
    );
    const overrides: Record<string, any> = {
        star: draft.star,
        is_current: dates.isCurrent,
    };
    if (dates.startDate) {
        overrides.start_date = dates.startDate;
    }
    if (dates.endDate) {
        overrides.end_date = dates.endDate;
    }
    if (title) {
        overrides.title = title;
    }
    if (org) {
        overrides.org = org;
    }
    return {
        overrides,
        resolvedTitle: title || fallback?.title || '',
        resolvedOrg: org || fallback?.company || '',
        dates,
    };
};

const saveExperienceOverride = async (
    resumeId: string | null,
    masterId: string,
    draft: ExperienceEditDraft,
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    updateHelpers: ExperienceUpdateHelpers
) => {
    const targetItem = domain.items.find((item) => item.id === masterId);
    const linkId = await ensureResumeLink(
        resumeId,
        masterId,
        targetItem?.experienceVersionId,
        domain.resumeMap,
        applyResumeDetail,
        helpers.buildResumeExperienceMap
    );
    if (!linkId || !resumeId) {
        throw new Error('无法创建简历经历关联');
    }
    const payload = buildExperienceOverridePayload(
        draft,
        targetItem,
        helpers.resolveExperienceDatePayload
    );
    const detail = await resumeService.updateAssembly(resumeId, {
        operations: [
            {
                op: 'override',
                resume_experience_id: linkId,
                overrides_json: payload.overrides,
            },
        ],
    });
    applyResumeDetail(detail);
    updateHelpers.applyExperienceUpdate(masterId, {
        title: payload.resolvedTitle,
        company: payload.resolvedOrg,
        star: draft.star,
        startDate: payload.dates.startDate,
        endDate: payload.dates.endDate,
        isCurrent: payload.dates.isCurrent,
        date: helpers.buildExperienceDate(
            payload.dates.startDate,
            payload.dates.endDate,
            payload.dates.isCurrent
        ),
    });
    domain.setSelectedIds((prev) => addToSet(prev, masterId));
};

type ExperienceSaveHandlers = {
    handleSaveExperience: () => Promise<void>;
    handlePolishWithJD: () => Promise<void>;
};

const createExperienceSaveHandlers = (
    resumeId: string | null,
    jdText: string,
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    defaults: ExperienceDefaults,
    state: ExperienceState,
    updateHelpers: ExperienceUpdateHelpers,
    draftHandlers: ExperienceDraftHandlers,
    applyResumeDetail: (detail: ResumeDetail | null) => void
): ExperienceSaveHandlers => {
    const handleSaveExperience = async () => {
        if (!state.editingDraft) {
            return;
        }
        state.setIsSavingExperience(true);
        try {
            if (state.editingDraft.isDraft) {
                const dates = helpers.resolveExperienceDatePayload(state.editingDraft);
                const payload = {
                    category: state.editingDraft.category,
                    version: {
                        title:
                            state.editingDraft.title.trim()
                            || defaults.experienceTitleByCategory[state.editingDraft.category],
                        org:
                            state.editingDraft.company.trim()
                            || defaults.experienceCompanyByCategory[state.editingDraft.category],
                        start_date: dates.startDate,
                        end_date: dates.endDate,
                        is_current: dates.isCurrent,
                        star: state.editingDraft.star,
                    },
                };
                const detail = await experienceService.create(payload);
                draftHandlers.replaceDraftExperience(state.editingDraft.masterId, detail);
            } else if (state.syncToMaster) {
                await syncExperienceToMaster(
                    state.editingDraft.masterId,
                    state.editingDraft,
                    domain.sourceMap,
                    domain.setSourceMap,
                    updateHelpers,
                    helpers.resolveExperienceDatePayload
                );
            } else {
                await saveExperienceOverride(
                    resumeId,
                    state.editingDraft.masterId,
                    state.editingDraft,
                    domain,
                    helpers,
                    applyResumeDetail,
                    updateHelpers
                );
            }
            state.setEditingExpId(null);
            state.setEditingDraft(null);
        } catch (error) {
            console.error('[ResumeEditor] 保存经历失败:', error);
        } finally {
            state.setIsSavingExperience(false);
        }
    };

    const handlePolishWithJD = async () => {
        if (!state.editingDraft || state.isPolishing) {
            return;
        }
        const trimmedJD = jdText.trim();
        if (!trimmedJD) {
            return;
        }
        state.setIsPolishing(true);
        try {
            const result = await aiService.polishExperience({
                content: {
                    company: state.editingDraft.company,
                    role: state.editingDraft.title,
                    s: state.editingDraft.star.s,
                    t: state.editingDraft.star.t,
                    a: state.editingDraft.star.a,
                    r: state.editingDraft.star.r,
                },
                jdText: trimmedJD,
            });
            state.setEditingDraft((prev) => {
                if (!prev) {
                    return prev;
                }
                return {
                    ...prev,
                    star: helpers.mergeStarFields(prev.star, result),
                };
            });
        } catch (error) {
            console.error('[ResumeEditor] 基于JD润色失败:', error);
        } finally {
            state.setIsPolishing(false);
        }
    };

    return {
        handleSaveExperience,
        handlePolishWithJD,
    };
};

type ExperienceDeleteHandlers = {
    requestDeleteExperience: (id: string) => void;
    performDeleteExperience: (id: string) => Promise<void>;
};

const createExperienceDeleteHandlers = (
    domain: ExperienceDomain,
    state: ExperienceState,
    editHandlers: ExperienceEditHandlers,
    draftHandlers: ExperienceDraftHandlers,
    prefixes: DraftPrefixes,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    confirmCopy: ConfirmCopy
): ExperienceDeleteHandlers => {
    const requestDeleteExperience = (id: string) => {
        if (state.deletingExperienceIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'experience',
            title: confirmCopy.experience.title,
            description: confirmCopy.experience.description,
        });
    };

    const performDeleteExperience = async (id: string) => {
        if (state.deletingExperienceIds.has(id)) {
            return;
        }
        if (isDraftId(id, prefixes.experience)) {
            draftHandlers.removeDraftExperience(id);
            if (state.editingExpId === id) {
                editHandlers.cancelEditingExperience();
            }
            return;
        }
        try {
            await runWithFlag(id, state.deletingExperienceIds, state.setDeletingExperienceIds, async () => {
                await experienceService.delete(id);
                domain.setItems((prev) => prev.filter((item) => item.id !== id));
                domain.setSourceMap((prev) => deleteMapEntry(prev, id));
                domain.setResumeMap((prev) => deleteMapEntry(prev, id));
                domain.setSelectedIds((prev) => removeFromSet(prev, id));
                if (state.editingExpId === id) {
                    editHandlers.cancelEditingExperience();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除经历失败:', error);
        }
    };

    return {
        requestDeleteExperience,
        performDeleteExperience,
    };
};

const createExperienceSelectionHandlers = (domain: ExperienceDomain) => {
    const toggleExperienceSelection = (id: string) => {
        domain.setSelectedIds((prev) => toggleInSet(prev, id));
    };
    return { toggleExperienceSelection };
};

type EducationDraftHandlers = {
    beginCreateEducation: () => void;
    beginEditEducation: (id: string) => void;
    cancelEducationEdit: () => void;
    updateEducationDraft: (field: keyof EducationEditDraft, value: string) => void;
    updateEducationDate: (field: 'startDate' | 'endDate', value: string) => void;
};

type EducationSaveHandlers = {
    handleSaveEducation: () => Promise<void>;
};

type EducationDeleteHandlers = {
    requestDeleteEducation: (id: string) => void;
    performDeleteEducation: (id: string) => Promise<void>;
};

type EducationSelectionHandlers = {
    toggleEducationSelection: (id: string) => void;
};

type EducationHandlers = EducationDraftHandlers & EducationSaveHandlers & EducationDeleteHandlers & EducationSelectionHandlers;

const createEducationDraftHandlers = (
    domain: EducationDomain,
    helpers: ExperienceHelpers,
    state: EducationState,
    prefixes: DraftPrefixes
): EducationDraftHandlers => {
    const beginCreateEducation = () => {
        const draftId = createDraftId(prefixes.education);
        const draft = helpers.buildEducationDraft(undefined, draftId);
        state.setEditingEducationId(draftId);
        state.setEducationDraft(draft);
        domain.setItems((prev) => [helpers.buildDraftEducationView(draftId, draft), ...prev]);
        domain.setSelectedIds((prev) => addToSet(prev, draftId));
    };

    const beginEditEducation = (id: string) => {
        const source = domain.sourceMap.get(id);
        if (!source) {
            return;
        }
        state.setEditingEducationId(id);
        state.setEducationDraft(helpers.buildEducationDraft(source));
    };

    const cancelEducationEdit = () => {
        if (state.editingEducationId && isDraftId(state.editingEducationId, prefixes.education)) {
            domain.setItems((prev) => prev.filter((item) => item.id !== state.editingEducationId));
            domain.setSelectedIds((prev) => removeFromSet(prev, state.editingEducationId as string));
        }
        state.setEditingEducationId(null);
        state.setEducationDraft(null);
    };

    const updateEducationDraft = (field: keyof EducationEditDraft, value: string) => {
        state.setEducationDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    const updateEducationDate = (field: 'startDate' | 'endDate', value: string) => {
        state.setEducationDraft((prev) => {
            if (!prev) {
                return prev;
            }
            const next = {
                ...prev,
                [field]: value,
            };
            const safeRange = helpers.resolveSafeDateRange(next.startDate, next.endDate);
            return {
                ...next,
                startDate: safeRange.start,
                endDate: safeRange.end,
            };
        });
    };

    return {
        beginCreateEducation,
        beginEditEducation,
        cancelEducationEdit,
        updateEducationDraft,
        updateEducationDate,
    };
};

const createEducationSaveHandlers = (
    domain: EducationDomain,
    helpers: ExperienceHelpers,
    state: EducationState,
    prefixes: DraftPrefixes,
    draftHandlers: EducationDraftHandlers
): EducationSaveHandlers => {
    const applyEducationDetail = (
        detail: ExperienceDetail,
        options: { select: boolean; replacedId?: string }
    ) => {
        const item: ExperienceListItem = {
            master: detail.master,
            latest_version: detail.latest_version,
        };
        domain.setSourceMap((prev) => setMapEntry(prev, detail.master.id, item));
        const view = helpers.buildEducationView(item);
        domain.setItems((prev) => {
            const next = prev.filter((entry) => entry.id !== options.replacedId);
            const index = next.findIndex((entry) => entry.id === detail.master.id);
            if (index >= 0) {
                next[index] = view;
                return next;
            }
            next.push(view);
            return next;
        });
        if (options.select) {
            domain.setSelectedIds((prev) => addToSet(prev, detail.master.id));
        }
        if (options.replacedId) {
            domain.setSelectedIds((prev) => removeFromSet(prev, options.replacedId as string));
        }
    };

    const handleSaveEducation = async () => {
        if (!state.educationDraft || state.isSavingEducation) {
            return;
        }
        state.setIsSavingEducation(true);
        try {
            if (state.editingEducationId && !isDraftId(state.editingEducationId, prefixes.education)) {
                const source = domain.sourceMap.get(state.editingEducationId);
                if (!source) {
                    throw new Error('缺少教育经历源数据');
                }
                const payload = helpers.buildEducationVersionPayload(source, state.educationDraft);
                const detail = await experienceService.update(state.editingEducationId, { version: payload });
                applyEducationDetail(detail, { select: false });
            } else {
                const payload = helpers.buildEducationVersionPayload(null, state.educationDraft);
                const detail = await experienceService.create({
                    category: 'education',
                    version: payload,
                });
                const shouldSelect = state.editingEducationId
                    ? domain.selectedIds.has(state.editingEducationId)
                    : true;
                applyEducationDetail(detail, {
                    select: shouldSelect,
                    replacedId: state.editingEducationId ?? undefined,
                });
            }
            draftHandlers.cancelEducationEdit();
        } catch (error) {
            console.error('[ResumeEditor] 保存教育经历失败:', error);
        } finally {
            state.setIsSavingEducation(false);
        }
    };

    return { handleSaveEducation };
};

const createEducationDeleteHandlers = (
    domain: EducationDomain,
    state: EducationState,
    prefixes: DraftPrefixes,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    draftHandlers: EducationDraftHandlers
): EducationDeleteHandlers => {
    const requestDeleteEducation = (id: string) => {
        if (state.deletingEducationIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'education',
            title: confirmCopy.education.title,
            description: confirmCopy.education.description,
        });
    };

    const performDeleteEducation = async (id: string) => {
        if (state.deletingEducationIds.has(id)) {
            return;
        }
        if (isDraftId(id, prefixes.education)) {
            domain.setItems((prev) => prev.filter((item) => item.id !== id));
            domain.setSelectedIds((prev) => removeFromSet(prev, id));
            if (state.editingEducationId === id) {
                state.setEditingEducationId(null);
                state.setEducationDraft(null);
            }
            return;
        }
        try {
            await runWithFlag(id, state.deletingEducationIds, state.setDeletingEducationIds, async () => {
                await experienceService.delete(id);
                domain.setItems((prev) => prev.filter((item) => item.id !== id));
                domain.setSourceMap((prev) => deleteMapEntry(prev, id));
                domain.setSelectedIds((prev) => removeFromSet(prev, id));
                if (state.editingEducationId === id) {
                    draftHandlers.cancelEducationEdit();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除教育经历失败:', error);
        }
    };

    return { requestDeleteEducation, performDeleteEducation };
};

const createEducationSelectionHandlers = (domain: EducationDomain): EducationSelectionHandlers => {
    const toggleEducationSelection = (id: string) => {
        domain.setSelectedIds((prev) => toggleInSet(prev, id));
    };
    return { toggleEducationSelection };
};

const createEducationHandlers = (
    domain: EducationDomain,
    helpers: ExperienceHelpers,
    state: EducationState,
    prefixes: DraftPrefixes,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void
): EducationHandlers => {
    const draftHandlers = createEducationDraftHandlers(domain, helpers, state, prefixes);
    const saveHandlers = createEducationSaveHandlers(domain, helpers, state, prefixes, draftHandlers);
    const deleteHandlers = createEducationDeleteHandlers(
        domain,
        state,
        prefixes,
        confirmCopy,
        openDeleteConfirm,
        draftHandlers
    );
    const selectionHandlers = createEducationSelectionHandlers(domain);

    return {
        ...draftHandlers,
        ...saveHandlers,
        ...deleteHandlers,
        ...selectionHandlers,
    };
};

type CertificationDraftHandlers = {
    beginCreateCertification: () => void;
    beginEditCertification: (id: string) => void;
    cancelCertificationEdit: () => void;
    updateCertificationDraft: (field: keyof CertificationEditDraft, value: string) => void;
};

type CertificationSaveHandlers = {
    handleSaveCertification: () => Promise<void>;
};

type CertificationDeleteHandlers = {
    requestDeleteCertification: (id: string) => void;
    performDeleteCertification: (id: string) => Promise<void>;
};

type CertificationSelectionHandlers = {
    toggleCertificationSelection: (id: string) => void;
};

type CertificationHandlers = CertificationDraftHandlers
    & CertificationSaveHandlers
    & CertificationDeleteHandlers
    & CertificationSelectionHandlers;

const createCertificationDraftHandlers = (
    domain: CertificationDomain,
    helpers: ExperienceHelpers,
    state: CertificationState,
    prefixes: DraftPrefixes
): CertificationDraftHandlers => {
    const beginCreateCertification = () => {
        const draftId = createDraftId(prefixes.certification);
        const draft = helpers.buildCertificationDraft();
        state.setEditingCertificationId(draftId);
        state.setCertificationDraft(draft);
        domain.setItems((prev) => [helpers.buildDraftCertificationView(draftId, draft), ...prev]);
    };

    const beginEditCertification = (id: string) => {
        const source = domain.sourceMap.get(id);
        if (!source) {
            return;
        }
        if (state.editingCertificationId && isDraftId(state.editingCertificationId, prefixes.certification)) {
            cancelCertificationEdit();
        }
        state.setEditingCertificationId(id);
        state.setCertificationDraft(helpers.buildCertificationDraft(source));
    };

    const cancelCertificationEdit = () => {
        if (state.editingCertificationId && isDraftId(state.editingCertificationId, prefixes.certification)) {
            domain.setItems((prev) => prev.filter((item) => item.id !== state.editingCertificationId));
        }
        state.setEditingCertificationId(null);
        state.setCertificationDraft(null);
    };

    const updateCertificationDraft = (field: keyof CertificationEditDraft, value: string) => {
        state.setCertificationDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    return {
        beginCreateCertification,
        beginEditCertification,
        cancelCertificationEdit,
        updateCertificationDraft,
    };
};

const createCertificationSaveHandlers = (
    domain: CertificationDomain,
    helpers: ExperienceHelpers,
    state: CertificationState,
    prefixes: DraftPrefixes,
    draftHandlers: CertificationDraftHandlers
): CertificationSaveHandlers => {
    const applyCertificationUpdate = (
        record: CertificationRecord,
        options?: { select?: boolean; replacedId?: string }
    ) => {
        const shouldSelect = options?.select ?? false;
        domain.setSourceMap((prev) => setMapEntry(prev, record.id, record));
        const view = helpers.buildCertificationView(record);
        domain.setItems((prev) => {
            const next = [...prev];
            const replacedIndex = options?.replacedId
                ? next.findIndex((entry) => entry.id === options.replacedId)
                : -1;
            if (replacedIndex >= 0) {
                next[replacedIndex] = view;
                return next;
            }
            const index = next.findIndex((entry) => entry.id === record.id);
            if (index >= 0) {
                next[index] = view;
                return next;
            }
            next.push(view);
            return next;
        });
        if (shouldSelect) {
            domain.setSelectedIds((prev) => addToSet(prev, record.id));
        }
    };

    const handleSaveCertification = async () => {
        if (!state.certificationDraft || state.isSavingCertification) {
            return;
        }
        state.setIsSavingCertification(true);
        try {
            const payload = helpers.buildCertificationPayload(state.certificationDraft);
            const isDraft = state.editingCertificationId
                ? isDraftId(state.editingCertificationId, prefixes.certification)
                : true;
            if (state.editingCertificationId && !isDraft) {
                const record = await certificationsService.update(state.editingCertificationId, payload);
                applyCertificationUpdate(record, { select: false });
            } else {
                const record = await certificationsService.create(payload);
                applyCertificationUpdate(record, {
                    select: true,
                    replacedId: isDraft ? state.editingCertificationId ?? undefined : undefined,
                });
            }
            draftHandlers.cancelCertificationEdit();
        } catch (error) {
            console.error('[ResumeEditor] 保存证书失败:', error);
        } finally {
            state.setIsSavingCertification(false);
        }
    };

    return { handleSaveCertification };
};

const createCertificationDeleteHandlers = (
    domain: CertificationDomain,
    state: CertificationState,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    matchScore: MatchScoreDomain,
    draftHandlers: CertificationDraftHandlers
): CertificationDeleteHandlers => {
    const requestDeleteCertification = (id: string) => {
        if (state.deletingCertificationIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'certification',
            title: confirmCopy.certification.title,
            description: confirmCopy.certification.description,
        });
    };

    const performDeleteCertification = async (id: string) => {
        if (state.deletingCertificationIds.has(id)) {
            return;
        }
        try {
            await runWithFlag(id, state.deletingCertificationIds, state.setDeletingCertificationIds, async () => {
                await certificationsService.delete(id);
                domain.setItems((prev) => prev.filter((item) => item.id !== id));
                domain.setSourceMap((prev) => deleteMapEntry(prev, id));
                domain.setSelectedIds((prev) => removeFromSet(prev, id));
                matchScore.setCertificationMatchScores((prev) => {
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                });
                if (state.editingCertificationId === id) {
                    draftHandlers.cancelCertificationEdit();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除证书失败:', error);
        }
    };

    return { requestDeleteCertification, performDeleteCertification };
};

const createCertificationSelectionHandlers = (domain: CertificationDomain): CertificationSelectionHandlers => {
    const toggleCertificationSelection = (id: string) => {
        domain.setSelectedIds((prev) => toggleInSet(prev, id));
    };
    return { toggleCertificationSelection };
};

const createCertificationHandlers = (
    domain: CertificationDomain,
    helpers: ExperienceHelpers,
    state: CertificationState,
    prefixes: DraftPrefixes,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    matchScore: MatchScoreDomain
): CertificationHandlers => {
    const draftHandlers = createCertificationDraftHandlers(domain, helpers, state, prefixes);
    const saveHandlers = createCertificationSaveHandlers(domain, helpers, state, prefixes, draftHandlers);
    const deleteHandlers = createCertificationDeleteHandlers(
        domain,
        state,
        confirmCopy,
        openDeleteConfirm,
        matchScore,
        draftHandlers
    );
    const selectionHandlers = createCertificationSelectionHandlers(domain);

    return {
        ...draftHandlers,
        ...saveHandlers,
        ...deleteHandlers,
        ...selectionHandlers,
    };
};

type SkillDraftHandlers = {
    beginCreateSkillType: () => void;
    beginCreateSkillInGroup: (groupName: string) => void;
    beginEditSkill: (id: string) => void;
    cancelSkillEdit: () => void;
    updateSkillDraft: (field: keyof SkillEditDraft, value: string) => void;
};

type SkillSaveHandlers = {
    handleSaveSkill: () => Promise<void>;
};

type SkillRenameHandlers = {
    handleRenameCategory: (oldName: string, newName: string) => Promise<void>;
};

type SkillDeleteHandlers = {
    requestDeleteSkill: (id: string) => void;
    requestDeleteSkillCategory: (categoryName: string) => void;
    performDeleteSkill: (id: string) => Promise<void>;
    performDeleteSkillCategory: (categoryName: string) => Promise<void>;
};

type SkillSelectionHandlers = {
    toggleSkillSelection: (id: string) => void;
};

type SkillHandlers = SkillDraftHandlers
    & SkillSaveHandlers
    & SkillRenameHandlers
    & SkillDeleteHandlers
    & SkillSelectionHandlers;

type SkillHelperContext = {
    findSkillMeta: (id: string) => { id: string; name: string; category: string } | null;
    buildSkillDraft: (meta?: { id?: string; name?: string; category?: string }) => SkillEditDraft;
    getSkillIdsByCategory: (groupName: string) => string[];
    refreshSkillState: (options?: { selectId?: string }) => Promise<void>;
    resetRenamingCategory: () => void;
};

const createSkillHelperContext = (
    domain: SkillDomain,
    helpers: ExperienceHelpers,
    state: SkillState,
    defaults: ExperienceDefaults,
    matchScore: MatchScoreDomain
): SkillHelperContext => {
    const findSkillMeta = (id: string) => {
        for (const group of domain.groups) {
            const skill = group.skills.find((item) => item.id === id);
            if (skill) {
                return {
                    id: skill.id,
                    name: skill.name,
                    category: group.name,
                };
            }
        }
        return null;
    };

    const buildSkillDraft = (meta?: { id?: string; name?: string; category?: string }): SkillEditDraft => ({
        id: meta?.id,
        name: meta?.name ?? defaults.skillName,
        category: meta?.category ?? defaults.skillCategory,
    });

    const getSkillGroupByName = (groupName: string) => (
        domain.groups.find((group) => group.name === groupName) || null
    );

    const getSkillIdsByCategory = (groupName: string) => {
        const group = getSkillGroupByName(groupName);
        return group ? group.skills.map((skill) => skill.id) : [];
    };

    const refreshSkillState = async (options?: { selectId?: string }) => {
        const items = await skillsService.list({ force: true });
        domain.setGroups(helpers.buildSkillGroups(items));
        const validIds = new Set(items.map((skill) => skill.id));
        domain.setSelectedIds((prev) => {
            const next = new Set([...prev].filter((id) => validIds.has(id)));
            if (options?.selectId) {
                next.add(options.selectId);
            }
            return next;
        });
        matchScore.setSkillMatchScores((prev) => {
            const next = new Map(prev);
            for (const key of next.keys()) {
                if (!validIds.has(key)) {
                    next.delete(key);
                }
            }
            return next;
        });
    };

    const resetRenamingCategory = () => {
        state.setRenamingCategoryTarget(null);
        state.setRenamingCategoryDraft('');
    };

    return {
        findSkillMeta,
        buildSkillDraft,
        getSkillIdsByCategory,
        refreshSkillState,
        resetRenamingCategory,
    };
};

const createSkillDraftHandlers = (
    state: SkillState,
    helperContext: SkillHelperContext
): SkillDraftHandlers => {
    const beginCreateSkillType = () => {
        state.setEditingSkillId(null);
        state.setSkillDraft(helperContext.buildSkillDraft({ name: '', category: '' }));
        state.setSkillDraftContext({ mode: 'type' });
    };

    const beginCreateSkillInGroup = (groupName: string) => {
        state.setEditingSkillId(null);
        state.setSkillDraft(helperContext.buildSkillDraft({ name: '', category: groupName }));
        state.setSkillDraftContext({ mode: 'group', groupName });
    };

    const beginEditSkill = (id: string) => {
        const meta = helperContext.findSkillMeta(id);
        if (!meta) {
            return;
        }
        state.setEditingSkillId(id);
        state.setSkillDraft(helperContext.buildSkillDraft(meta));
        state.setSkillDraftContext({ mode: 'edit', groupName: meta.category });
    };

    const cancelSkillEdit = () => {
        state.setEditingSkillId(null);
        state.setSkillDraft(null);
        state.setSkillDraftContext(null);
    };

    const updateSkillDraft = (field: keyof SkillEditDraft, value: string) => {
        state.setSkillDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    return {
        beginCreateSkillType,
        beginCreateSkillInGroup,
        beginEditSkill,
        cancelSkillEdit,
        updateSkillDraft,
    };
};

const createSkillSaveHandlers = (
    state: SkillState,
    defaults: ExperienceDefaults,
    helperContext: SkillHelperContext,
    draftHandlers: SkillDraftHandlers
): SkillSaveHandlers => {
    const buildSkillPayload = (draft: SkillEditDraft) => ({
        name: draft.name.trim() || defaults.skillName,
        category: draft.category.trim() || defaults.skillCategory,
    });

    const handleSaveSkill = async () => {
        if (!state.skillDraft || state.isSavingSkill) {
            return;
        }
        state.setIsSavingSkill(true);
        try {
            const payload = buildSkillPayload(state.skillDraft);
            if (state.editingSkillId) {
                await skillsService.update(state.editingSkillId, payload);
                await helperContext.refreshSkillState();
            } else {
                const record = await skillsService.create(payload);
                await helperContext.refreshSkillState({ selectId: record.id });
            }
            draftHandlers.cancelSkillEdit();
        } catch (error) {
            console.error('[ResumeEditor] 保存技能失败:', error);
        } finally {
            state.setIsSavingSkill(false);
        }
    };

    return { handleSaveSkill };
};

const createSkillRenameHandlers = (
    domain: SkillDomain,
    helperContext: SkillHelperContext
): SkillRenameHandlers => {
    const handleRenameCategory = async (oldName: string, newName: string) => {
        const trimmedNewName = newName.trim();
        if (!trimmedNewName || trimmedNewName === oldName) {
            helperContext.resetRenamingCategory();
            return;
        }

        try {
            const skillsInGroup = domain.groups.find((g) => g.name === oldName)?.skills || [];
            await Promise.all(
                skillsInGroup.map((skill) =>
                    skillsService.update(skill.id, { category: trimmedNewName })
                )
            );
            await helperContext.refreshSkillState();
        } catch (error) {
            console.error('[ResumeEditor] 重命名分类失败:', error);
        } finally {
            helperContext.resetRenamingCategory();
        }
    };

    return { handleRenameCategory };
};

const createSkillDeleteHandlers = (
    domain: SkillDomain,
    state: SkillState,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    helperContext: SkillHelperContext,
    draftHandlers: SkillDraftHandlers
): SkillDeleteHandlers => {
    const requestDeleteSkill = (id: string) => {
        if (state.deletingSkillIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'skill',
            title: confirmCopy.skill.title,
            description: confirmCopy.skill.description,
        });
    };

    const requestDeleteSkillCategory = (categoryName: string) => {
        if (state.deletingSkillCategories.has(categoryName)) {
            return;
        }
        openDeleteConfirm({
            id: categoryName,
            type: 'skillCategory',
            title: confirmCopy.skillCategory.title,
            description: confirmCopy.skillCategory.description,
        });
    };

    const performDeleteSkillCategory = async (categoryName: string) => {
        if (state.deletingSkillCategories.has(categoryName)) {
            return;
        }
        const skillIds = helperContext.getSkillIdsByCategory(categoryName);
        if (skillIds.length === 0) {
            return;
        }
        try {
            await runWithFlag(
                categoryName,
                state.deletingSkillCategories,
                state.setDeletingSkillCategories,
                async () => {
                    if (state.renamingCategoryTarget === categoryName) {
                        helperContext.resetRenamingCategory();
                    }
                    if (state.editingSkillId && skillIds.includes(state.editingSkillId)) {
                        draftHandlers.cancelSkillEdit();
                    }
                    if (state.skillDraftContext?.groupName === categoryName) {
                        draftHandlers.cancelSkillEdit();
                    }
                    await Promise.all(skillIds.map((id) => skillsService.delete(id)));
                    await helperContext.refreshSkillState();
                }
            );
        } catch (error) {
            console.error('[ResumeEditor] 删除技能分类失败:', error);
        }
    };

    const performDeleteSkill = async (id: string) => {
        if (state.deletingSkillIds.has(id)) {
            return;
        }
        try {
            await runWithFlag(id, state.deletingSkillIds, state.setDeletingSkillIds, async () => {
                await skillsService.delete(id);
                await helperContext.refreshSkillState();
                if (state.editingSkillId === id) {
                    draftHandlers.cancelSkillEdit();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除技能失败:', error);
        }
    };

    return {
        requestDeleteSkill,
        requestDeleteSkillCategory,
        performDeleteSkill,
        performDeleteSkillCategory,
    };
};

const createSkillSelectionHandlers = (domain: SkillDomain): SkillSelectionHandlers => {
    const toggleSkillSelection = (id: string) => {
        domain.setSelectedIds((prev) => toggleInSet(prev, id));
    };
    return { toggleSkillSelection };
};

const createSkillHandlers = (
    domain: SkillDomain,
    helpers: ExperienceHelpers,
    state: SkillState,
    defaults: ExperienceDefaults,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    matchScore: MatchScoreDomain
): SkillHandlers => {
    const helperContext = createSkillHelperContext(domain, helpers, state, defaults, matchScore);
    const draftHandlers = createSkillDraftHandlers(state, helperContext);
    const saveHandlers = createSkillSaveHandlers(state, defaults, helperContext, draftHandlers);
    const renameHandlers = createSkillRenameHandlers(domain, helperContext);
    const deleteHandlers = createSkillDeleteHandlers(
        domain,
        state,
        confirmCopy,
        openDeleteConfirm,
        helperContext,
        draftHandlers
    );
    const selectionHandlers = createSkillSelectionHandlers(domain);

    return {
        ...draftHandlers,
        ...saveHandlers,
        ...renameHandlers,
        ...deleteHandlers,
        ...selectionHandlers,
    };
};

export const useExperienceActions = (options: UseExperienceActionsOptions): UseExperienceActionsResult => {
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

    const openDeleteConfirm = useCallback((payload: ConfirmDialogState) => {
        setConfirmDialog(payload);
    }, []);

    const handleCancelDelete = useCallback(() => {
        setConfirmDialog(null);
    }, []);

    const experienceState = useExperienceState();
    const educationState = useEducationState();
    const certificationState = useCertificationState();
    const skillState = useSkillState();

    const draftHandlers = createExperienceDraftLifecycleHandlers(
        options.experience,
        options.helpers,
        experienceState,
        options.draftPrefixes
    );
    const editHandlers = createExperienceEditHandlers(
        options.experience,
        options.helpers,
        experienceState,
        draftHandlers
    );
    const updateHelpers = createExperienceUpdateHelpers(options.experience, options.helpers);
    const saveHandlers = createExperienceSaveHandlers(
        options.resumeId,
        options.jdText,
        options.experience,
        options.helpers,
        options.defaults,
        experienceState,
        updateHelpers,
        draftHandlers,
        options.applyResumeDetail
    );
    const deleteHandlers = createExperienceDeleteHandlers(
        options.experience,
        experienceState,
        editHandlers,
        draftHandlers,
        options.draftPrefixes,
        openDeleteConfirm,
        options.confirmCopy
    );
    const experienceSelection = createExperienceSelectionHandlers(options.experience);

    const educationHandlers = createEducationHandlers(
        options.education,
        options.helpers,
        educationState,
        options.draftPrefixes,
        options.confirmCopy,
        openDeleteConfirm
    );

    const certificationHandlers = createCertificationHandlers(
        options.certification,
        options.helpers,
        certificationState,
        options.draftPrefixes,
        options.confirmCopy,
        openDeleteConfirm,
        options.jdMatch
    );

    const skillHandlers = createSkillHandlers(
        options.skill,
        options.helpers,
        skillState,
        options.defaults,
        options.confirmCopy,
        openDeleteConfirm,
        options.jdMatch
    );

    const handleConfirmDelete = useCallback(() => {
        if (!confirmDialog) {
            return;
        }
        const { id, type } = confirmDialog;
        setConfirmDialog(null);
        if (type === 'experience') {
            void deleteHandlers.performDeleteExperience(id);
            return;
        }
        if (type === 'education') {
            void educationHandlers.performDeleteEducation(id);
            return;
        }
        if (type === 'certification') {
            void certificationHandlers.performDeleteCertification(id);
            return;
        }
        if (type === 'skill') {
            void skillHandlers.performDeleteSkill(id);
            return;
        }
        if (type === 'skillCategory') {
            void skillHandlers.performDeleteSkillCategory(id);
        }
    }, [
        certificationHandlers,
        confirmDialog,
        deleteHandlers,
        educationHandlers,
        skillHandlers,
    ]);

    return {
        confirmDialog,
        handleConfirmDelete,
        handleCancelDelete,
        experience: {
            editingExpId: experienceState.editingExpId,
            editingDraft: experienceState.editingDraft,
            syncToMaster: experienceState.syncToMaster,
            setSyncToMaster: experienceState.setSyncToMaster,
            isSavingExperience: experienceState.isSavingExperience,
            isAddingExperience: experienceState.isAddingExperience,
            isPolishing: experienceState.isPolishing,
            deletingExperienceIds: experienceState.deletingExperienceIds,
            handleAddExperience: async (category) => {
                if (experienceState.isAddingExperience) {
                    return;
                }
                experienceState.setIsAddingExperience(true);
                try {
                    draftHandlers.addDraftExperience(category);
                } finally {
                    experienceState.setIsAddingExperience(false);
                }
            },
            startEditingExperience: editHandlers.startEditingExperience,
            cancelEditingExperience: editHandlers.cancelEditingExperience,
            updateEditingStar: editHandlers.updateEditingStar,
            updateEditingMeta: editHandlers.updateEditingMeta,
            updateEditingDate: editHandlers.updateEditingDate,
            handleSaveExperience: saveHandlers.handleSaveExperience,
            handlePolishWithJD: saveHandlers.handlePolishWithJD,
            requestDeleteExperience: deleteHandlers.requestDeleteExperience,
        },
        education: {
            editingEducationId: educationState.editingEducationId,
            educationDraft: educationState.educationDraft,
            isSavingEducation: educationState.isSavingEducation,
            deletingEducationIds: educationState.deletingEducationIds,
            beginCreateEducation: educationHandlers.beginCreateEducation,
            beginEditEducation: educationHandlers.beginEditEducation,
            cancelEducationEdit: educationHandlers.cancelEducationEdit,
            updateEducationDraft: educationHandlers.updateEducationDraft,
            updateEducationDate: educationHandlers.updateEducationDate,
            handleSaveEducation: educationHandlers.handleSaveEducation,
            requestDeleteEducation: educationHandlers.requestDeleteEducation,
        },
        certification: {
            editingCertificationId: certificationState.editingCertificationId,
            certificationDraft: certificationState.certificationDraft,
            isSavingCertification: certificationState.isSavingCertification,
            deletingCertificationIds: certificationState.deletingCertificationIds,
            beginCreateCertification: certificationHandlers.beginCreateCertification,
            beginEditCertification: certificationHandlers.beginEditCertification,
            cancelCertificationEdit: certificationHandlers.cancelCertificationEdit,
            updateCertificationDraft: certificationHandlers.updateCertificationDraft,
            handleSaveCertification: certificationHandlers.handleSaveCertification,
            requestDeleteCertification: certificationHandlers.requestDeleteCertification,
        },
        skill: {
            editingSkillId: skillState.editingSkillId,
            skillDraft: skillState.skillDraft,
            skillDraftContext: skillState.skillDraftContext,
            isSavingSkill: skillState.isSavingSkill,
            deletingSkillIds: skillState.deletingSkillIds,
            deletingSkillCategories: skillState.deletingSkillCategories,
            renamingCategoryTarget: skillState.renamingCategoryTarget,
            renamingCategoryDraft: skillState.renamingCategoryDraft,
            setRenamingCategoryTarget: skillState.setRenamingCategoryTarget,
            setRenamingCategoryDraft: skillState.setRenamingCategoryDraft,
            beginCreateSkillType: skillHandlers.beginCreateSkillType,
            beginCreateSkillInGroup: skillHandlers.beginCreateSkillInGroup,
            beginEditSkill: skillHandlers.beginEditSkill,
            cancelSkillEdit: skillHandlers.cancelSkillEdit,
            updateSkillDraft: skillHandlers.updateSkillDraft,
            handleSaveSkill: skillHandlers.handleSaveSkill,
            handleRenameCategory: skillHandlers.handleRenameCategory,
            requestDeleteSkill: skillHandlers.requestDeleteSkill,
            requestDeleteSkillCategory: skillHandlers.requestDeleteSkillCategory,
        },
        selection: {
            toggleExperienceSelection: experienceSelection.toggleExperienceSelection,
            toggleEducationSelection: educationHandlers.toggleEducationSelection,
            toggleCertificationSelection: certificationHandlers.toggleCertificationSelection,
            toggleSkillSelection: skillHandlers.toggleSkillSelection,
        },
    };
};
