import React from 'react';
import { Edit3, GripVertical } from 'lucide-react';
import type {
    CertificationView,
    EducationView,
    ResumeEditorProfile,
    ResumeExperienceView,
    StarFields,
} from '../../../types/resume';
import { buildExperienceDate } from '../../../utils/dateUtils';
import { sanitizeRichTextHtml, splitRichTextLines } from '../../../utils/richText';

type SectionDragHandler = (event: React.DragEvent, sectionId: string) => void;
type ItemDragHandler = (event: React.DragEvent, itemId: string) => void;

const STAR_CONTEXT_SEPARATOR = ' ';
const normalizeStarText = (value?: string) => value?.trim() ?? '';

const buildContextText = (star?: StarFields) => {
    const parts = [normalizeStarText(star?.s), normalizeStarText(star?.t)].filter(Boolean);
    return parts.join(STAR_CONTEXT_SEPARATOR);
};

const splitActionLines = (value?: string) => splitRichTextLines(value ?? '');

const renderRichText = (value: string) => ({
    __html: sanitizeRichTextHtml(value),
});

const renderStarBlocks = (star: StarFields, itemId: string) => {
    const contextText = buildContextText(star);
    const actionLines = splitActionLines(star.a);
    const resultText = normalizeStarText(star.r);

    if (!contextText && actionLines.length === 0 && !resultText) {
        return null;
    }

    return (
        <>
            {contextText ? (
                <div
                    className="text-gray-600 text-xs mb-1"
                    dangerouslySetInnerHTML={renderRichText(contextText)}
                />
            ) : null}
            {actionLines.length > 0 ? (
                <ul className="list-disc list-outside ml-4 text-xs text-gray-700 space-y-1.5 leading-relaxed">
                    {actionLines.map((line, index) => (
                        <li key={`${itemId}-action-${index}`} dangerouslySetInnerHTML={{ __html: line }} />
                    ))}
                </ul>
            ) : null}
            {resultText ? (
                <div
                    className="text-xs text-gray-700 mt-1"
                    dangerouslySetInnerHTML={renderRichText(resultText)}
                />
            ) : null}
        </>
    );
};

export type ResumePreviewProps = {
    previewRef: React.RefObject<HTMLDivElement>;
    resumeScale: number;
    profile: ResumeEditorProfile;
    spacingClass: string;
    listSpacingClass: string;
    sectionOrder: string[];
    selectedWorkItems: ResumeExperienceView[];
    selectedProjectItems: ResumeExperienceView[];
    educations: EducationView[];
    selectedEduIds: Set<string>;
    sortedCertifications: CertificationView[];
    selectedCertIds: Set<string>;
    selectedSkillGroups: Array<{ name: string; skills: string[] }>;
    onSectionDragStart: SectionDragHandler;
    onSectionDragOver: SectionDragHandler;
    onSectionDrop: () => void;
    onItemDragStart: ItemDragHandler;
    onItemDragOver: ItemDragHandler;
    onItemDrop: (event: React.DragEvent) => void;
    onNavigateTab: (tab: 'profile' | 'experience') => void;
    onEditExperience: (id: string) => void;
};

