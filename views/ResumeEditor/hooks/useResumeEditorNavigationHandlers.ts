import { useCallback } from 'react';

type SidebarTab = 'profile' | 'experience';

type UseResumeEditorNavigationHandlersParams = {
    hasBlockingState: () => boolean;
    setSidebarTab: (tab: SidebarTab) => void;
    openMobileDrawer: () => void;
    beginProfileEdit: () => void;
    cancelEditingExperience: () => void;
    startEditingExperience: (id: string) => void;
    beginEditCertification: (id: string) => void;
    beginEditSkill: (id: string) => void;
    beginCreateEducation: () => void;
    beginEditEducation: (id: string) => void;
};

const openDrawerOnMobile = (openMobileDrawer: () => void) => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
        openMobileDrawer();
    }
};

export const useResumeEditorNavigationHandlers = ({
    hasBlockingState,
    setSidebarTab,
    openMobileDrawer,
    beginProfileEdit,
    cancelEditingExperience,
    startEditingExperience,
    beginEditCertification,
    beginEditSkill,
    beginCreateEducation,
    beginEditEducation,
}: UseResumeEditorNavigationHandlersParams) => {
    const openExperiencePanel = useCallback(() => {
        setSidebarTab('experience');
        openDrawerOnMobile(openMobileDrawer);
    }, [openMobileDrawer, setSidebarTab]);

    const handleEditExperience = useCallback((id: string) => {
        if (hasBlockingState()) {
            return;
        }
        openExperiencePanel();
        startEditingExperience(id);
    }, [hasBlockingState, openExperiencePanel, startEditingExperience]);

    const handleEditCertification = useCallback((id: string) => {
        if (hasBlockingState()) {
            return;
        }
        cancelEditingExperience();
        openExperiencePanel();
        beginEditCertification(id);
    }, [beginEditCertification, cancelEditingExperience, hasBlockingState, openExperiencePanel]);

    const handleEditSkill = useCallback((id: string) => {
        if (hasBlockingState()) {
            return;
        }
        cancelEditingExperience();
        openExperiencePanel();
        beginEditSkill(id);
    }, [beginEditSkill, cancelEditingExperience, hasBlockingState, openExperiencePanel]);

    const handleSidebarTabSelect = useCallback((tab: SidebarTab) => {
        if (tab === 'profile' && hasBlockingState()) {
            return;
        }
        setSidebarTab(tab);
    }, [hasBlockingState, setSidebarTab]);

    const handleProfileTabSelected = useCallback(() => {
        cancelEditingExperience();
    }, [cancelEditingExperience]);

    const handlePreviewNavigateTab = useCallback((tab: SidebarTab) => {
        if (tab === 'profile' && hasBlockingState()) {
            return;
        }
        setSidebarTab(tab);
    }, [hasBlockingState, setSidebarTab]);

    const handleBeginProfileEdit = useCallback(() => {
        if (hasBlockingState()) {
            return;
        }
        beginProfileEdit();
    }, [beginProfileEdit, hasBlockingState]);

    const handleBeginCreateEducation = useCallback(() => {
        if (hasBlockingState()) {
            return;
        }
        beginCreateEducation();
    }, [beginCreateEducation, hasBlockingState]);

    const handleBeginEditEducation = useCallback((id: string) => {
        if (hasBlockingState()) {
            return;
        }
        beginEditEducation(id);
    }, [beginEditEducation, hasBlockingState]);

    return {
        handleBeginCreateEducation,
        handleBeginEditEducation,
        handleBeginProfileEdit,
        handleEditCertification,
        handleEditExperience,
        handleEditSkill,
        handlePreviewNavigateTab,
        handleProfileTabSelected,
        handleSidebarTabSelect,
    };
};
