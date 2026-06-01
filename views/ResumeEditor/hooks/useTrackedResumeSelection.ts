import { useCallback, useEffect, useMemo, type MutableRefObject } from 'react';
import type { SkillGroupView } from '../../../types/resume';
import {
    buildSelectionSnapshot,
    toggleGroupedSelectionSnapshotIds,
    toggleSelectionSnapshotIds,
    type ManualSelectionSnapshot,
} from '../autoAssemblyUtils';

type SelectionHandlers = {
    toggleExperienceSelection: (id: string) => void;
    toggleEducationSelection: (id: string) => void;
    toggleCertificationSelection: (id: string) => void;
    toggleSkillSelection: (id: string) => void;
    toggleSkillGroupSelection: (groupName: string, skillIds?: string[]) => void;
};

type UseTrackedResumeSelectionParams = {
    selection: SelectionHandlers;
    skillGroups: SkillGroupView[];
    selectedExpIds: Set<string>;
    selectedCertIds: Set<string>;
    selectedSkillIds: Set<string>;
    manualSelectionVersionRef: MutableRefObject<number>;
    manualSelectionSnapshotRef: MutableRefObject<ManualSelectionSnapshot>;
    isProgrammaticSelectionUpdateRef: MutableRefObject<boolean>;
};

export const useTrackedResumeSelection = ({
    selection,
    skillGroups,
    selectedExpIds,
    selectedCertIds,
    selectedSkillIds,
    manualSelectionVersionRef,
    manualSelectionSnapshotRef,
    isProgrammaticSelectionUpdateRef,
}: UseTrackedResumeSelectionParams) => {
    const markManualSelectionChanged = useCallback(() => {
        manualSelectionVersionRef.current += 1;
    }, [manualSelectionVersionRef]);

    const updateManualSelectionSnapshot = useCallback(
        (updater: (snapshot: ManualSelectionSnapshot) => ManualSelectionSnapshot) => {
            manualSelectionSnapshotRef.current = updater(
                buildSelectionSnapshot(selectedExpIds, selectedCertIds, selectedSkillIds)
            );
        },
        [manualSelectionSnapshotRef, selectedCertIds, selectedExpIds, selectedSkillIds]
    );

    useEffect(() => {
        if (isProgrammaticSelectionUpdateRef.current) {
            return;
        }
        manualSelectionSnapshotRef.current = buildSelectionSnapshot(
            selectedExpIds,
            selectedCertIds,
            selectedSkillIds
        );
    }, [
        isProgrammaticSelectionUpdateRef,
        manualSelectionSnapshotRef,
        selectedCertIds,
        selectedExpIds,
        selectedSkillIds,
    ]);

    return useMemo(() => ({
        toggleExperienceSelection: (id: string) => {
            markManualSelectionChanged();
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                experienceIds: toggleSelectionSnapshotIds(snapshot.experienceIds, id),
            }));
            selection.toggleExperienceSelection(id);
        },
        toggleEducationSelection: (id: string) => {
            markManualSelectionChanged();
            selection.toggleEducationSelection(id);
        },
        toggleCertificationSelection: (id: string) => {
            markManualSelectionChanged();
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                certificationIds: toggleSelectionSnapshotIds(snapshot.certificationIds, id),
            }));
            selection.toggleCertificationSelection(id);
        },
        toggleSkillSelection: (id: string) => {
            markManualSelectionChanged();
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                skillIds: toggleSelectionSnapshotIds(snapshot.skillIds, id),
            }));
            selection.toggleSkillSelection(id);
        },
        toggleSkillGroupSelection: (groupName: string, skillIds?: string[]) => {
            markManualSelectionChanged();
            const targetSkillIds = skillIds
                ?? skillGroups.find((item) => item.name === groupName)?.skills.map((item) => item.id)
                ?? [];
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                skillIds: toggleGroupedSelectionSnapshotIds(
                    snapshot.skillIds,
                    targetSkillIds
                ),
            }));
            selection.toggleSkillGroupSelection(groupName, targetSkillIds);
        },
    }), [markManualSelectionChanged, selection, skillGroups, updateManualSelectionSnapshot]);
};