const ResumePreview: React.FC<ResumePreviewProps> = ({
    previewRef,
    resumeScale,
    profile,
    spacingClass,
    listSpacingClass,
    sectionOrder,
    selectedWorkItems,
    selectedProjectItems,
    educations,
    selectedEduIds,
    sortedCertifications,
    selectedCertIds,
    selectedSkillGroups,
    onSectionDragStart,
    onSectionDragOver,
    onSectionDrop,
    onItemDragStart,
    onItemDragOver,
    onItemDrop,
    onNavigateTab,
    onEditExperience,
}) => {
    const renderExperienceSection = (
        sectionId: 'work' | 'project',
        title: string,
        items: ResumeExperienceView[]
    ) => {
        if (!items.length) {
            return null;
        }
        return (
            <div
                key={sectionId}
                id={sectionId}
                className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                draggable
                onDragStart={(event) => onSectionDragStart(event, sectionId)}
                onDragOver={(event) => onSectionDragOver(event, sectionId)}
                onDrop={onSectionDrop}
            >
                <div className="absolute -left-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="w-4 h-4 text-primary cursor-move" />
                </div>

                <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">
                    {title}
                </h2>
                <div className={listSpacingClass}>
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="relative group/item cursor-move"
                            draggable
                            onDragStart={(event) => {
                                event.stopPropagation();
                                onItemDragStart(event, item.id);
                            }}
                            onDragOver={(event) => {
                                event.stopPropagation();
                                onItemDragOver(event, item.id);
                            }}
                            onDrop={(event) => {
                                event.stopPropagation();
                                onItemDrop(event);
                            }}
                        >
                            <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                <GripVertical className="w-3.5 h-3.5 text-gray-400 cursor-move" />
                                <Edit3
                                    className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-primary"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onEditExperience(item.id);
                                    }}
                                />
                            </div>

                            <div className="group-hover/item:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                <div className="flex justify-between items-baseline mb-1">
                                    <h3 className="text-sm font-bold text-gray-900">{item.company}</h3>
                                    <span className="text-xs font-medium text-gray-600">{item.date}</span>
                                </div>
                                <p className="text-xs font-semibold text-gray-800 mb-1.5">{item.title}</p>

                                {renderStarBlocks(item.star, item.id)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <main className="flex-1 bg-gray-100 dark:bg-gray-900/50 overflow-y-auto relative flex justify-center p-8 scroll-smooth">
            <div
                ref={previewRef}
                className="a4-preview text-gray-900 p-[20mm] relative"
                style={{
                    transform: resumeScale === 1 ? undefined : `scale(${resumeScale})`,
                    transformOrigin: 'top center',
                }}
            >
                <div
                    id="basic-info"
                    className={`border-b-2 border-gray-900 pb-4 ${spacingClass} text-center scroll-mt-8`}
                >
                    <h1 className="text-3xl font-bold uppercase tracking-widest mb-2 text-gray-900">
                        {profile.name}
                    </h1>
                    <div className="text-[11px] text-gray-600 flex justify-center flex-wrap gap-x-4 gap-y-1 font-medium">
                        <span>{profile.email}</span>
                        <span>{profile.phone}</span>
                        <span>{profile.location}</span>
                        <span>{profile.linkedin}</span>
                    </div>
                </div>

                {sectionOrder.map((sectionId) => {
                    if (sectionId === 'summary' && profile.summary) {
                        return (
                            <div
                                key="summary"
                                id="summary"
                                className={`${spacingClass} relative group cursor-move`}
                                draggable
                                onDragStart={(event) => onSectionDragStart(event, 'summary')}
                                onDragOver={(event) => onSectionDragOver(event, 'summary')}
                                onDrop={onSectionDrop}
                            >
                                <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                    <Edit3
                                        className="w-4 h-4 text-primary cursor-pointer"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onNavigateTab('profile');
                                        }}
                                    />
                                </div>
                                <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-2">
                                        职业总结
                                    </h2>
                                    <p className="text-xs leading-relaxed text-gray-800">{profile.summary}</p>
                                </div>
                            </div>
                        );
                    }

                    if (sectionId === 'work') {
                        return renderExperienceSection('work', '工作经历', selectedWorkItems);
                    }

                    if (sectionId === 'project') {
                        return renderExperienceSection('project', '项目经历', selectedProjectItems);
                    }

                    if (sectionId === 'education' && selectedEduIds.size > 0) {
                        return (
                            <div
                                key="education"
                                id="education"
                                className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                                draggable
                                onDragStart={(event) => onSectionDragStart(event, 'education')}
                                onDragOver={(event) => onSectionDragOver(event, 'education')}
                                onDrop={onSectionDrop}
                            >
                                <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                    <Edit3
                                        className="w-4 h-4 text-primary cursor-pointer"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onNavigateTab('profile');
                                        }}
                                    />
                                </div>

                                <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">
                                        教育背景
                                    </h2>
                                    <div className={listSpacingClass}>
                                        {educations
                                            .filter((edu) => selectedEduIds.has(edu.id))
                                            .map((edu) => {
                                                const dateText = buildExperienceDate(
                                                    edu.startDate,
                                                    edu.endDate,
                                                    edu.isCurrent
                                                );
                                                return (
                                                    <div key={edu.id} className="mb-2">
                                                        <div className="flex justify-between items-baseline mb-0.5">
                                                            <h3 className="text-sm font-bold text-gray-900">
                                                                {edu.school}
                                                            </h3>
                                                            <span className="text-xs font-medium text-gray-600">
                                                                {dateText}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-800">
                                                            {edu.major}, {edu.degree}
                                                        </p>
                                                        {edu.gpa ? (
                                                            <p className="text-xs text-gray-600">GPA: {edu.gpa}</p>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (sectionId === 'certifications' && selectedCertIds.size > 0) {
                        return (
                            <div
                                key="certifications"
                                id="certifications"
                                className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                                draggable
                                onDragStart={(event) => onSectionDragStart(event, 'certifications')}
                                onDragOver={(event) => onSectionDragOver(event, 'certifications')}
                                onDrop={onSectionDrop}
                            >
                                <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                    <Edit3
                                        className="w-4 h-4 text-primary cursor-pointer"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onNavigateTab('experience');
                                        }}
                                    />
                                </div>

                                <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">
                                        证书资质
                                    </h2>
                                    <div className="space-y-1.5">
                                        {sortedCertifications
                                            .filter((cert) => selectedCertIds.has(cert.id))
                                            .map((cert) => (
                                                <div key={cert.id} className="flex justify-between items-baseline">
                                                    <div>
                                                        <span className="text-xs font-bold text-gray-900">
                                                            {cert.name}
                                                        </span>
                                                        {cert.issuer ? (
                                                            <span className="text-xs text-gray-600 ml-2">
                                                                ({cert.issuer})
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <span className="text-xs text-gray-600">{cert.date}</span>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (sectionId === 'skills' && selectedSkillGroups.length > 0) {
                        return (
                            <div
                                key="skills"
                                id="skills"
                                className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                                draggable
                                onDragStart={(event) => onSectionDragStart(event, 'skills')}
                                onDragOver={(event) => onSectionDragOver(event, 'skills')}
                                onDrop={onSectionDrop}
                            >
                                <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                    <Edit3
                                        className="w-4 h-4 text-primary cursor-pointer"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onNavigateTab('experience');
                                        }}
                                    />
                                </div>

                                <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-2">
                                        专业技能
                                    </h2>
                                    <div className="text-xs text-gray-800 grid grid-cols-[100px_1fr] gap-y-1.5">
                                        {selectedSkillGroups.map((group) => (
                                            <React.Fragment key={group.name}>
                                                <span className="font-bold text-gray-900">{group.name}:</span>
                                                <span>{group.skills.join(', ')}</span>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    return null;
                })}
            </div>
        </main>
    );
};

export default ResumePreview;
