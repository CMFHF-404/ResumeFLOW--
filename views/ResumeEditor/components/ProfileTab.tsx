import React from 'react';
import { Edit3, Plus, Trash2, Wrench } from 'lucide-react';
import MonthPicker from '../../../components/MonthPicker';
import type {
    EducationEditDraft,
    EducationView,
    ProfileSyncMode,
    ResumeEditorProfile,
} from '../../../types/resume';
import { buildExperienceDate } from '../../../utils/dateUtils';
import { ADD_EDUCATION_LABEL, PROFILE_SYNC_MODES } from '../constants';

type ProfileTabProps = {
    profile: ResumeEditorProfile;
    setProfile: React.Dispatch<React.SetStateAction<ResumeEditorProfile>>;
    profileSyncMode: ProfileSyncMode;
    setProfileSyncMode: React.Dispatch<React.SetStateAction<ProfileSyncMode>>;
    isEditingProfile: boolean;
    isSavingProfile: boolean;
    isProfileReadOnly: boolean;
    onBeginEdit: () => void;
    onCancelEdit: () => void;
    onSave: () => void;
    educations: EducationView[];
    selectedEduIds: Set<string>;
    editingEducationId: string | null;
    educationDraft: EducationEditDraft | null;
    isSavingEducation: boolean;
    deletingEducationIds: Set<string>;
    onBeginCreateEducation: () => void;
    onBeginEditEducation: (id: string) => void;
    onCancelEducationEdit: () => void;
    onUpdateEducationDraft: (field: keyof EducationEditDraft, value: string) => void;
    onUpdateEducationDate: (field: 'startDate' | 'endDate', value: string) => void;
    onSaveEducation: () => void;
    onRequestDeleteEducation: (id: string) => void;
    onToggleEducationSelection: (id: string) => void;
};

const ProfileTab: React.FC<ProfileTabProps> = ({
    profile,
    setProfile,
    profileSyncMode,
    setProfileSyncMode,
    isEditingProfile,
    isSavingProfile,
    isProfileReadOnly,
    onBeginEdit,
    onCancelEdit,
    onSave,
    educations,
    selectedEduIds,
    editingEducationId,
    educationDraft,
    isSavingEducation,
    deletingEducationIds,
    onBeginCreateEducation,
    onBeginEditEducation,
    onCancelEducationEdit,
    onUpdateEducationDraft,
    onUpdateEducationDate,
    onSaveEducation,
    onRequestDeleteEducation,
    onToggleEducationSelection,
}) => (
    <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">基本信息</h3>
                {!isEditingProfile ? (
                    <button
                        onClick={onBeginEdit}
                        className="flex items-center gap-2 text-xs font-medium text-primary bg-primary/10 px-3 py-1.5 rounded-md hover:bg-primary/20 transition-colors"
                        disabled={isSavingProfile}
                    >
                        <Wrench className="w-3 h-3" />
                        编辑
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onCancelEdit}
                            className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            disabled={isSavingProfile}
                        >
                            取消
                        </button>
                        <button
                            onClick={onSave}
                            className="text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-1.5 rounded-md transition-colors disabled:opacity-60"
                            disabled={isSavingProfile}
                        >
                            {isSavingProfile ? '保存中...' : '保存'}
                        </button>
                    </div>
                )}
            </div>
            {isEditingProfile ? (
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-3">
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={profileSyncMode === PROFILE_SYNC_MODES.global}
                            onChange={(event) =>
                                setProfileSyncMode(
                                    event.target.checked
                                        ? PROFILE_SYNC_MODES.global
                                        : PROFILE_SYNC_MODES.local
                                )}
                            className="w-3 h-3 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        同步修改个人经历库
                    </label>
                    <span>关闭后仅对当前简历生效</span>
                </div>
            ) : null}
            <div className="space-y-3">
                <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400">姓名</label>
                    <input
                        className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                        value={profile.name}
                        onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                        disabled={isProfileReadOnly}
                    />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400">电话</label>
                        <input
                            className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                            value={profile.phone}
                            onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                            disabled={isProfileReadOnly}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 dark:text-gray-400">邮箱</label>
                        <input
                            className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                            value={profile.email}
                            onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                            disabled={isProfileReadOnly}
                        />
                    </div>
                </div>
                <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400">地点</label>
                    <input
                        className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                        value={profile.location}
                        onChange={(event) => setProfile({ ...profile, location: event.target.value })}
                        disabled={isProfileReadOnly}
                    />
                </div>
                <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400">链接</label>
                    <input
                        className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                        value={profile.linkedin}
                        onChange={(event) => setProfile({ ...profile, linkedin: event.target.value })}
                        disabled={isProfileReadOnly}
                    />
                </div>
            </div>
        </div>
        <EducationSection
            educations={educations}
            selectedEduIds={selectedEduIds}
            editingEducationId={editingEducationId}
            educationDraft={educationDraft}
            isSavingEducation={isSavingEducation}
            deletingEducationIds={deletingEducationIds}
            onBeginCreateEducation={onBeginCreateEducation}
            onBeginEditEducation={onBeginEditEducation}
            onCancelEducationEdit={onCancelEducationEdit}
            onUpdateEducationDraft={onUpdateEducationDraft}
            onUpdateEducationDate={onUpdateEducationDate}
            onSaveEducation={onSaveEducation}
            onRequestDeleteEducation={onRequestDeleteEducation}
            onToggleEducationSelection={onToggleEducationSelection}
        />
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">职业总结</h3>
            <textarea
                className="w-full text-sm p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary h-28 leading-relaxed resize-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                value={profile.summary}
                onChange={(event) => setProfile({ ...profile, summary: event.target.value })}
                placeholder="用 2-4 句话概括你的优势、方向与量化成果"
                disabled={isProfileReadOnly}
            />
        </div>
    </div>
);

