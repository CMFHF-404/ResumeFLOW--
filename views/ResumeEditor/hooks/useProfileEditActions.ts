import {
    useCallback,
    useLayoutEffect,
    useRef,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import { isAuthContextChangedError } from '../../../services/apiClient';
import { profileService } from '../../../services/profileService';
import {
    resumeService,
    waitForResumeMutations,
    type Resume,
    type ResumeDetail,
} from '../../../services/resumeService';
import type { ProfileSyncMode, ResumeEditorProfile } from '../../../types/resume';
import { mergeLinkedInLink } from '../../profileUtils';
import { PROFILE_SYNC_MODES } from '../constants';
import { buildProfileFromService } from '../helpers';

type UseProfileEditActionsParams = {
    authUserKey: string | null;
    profile: ResumeEditorProfile;
    setProfile: Dispatch<SetStateAction<ResumeEditorProfile>>;
    targetRole: string;
    setTargetRole: Dispatch<SetStateAction<string>>;
    originalTargetRole: string;
    setOriginalTargetRole: Dispatch<SetStateAction<string>>;
    resumeId: string | null;
    resumeDetail: ResumeDetail | null;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    updateDashboardCache: (updated: Resume) => void;
    flushResumeConfig: () => Promise<void>;
    originalProfile: ResumeEditorProfile;
    setOriginalProfile: Dispatch<SetStateAction<ResumeEditorProfile>>;
    profileSyncMode: ProfileSyncMode;
    setProfileSyncMode: Dispatch<SetStateAction<ProfileSyncMode>>;
    originalProfileSyncMode: ProfileSyncMode;
    setOriginalProfileSyncMode: Dispatch<SetStateAction<ProfileSyncMode>>;
    profileSocialLinks: Record<string, any>;
    setProfileSocialLinks: Dispatch<SetStateAction<Record<string, any>>>;
    isEditingProfile: boolean;
    setIsEditingProfile: Dispatch<SetStateAction<boolean>>;
    isSavingProfile: boolean;
    setIsSavingProfile: Dispatch<SetStateAction<boolean>>;
    showToastError: (message: string) => void;
};

export const useProfileEditActions = ({
    authUserKey,
    profile,
    setProfile,
    targetRole,
    setTargetRole,
    originalTargetRole,
    setOriginalTargetRole,
    resumeId,
    resumeDetail,
    applyResumeDetail,
    updateDashboardCache,
    flushResumeConfig,
    originalProfile,
    setOriginalProfile,
    profileSyncMode,
    setProfileSyncMode,
    originalProfileSyncMode,
    setOriginalProfileSyncMode,
    profileSocialLinks,
    setProfileSocialLinks,
    isEditingProfile,
    setIsEditingProfile,
    isSavingProfile,
    setIsSavingProfile,
    showToastError,
}: UseProfileEditActionsParams) => {
    const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
    const activeSaveRef = useRef<symbol | null>(null);

    useLayoutEffect(() => {
        activeSaveRef.current = null;
        setIsSavingProfile(false);
    }, [authUserKey, setIsSavingProfile]);

    const beginProfileEdit = useCallback(() => {
        setOriginalProfile({ ...profile });
        setOriginalTargetRole(targetRole);
        setOriginalProfileSyncMode(profileSyncMode);
        setIsEditingProfile(true);
    }, [profile, profileSyncMode, setIsEditingProfile, setOriginalProfile, setOriginalProfileSyncMode, setOriginalTargetRole, targetRole]);

    const cancelProfileEdit = useCallback(() => {
        setProfile({ ...originalProfile });
        setTargetRole(originalTargetRole);
        setProfileSyncMode(originalProfileSyncMode);
        setIsEditingProfile(false);
    }, [originalProfile, originalProfileSyncMode, originalTargetRole, setIsEditingProfile, setProfile, setProfileSyncMode, setTargetRole]);

    const handleSaveProfile = useCallback(async () => {
        if (isSavingProfile) {
            return;
        }
        let failureMessage = '保存个人信息失败';
        let latestResumeDetail = resumeDetail;
        const requestId = Symbol('save-profile');
        activeSaveRef.current = requestId;
        setIsSavingProfile(true);
        let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
        try {
            operation = await ownerGuard.beginOperation();
            if (activeSaveRef.current !== requestId) {
                return;
            }
            let nextProfile = { ...profile };
            if (profileSyncMode === PROFILE_SYNC_MODES.global) {
                const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, profile.linkedin);
                const updated = await profileService.updateProfile(
                    {
                        full_name: profile.name,
                        email: profile.email,
                        phone: profile.phone,
                        location: profile.location,
                        summary: profile.summary,
                        social_links: nextSocialLinks,
                    },
                    { expectedAuthCacheKey: operation.expectedAuthCacheKey },
                );
                await ownerGuard.assertOperationCurrent(operation);
                setProfileSocialLinks({ ...(updated.social_links || nextSocialLinks) });
                const updatedSnapshot = buildProfileFromService(updated);
                if (updatedSnapshot) {
                    nextProfile = updatedSnapshot;
                    setProfile(updatedSnapshot);
                }
                failureMessage = '个人信息已保存，但简历同步设置保存失败';
            }
            if (
                profileSyncMode === PROFILE_SYNC_MODES.global
                && originalProfileSyncMode === PROFILE_SYNC_MODES.global
                && resumeId
            ) {
                failureMessage = '个人信息已保存，但简历状态刷新失败';
                await waitForResumeMutations(resumeId);
                await ownerGuard.assertOperationCurrent(operation);
                latestResumeDetail = await resumeService.get(resumeId, {
                    expectedAuthCacheKey: operation.expectedAuthCacheKey,
                });
                await ownerGuard.assertOperationCurrent(operation);
                applyResumeDetail(latestResumeDetail);
            } else {
                await flushResumeConfig();
                await ownerGuard.assertOperationCurrent(operation);
            }
            setOriginalProfile({ ...nextProfile });
            setOriginalProfileSyncMode(profileSyncMode);
            failureMessage = '个人信息已保存，但意向岗位保存失败';
            const normalizedTargetRole = targetRole.trim();
            if (resumeId && normalizedTargetRole !== originalTargetRole.trim()) {
                const updatedResume = await resumeService.update(
                    resumeId,
                    { target_role: normalizedTargetRole },
                    { expectedAuthCacheKey: operation.expectedAuthCacheKey },
                );
                await ownerGuard.assertOperationCurrent(operation);
                if (latestResumeDetail) {
                    applyResumeDetail({
                        ...latestResumeDetail,
                        resume: {
                            ...latestResumeDetail.resume,
                            ...updatedResume,
                        },
                    });
                }
                updateDashboardCache(updatedResume);
            }
            setTargetRole(normalizedTargetRole);
            setOriginalTargetRole(normalizedTargetRole);
            setIsEditingProfile(false);
        } catch (error) {
            if (
                !isAuthContextChangedError(error)
                && operation
                && ownerGuard.isOperationCurrent(operation)
                && activeSaveRef.current === requestId
            ) {
                console.error('[ResumeEditor] 保存个人信息失败:', error);
                showToastError(failureMessage);
            }
        } finally {
            if (activeSaveRef.current === requestId) {
                activeSaveRef.current = null;
                setIsSavingProfile(false);
            }
        }
    }, [
        isSavingProfile,
        applyResumeDetail,
        flushResumeConfig,
        originalProfileSyncMode,
        originalTargetRole,
        ownerGuard,
        profile,
        profileSocialLinks,
        profileSyncMode,
        resumeDetail,
        resumeId,
        setIsEditingProfile,
        setIsSavingProfile,
        setOriginalProfile,
        setOriginalProfileSyncMode,
        setOriginalTargetRole,
        setProfile,
        setProfileSocialLinks,
        setTargetRole,
        showToastError,
        targetRole,
        updateDashboardCache,
    ]);

    return {
        beginProfileEdit,
        cancelProfileEdit,
        handleSaveProfile,
        isProfileReadOnly: !isEditingProfile || isSavingProfile,
    };
};
