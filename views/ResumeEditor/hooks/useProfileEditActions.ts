import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { profileService } from '../../../services/profileService';
import type { ProfileSyncMode, ResumeEditorProfile } from '../../../types/resume';
import { mergeLinkedInLink } from '../../profileUtils';
import { PROFILE_SYNC_MODES } from '../constants';
import { buildProfileFromService } from '../helpers';

type UseProfileEditActionsParams = {
    profile: ResumeEditorProfile;
    setProfile: Dispatch<SetStateAction<ResumeEditorProfile>>;
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
};

export const useProfileEditActions = ({
    profile,
    setProfile,
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
}: UseProfileEditActionsParams) => {
    const beginProfileEdit = useCallback(() => {
        setOriginalProfile({ ...profile });
        setOriginalProfileSyncMode(profileSyncMode);
        setIsEditingProfile(true);
    }, [profile, profileSyncMode, setIsEditingProfile, setOriginalProfile, setOriginalProfileSyncMode]);

    const cancelProfileEdit = useCallback(() => {
        setProfile({ ...originalProfile });
        setProfileSyncMode(originalProfileSyncMode);
        setIsEditingProfile(false);
    }, [originalProfile, originalProfileSyncMode, setIsEditingProfile, setProfile, setProfileSyncMode]);

    const handleSaveProfile = useCallback(async () => {
        if (isSavingProfile) {
            return;
        }
        setIsSavingProfile(true);
        try {
            let nextProfile = { ...profile };
            if (profileSyncMode === PROFILE_SYNC_MODES.global) {
                const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, profile.linkedin);
                const updated = await profileService.updateProfile({
                    full_name: profile.name,
                    email: profile.email,
                    phone: profile.phone,
                    location: profile.location,
                    summary: profile.summary,
                    social_links: nextSocialLinks,
                });
                setProfileSocialLinks({ ...(updated.social_links || nextSocialLinks) });
                const updatedSnapshot = buildProfileFromService(updated);
                if (updatedSnapshot) {
                    nextProfile = updatedSnapshot;
                    setProfile(updatedSnapshot);
                }
            }
            setOriginalProfile({ ...nextProfile });
            setOriginalProfileSyncMode(profileSyncMode);
            setIsEditingProfile(false);
        } catch (error) {
            console.error('[ResumeEditor] 保存个人信息失败:', error);
        } finally {
            setIsSavingProfile(false);
        }
    }, [
        isSavingProfile,
        profile,
        profileSocialLinks,
        profileSyncMode,
        setIsEditingProfile,
        setIsSavingProfile,
        setOriginalProfile,
        setOriginalProfileSyncMode,
        setProfile,
        setProfileSocialLinks,
    ]);

    return {
        beginProfileEdit,
        cancelProfileEdit,
        handleSaveProfile,
        isProfileReadOnly: !isEditingProfile || isSavingProfile,
    };
};