type EducationSectionProps = {
    educations: EducationView[];
    selectedEduIds: Set<string>;
    editingEducationId: string | null;
    educationDraft: EducationEditDraft | null;
    isSavingEducation: boolean;
    deletingEducationIds: Set<string>;
    onBeginCreateEducation: () => void;
    onBeginEditEducation: (id: string) => void;
    onCancelEducationEdit: () => void;
    onUpdateEducationDraft: (field: keyof EducationEditDraft, value: string) => void;
    onUpdateEducationDate: (field: 'startDate' | 'endDate', value: string) => void;
    onSaveEducation: () => void;
    onRequestDeleteEducation: (id: string) => void;
    onToggleEducationSelection: (id: string) => void;
};

const EducationSection: React.FC<EducationSectionProps> = ({
    educations,
    selectedEduIds,
    editingEducationId,
    educationDraft,
    isSavingEducation,
    deletingEducationIds,
    onBeginCreateEducation,
    onBeginEditEducation,
    onCancelEducationEdit,
    onUpdateEducationDraft,
    onUpdateEducationDate,
    onSaveEducation,
    onRequestDeleteEducation,
    onToggleEducationSelection,
}) => (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <EducationHeader onCreate={onBeginCreateEducation} />
        <div className="space-y-2">
            {educations.length === 0 ? (
                <p className="text-xs text-gray-400">暂无教育经历</p>
            ) : (
                educations.map((edu) => (
                    <EducationCard
                        key={edu.id}
                        education={edu}
                        isSelected={selectedEduIds.has(edu.id)}
                        isEditing={editingEducationId === edu.id && !!educationDraft}
                        draft={educationDraft}
                        isSaving={isSavingEducation}
                        deletingIds={deletingEducationIds}
                        onToggleSelection={onToggleEducationSelection}
                        onEdit={onBeginEditEducation}
                        onCancelEdit={onCancelEducationEdit}
                        onSave={onSaveEducation}
                        onDelete={onRequestDeleteEducation}
                        onUpdateDraft={onUpdateEducationDraft}
                        onUpdateDate={onUpdateEducationDate}
                    />
                ))
            )}
        </div>
    </div>
);

type EducationHeaderProps = {
    onCreate: () => void;
};

const EducationHeader: React.FC<EducationHeaderProps> = ({ onCreate }) => (
    <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">教育背景</h3>
        <button
            onClick={onCreate}
            title={ADD_EDUCATION_LABEL}
            aria-label={ADD_EDUCATION_LABEL}
            className="flex items-center justify-center text-gray-500 hover:text-primary p-1 rounded-md hover:bg-primary/5"
        >
            <Plus className="w-3.5 h-3.5" />
        </button>
    </div>
);

