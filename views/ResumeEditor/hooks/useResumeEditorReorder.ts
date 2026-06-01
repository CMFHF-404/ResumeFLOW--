import { useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { type DropPosition, moveItemWithDropPosition } from '../../../utils/dragSort';
import { trackModuleReordered } from '../../../utils/analyticsTracker';
import type {
    CertificationView,
    EducationView,
    ResumeExperienceView,
    SkillGroupView,
} from '../../../types/resume';
import { parseDragItemKey } from '../dragKeys';
import { compareByDateDesc, compareCertificationByDateDesc } from '../helpers';
import {
    mapDragTypeToModuleType,
    resolveModuleKey,
    type ModuleReorderContext,
    type ReorderStateSnapshot,
} from '../moduleReorderUtils';

type UseResumeEditorReorderParams = {
    authUserKey: string | null;
    experienceItems: ResumeExperienceView[];
    setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
    educations: EducationView[];
    setEducations: Dispatch<SetStateAction<EducationView[]>>;
    certifications: CertificationView[];
    setCertifications: Dispatch<SetStateAction<CertificationView[]>>;
    skillGroups: SkillGroupView[];
    setSkillGroups: Dispatch<SetStateAction<SkillGroupView[]>>;
    sectionOrder: string[];
    setSectionOrder: Dispatch<SetStateAction<string[]>>;
};

const resolveIndexPosition = <T,>(
    items: T[],
    predicate: (item: T) => boolean
) => {
    const index = items.findIndex(predicate);
    return index >= 0 ? index + 1 : null;
};

const resetExperienceSortForCategory = (
    items: ResumeExperienceView[],
    category: 'work' | 'project'
) => {
    const indices: number[] = [];
    const categoryItems: ResumeExperienceView[] = [];

    items.forEach((item, index) => {
        if (item.category !== category) return;
        indices.push(index);
        categoryItems.push(item);
    });

    if (categoryItems.length <= 1) {
        return items;
    }

    const sortedCategoryItems = [...categoryItems].sort(compareByDateDesc);
    const nextItems = [...items];
    indices.forEach((index, sortedIndex) => {
        nextItems[index] = sortedCategoryItems[sortedIndex];
    });
    return nextItems;
};

export const useResumeEditorReorder = ({
    authUserKey,
    experienceItems,
    setExperienceItems,
    educations,
    setEducations,
    certifications,
    setCertifications,
    skillGroups,
    setSkillGroups,
    sectionOrder,
    setSectionOrder,
}: UseResumeEditorReorderParams) => {
    const [isDragging, setIsDragging] = useState(false);
    const [draggedItemKey, setDraggedItemKey] = useState<string | null>(null);
    const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
    const lastItemHoverKeyRef = useRef<string | null>(null);
    const lastSectionHoverKeyRef = useRef<string | null>(null);
    const reorderContextRef = useRef<ModuleReorderContext | null>(null);
    const reorderStateSnapshotRef = useRef<ReorderStateSnapshot | null>(null);

    const resolveExperiencePosition = (id: string, category: 'work' | 'project') => {
        const items = experienceItems.filter((item) => item.category === category);
        return resolveIndexPosition(items, (item) => item.id === id);
    };

    const buildItemReorderContext = (itemKey: string): ModuleReorderContext | null => {
        const parsed = parseDragItemKey(itemKey);
        if (!parsed) {
            return null;
        }
        const moduleType = mapDragTypeToModuleType(parsed.type);
        if (parsed.type === 'experience') {
            const item = experienceItems.find((entry) => entry.id === parsed.id);
            if (!item) {
                return null;
            }
            const position = resolveExperiencePosition(parsed.id, item.category);
            if (!position) {
                return null;
            }
            return {
                moduleType,
                moduleKey: resolveModuleKey(moduleType, item.category),
                id: parsed.id,
                fromPosition: position,
                category: item.category,
            };
        }
        if (parsed.type === 'education') {
            const position = resolveIndexPosition(educations, (item) => item.id === parsed.id);
            if (!position) {
                return null;
            }
            return {
                moduleType,
                moduleKey: resolveModuleKey(moduleType),
                id: parsed.id,
                fromPosition: position,
            };
        }
        if (parsed.type === 'certification') {
            const position = resolveIndexPosition(certifications, (item) => item.id === parsed.id);
            if (!position) {
                return null;
            }
            return {
                moduleType,
                moduleKey: resolveModuleKey(moduleType),
                id: parsed.id,
                fromPosition: position,
            };
        }
        const position = resolveIndexPosition(skillGroups, (group) => group.name === parsed.id);
        if (!position) {
            return null;
        }
        return {
            moduleType,
            moduleKey: resolveModuleKey(moduleType),
            id: parsed.id,
            fromPosition: position,
        };
    };

    const resolveCurrentPosition = (context: ModuleReorderContext) => {
        switch (context.moduleType) {
            case 'experience':
                if (!context.category) {
                    return null;
                }
                return resolveExperiencePosition(context.id, context.category);
            case 'education':
                return resolveIndexPosition(educations, (item) => item.id === context.id);
            case 'certification':
                return resolveIndexPosition(certifications, (item) => item.id === context.id);
            case 'skill_group':
                return resolveIndexPosition(skillGroups, (group) => group.name === context.id);
            case 'section':
                return resolveIndexPosition(sectionOrder, (item) => item === context.id);
            default:
                return null;
        }
    };

    const finalizeReorderTracking = () => {
        const context = reorderContextRef.current;
        if (!context) {
            return;
        }
        const toPosition = resolveCurrentPosition(context);
        reorderContextRef.current = null;
        if (!toPosition || toPosition === context.fromPosition) {
            return;
        }
        trackModuleReordered({
            moduleType: context.moduleType,
            moduleKey: context.moduleKey,
            fromPosition: context.fromPosition,
            toPosition,
            sectionId: context.sectionId,
        }, authUserKey);
    };

    const captureReorderStateSnapshot = () => {
        reorderStateSnapshotRef.current = {
            experienceItems: [...experienceItems],
            educations: [...educations],
            certifications: [...certifications],
            skillGroups: [...skillGroups],
            sectionOrder: [...sectionOrder],
        };
    };

    const startItemReorder = (itemKey: string) => {
        captureReorderStateSnapshot();
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        setDraggedSectionId(null);
        setDraggedItemKey(itemKey);
        reorderContextRef.current = buildItemReorderContext(itemKey);
        setIsDragging(true);
    };

    const handleDragStart = (event: DragEvent, itemKey: string) => {
        startItemReorder(itemKey);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', itemKey);
    };

    const clearDragState = () => {
        setDraggedItemKey(null);
        setDraggedSectionId(null);
        setIsDragging(false);
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        reorderContextRef.current = null;
        reorderStateSnapshotRef.current = null;
    };

    const finishDragInteraction = () => {
        finalizeReorderTracking();
        clearDragState();
    };

    const cancelTouchDragInteraction = () => {
        const snapshot = reorderStateSnapshotRef.current;
        if (snapshot) {
            setExperienceItems(snapshot.experienceItems);
            setEducations(snapshot.educations);
            setCertifications(snapshot.certifications);
            setSkillGroups(snapshot.skillGroups);
            setSectionOrder(snapshot.sectionOrder);
        }
        clearDragState();
    };

    const handleItemDragHover = (targetItemKey: string, position: DropPosition) => {
        if (!draggedItemKey || draggedItemKey === targetItemKey) {
            return;
        }

        const hoverKey = `${targetItemKey}:${position}`;
        if (lastItemHoverKeyRef.current === hoverKey) {
            return;
        }
        lastItemHoverKeyRef.current = hoverKey;

        const dragged = parseDragItemKey(draggedItemKey);
        const target = parseDragItemKey(targetItemKey);
        if (!dragged || !target || dragged.type !== target.type) {
            return;
        }

        if (dragged.type === 'experience') {
            setExperienceItems((prev) => {
                const draggedIndex = prev.findIndex((item) => item.id === dragged.id);
                const targetIndex = prev.findIndex((item) => item.id === target.id);
                if (draggedIndex < 0 || targetIndex < 0) {
                    return prev;
                }
                if (prev[draggedIndex].category !== prev[targetIndex].category) {
                    return prev;
                }
                return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
            });
            return;
        }

        if (dragged.type === 'education') {
            setEducations((prev) => {
                const draggedIndex = prev.findIndex((item) => item.id === dragged.id);
                const targetIndex = prev.findIndex((item) => item.id === target.id);
                if (draggedIndex < 0 || targetIndex < 0) {
                    return prev;
                }
                return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
            });
            return;
        }

        if (dragged.type === 'certification') {
            setCertifications((prev) => {
                const draggedIndex = prev.findIndex((item) => item.id === dragged.id);
                const targetIndex = prev.findIndex((item) => item.id === target.id);
                if (draggedIndex < 0 || targetIndex < 0) {
                    return prev;
                }
                return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
            });
            return;
        }

        setSkillGroups((prev) => {
            const draggedIndex = prev.findIndex((group) => group.name === dragged.id);
            const targetIndex = prev.findIndex((group) => group.name === target.id);
            if (draggedIndex < 0 || targetIndex < 0) {
                return prev;
            }
            return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
        });
    };

    const handleItemDrop = (event: DragEvent) => {
        event.preventDefault();
        finishDragInteraction();
    };

    const handleResetSort = (category: 'work' | 'project') => {
        setExperienceItems((prev) => resetExperienceSortForCategory(prev, category));
    };

    const handleResetCertificationSort = () => {
        setCertifications((prev) => {
            if (prev.length <= 1) {
                return prev;
            }
            return [...prev].sort(compareCertificationByDateDesc);
        });
    };

    const startSectionReorder = (sectionId: string) => {
        captureReorderStateSnapshot();
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        setDraggedItemKey(null);
        setDraggedSectionId(sectionId);
        const sectionPosition = resolveIndexPosition(sectionOrder, (item) => item === sectionId);
        reorderContextRef.current = sectionPosition
            ? {
                moduleType: 'section',
                moduleKey: resolveModuleKey('section', undefined, sectionId),
                id: sectionId,
                fromPosition: sectionPosition,
                sectionId,
            }
            : null;
        setIsDragging(true);
    };

    const handleSectionDragStart = (event: DragEvent, sectionId: string) => {
        startSectionReorder(sectionId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', sectionId);
    };

    const handleSectionDragHover = (targetSectionId: string, position: DropPosition) => {
        if (!draggedSectionId || draggedSectionId === targetSectionId) {
            return;
        }

        const hoverKey = `${targetSectionId}:${position}`;
        if (lastSectionHoverKeyRef.current === hoverKey) {
            return;
        }
        lastSectionHoverKeyRef.current = hoverKey;
        setSectionOrder((prev) => {
            const draggedIndex = prev.indexOf(draggedSectionId);
            const targetIndex = prev.indexOf(targetSectionId);
            if (draggedIndex < 0 || targetIndex < 0) {
                return prev;
            }
            return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
        });
    };

    const handleSectionDrop = (event: DragEvent) => {
        event.preventDefault();
        finishDragInteraction();
    };

    return {
        isDragging,
        draggedItemKey,
        draggedSectionId,
        startItemReorder,
        handleDragStart,
        clearDragState,
        finishDragInteraction,
        cancelTouchDragInteraction,
        handleItemDragHover,
        handleItemDrop,
        handleResetSort,
        handleResetCertificationSort,
        startSectionReorder,
        handleSectionDragStart,
        handleSectionDragHover,
        handleSectionDrop,
    };
};