type EducationCardProps = {
    education: EducationView;
    isSelected: boolean;
    isEditing: boolean;
    draft: EducationEditDraft | null;
    isSaving: boolean;
    deletingIds: Set<string>;
    onToggleSelection: (id: string) => void;
    onEdit: (id: string) => void;
    onCancelEdit: () => void;
    onSave: () => void;
    onDelete: (id: string) => void;
    onUpdateDraft: (field: keyof EducationEditDraft, value: string) => void;
    onUpdateDate: (field: 'startDate' | 'endDate', value: string) => void;
};

const EducationCard: React.FC<EducationCardProps> = ({
    education,
    isSelected,
    isEditing,
    draft,
    isSaving,
    deletingIds,
    onToggleSelection,
    onEdit,
    onCancelEdit,
    onSave,
    onDelete,
    onUpdateDraft,
    onUpdateDate,
}) => {
    const dateText = buildExperienceDate(education.startDate, education.endDate, education.isCurrent);
    if (isEditing && draft) {
        return (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <EducationForm draft={draft} onUpdateDraft={onUpdateDraft} onUpdateDate={onUpdateDate} />
                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={onCancelEdit}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                        disabled={isSaving}
                    >
                        取消
                    </button>
                    <button
                        onClick={onSave}
                        className="text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-3 py-1 rounded disabled:opacity-60"
                        disabled={isSaving}
                    >
                        {isSaving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`p-3 rounded border transition-all ${isSelected
                ? 'bg-gray-50 dark:bg-gray-900 border-primary ring-1 ring-primary'
                : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 opacity-60'
                }`}
            onClick={() => onToggleSelection(education.id)}
        >
            <div className="flex gap-3">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelection(education.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                />
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">{education.school}</h4>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button
                                className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDelete(education.id);
                                }}
                                disabled={deletingIds.has(education.id)}
                                title="删除教育经历"
                                aria-label="删除教育经历"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                                className="p-1 text-gray-300 rounded hover:text-primary hover:bg-primary/5"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onEdit(education.id);
                                }}
                                title="编辑教育经历"
                                aria-label="编辑教育经历"
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{education.major}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">{education.degree}</p>
                    {education.gpa && <p className="text-xs text-gray-500 mt-1">GPA: {education.gpa}</p>}
                    <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] text-gray-400 font-mono">{dateText}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

type EducationFormProps = {
    draft: EducationEditDraft;
    onUpdateDraft: (field: keyof EducationEditDraft, value: string) => void;
    onUpdateDate: (field: 'startDate' | 'endDate', value: string) => void;
};

const EducationForm: React.FC<EducationFormProps> = ({ draft, onUpdateDraft, onUpdateDate }) => (
    <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
            <div>
                <label className="text-[10px] text-gray-400">学校</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                    value={draft.school}
                    onChange={(event) => onUpdateDraft('school', event.target.value)}
                />
            </div>
            <div>
                <label className="text-[10px] text-gray-400">专业</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                    value={draft.major}
                    onChange={(event) => onUpdateDraft('major', event.target.value)}
                />
            </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
            <div>
                <label className="text-[10px] text-gray-400">学位</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                    value={draft.degree}
                    onChange={(event) => onUpdateDraft('degree', event.target.value)}
                />
            </div>
            <div>
                <label className="text-[10px] text-gray-400">GPA</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                    value={draft.gpa}
                    onChange={(event) => onUpdateDraft('gpa', event.target.value)}
                />
            </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
            <div>
                <label className="text-[10px] text-gray-400">开始时间</label>
                <div className="h-9 mt-0.5">
                    <MonthPicker
                        value={draft.startDate}
                        onChange={(val) => onUpdateDate('startDate', val)}
                        placeholder="开始时间"
                        className="h-full"
                    />
                </div>
            </div>
            <div>
                <label className="text-[10px] text-gray-400">结束时间</label>
                <div className="h-9 mt-0.5">
                    <MonthPicker
                        value={draft.endDate}
                        onChange={(val) => onUpdateDate('endDate', val)}
                        placeholder="结束时间"
                        className="h-full"
                        allowPresent
                        minDate={draft.startDate}
                    />
                </div>
            </div>
        </div>
        <div>
            <label className="text-[10px] text-gray-400">课程</label>
            <input
                className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                value={draft.courses}
                onChange={(event) => onUpdateDraft('courses', event.target.value)}
            />
        </div>
    </div>
);

export default ProfileTab;
