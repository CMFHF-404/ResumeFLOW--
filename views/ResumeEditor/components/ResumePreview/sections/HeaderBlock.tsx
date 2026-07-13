import React from 'react';
import { Link2, Mail, MapPin, Phone } from 'lucide-react';
import { HEADER_EXTRA_TOP_SPACING_CLASS } from '../../../constants';
import type { ResumeTemplateDefinition } from '../../../../../constants/resumeTemplates';
import type { ResumeEditorProfile } from '../../../../../types/resume';
import DeepHireHeaderBlock from './DeepHireHeaderBlock';

type HeaderBlockProps = {
    activeTemplate: ResumeTemplateDefinition;
    profile: ResumeEditorProfile;
    contactItems: string[];
    resumeDisplayTitle?: string;
    sectionSpacingClass: string;
    headerStyle: React.CSSProperties;
    isOpenSourceClassicTemplate: boolean;
    isTimelineBlueTemplate: boolean;
    isPhotoCardTemplate: boolean;
    isPhotoSidebarTemplate: boolean;
    getSectionOverflowHighlightStyle: (sectionId: string) => React.CSSProperties | undefined;
    renderOverflowMarker: (sectionId: string) => React.ReactNode;
    renderAvatarFrame: (className: string, imageObjectFit?: 'contain' | 'cover') => React.ReactNode;
};

const HeaderBlock: React.FC<HeaderBlockProps> = ({
    activeTemplate,
    profile,
    contactItems,
    resumeDisplayTitle,
    sectionSpacingClass,
    headerStyle,
    isOpenSourceClassicTemplate,
    isTimelineBlueTemplate,
    isPhotoCardTemplate,
    isPhotoSidebarTemplate,
    getSectionOverflowHighlightStyle,
    renderOverflowMarker,
    renderAvatarFrame,
}) => {
    const commonHeaderStyle = {
        ...headerStyle,
        borderBottomColor: 'var(--rf-accent-border)',
    } as React.CSSProperties;

    if (activeTemplate.collection === 'deephire') {
        return (
            <DeepHireHeaderBlock
                activeTemplate={activeTemplate}
                profile={profile}
                contactItems={contactItems}
                resumeDisplayTitle={resumeDisplayTitle}
                sectionSpacingClass={sectionSpacingClass}
                headerStyle={commonHeaderStyle}
                getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
                renderOverflowMarker={renderOverflowMarker}
                renderAvatarFrame={renderAvatarFrame}
            />
        );
    }

    if (isOpenSourceClassicTemplate) {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`border-b pb-4 text-center ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS} scroll-mt-8`}
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                    fontFamily: 'Georgia, "Times New Roman", serif',
                }}
            >
                {renderOverflowMarker('basic-info')}
                <h1 className="mt-1 text-[31px] font-bold tracking-[0.08em] text-gray-950">
                    {profile.name}
                </h1>
                {contactItems.length ? (
                    <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] font-medium text-gray-600">
                        {contactItems.map((item, index) => (
                            <span key={item} className="inline-flex items-center whitespace-nowrap">
                                <span>{item}</span>
                                {index < contactItems.length - 1 ? (
                                    <span className="ml-3 h-1 w-1 rounded-full" style={{ backgroundColor: 'var(--rf-accent-border)' }} />
                                ) : null}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    if (isTimelineBlueTemplate) {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`scroll-mt-8 ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS}`}
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                    borderBottomWidth: 0,
                }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="flex items-start justify-between gap-5 border-b pb-4" style={{ borderBottomColor: 'var(--rf-accent-border)' }}>
                    <div className="min-w-0 flex-1">
                        <div className="mb-2 h-1 w-14 rounded-full" style={{ backgroundColor: 'var(--rf-accent-color)' }} />
                        <h1 className="text-[34px] font-bold tracking-[0.1em] text-gray-950">
                            {profile.name}
                        </h1>
                    </div>
                    {contactItems.length ? (
                        <div className="max-w-[220px] space-y-1 text-right text-[11px] font-medium text-gray-600">
                            {contactItems.map((item) => (
                                <div key={item}>{item}</div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    if (isPhotoCardTemplate) {
        const contactEntries = [
            { label: '邮箱', value: profile.email?.trim() ?? '', Icon: Mail },
            { label: '电话', value: profile.phone?.trim() ?? '', Icon: Phone },
            { label: '地点', value: profile.location?.trim() ?? '', Icon: MapPin },
            { label: '链接', value: profile.linkedin?.trim() ?? '', Icon: Link2 },
        ].filter((item) => item.value);

        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`pb-4 mb-3 ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS} scroll-mt-8`}
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                    borderBottomWidth: 0,
                }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="flex items-start gap-5 px-1 pb-2 pt-4">
                    {renderAvatarFrame('flex h-28 w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-white bg-white shadow-sm', 'cover')}
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[34px] font-bold tracking-[0.06em] leading-tight text-gray-950">
                            {profile.name}
                        </h1>
                        {resumeDisplayTitle ? (
                            <p className="mt-1 text-[12px] font-semibold leading-snug text-gray-700">
                                {resumeDisplayTitle}
                            </p>
                        ) : null}
                        {contactEntries.length ? (
                            <div className="mt-3 grid max-w-[360px] grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-semibold leading-snug text-gray-700">
                                {contactEntries.map(({ label, value, Icon }) => (
                                    <div key={label} className="inline-flex min-w-0 items-center gap-1.5">
                                        <Icon className="h-3 w-3 shrink-0" style={{ color: 'var(--rf-accent-color)' }} />
                                        <span className="truncate">{value}</span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        );
    }

    if (activeTemplate.layoutKind === 'split') {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`scroll-mt-8 ${HEADER_EXTRA_TOP_SPACING_CLASS}`}
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="mb-5 flex items-start justify-between gap-5">
                    <div className="min-w-0 flex-1">
                        <div className="mb-2 h-1.5 w-14 rounded-full" style={{ backgroundColor: isPhotoSidebarTemplate ? '#ffffff' : 'var(--rf-accent-color)' }} />
                        <h1 className={`text-[28px] font-bold tracking-[0.12em] ${isPhotoSidebarTemplate ? 'text-white' : 'text-gray-900'}`}>
                            {profile.name}
                        </h1>
                        {isPhotoSidebarTemplate && resumeDisplayTitle ? (
                            <p className="mt-1 text-[11px] font-semibold leading-snug tracking-normal text-white/75">
                                {resumeDisplayTitle}
                            </p>
                        ) : null}
                    </div>
                    {renderAvatarFrame(`flex h-32 w-24 shrink-0 overflow-hidden ${isPhotoSidebarTemplate ? 'rounded-full border border-white/45 bg-white/10 p-1 shadow-sm' : 'rounded-[1.4rem] border border-white/75 bg-white p-0.5 shadow-sm'}`)}
                </div>
                {contactItems.length ? (
                    <div className={`space-y-1.5 text-[11px] font-medium ${isPhotoSidebarTemplate ? 'text-white/80' : 'text-gray-700'}`}>
                        {contactItems.map((item) => (
                            <div key={item}>{item}</div>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    if (activeTemplate.layoutKind === 'avatar') {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`pb-5 ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS} scroll-mt-8`}
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                    borderBottomWidth: 0,
                }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="mb-2 flex items-start justify-between gap-8">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[36px] font-bold uppercase tracking-[0.12em] text-gray-900 leading-none">
                            {profile.name}
                        </h1>
                        <div className="mt-3.5 h-[1.5px] w-full max-w-[280px]" style={{ backgroundColor: 'var(--rf-accent-border)' }} />
                        {contactItems.length ? (
                            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-gray-600">
                                {contactItems.map((item) => (
                                    <span key={item}>{item}</span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    {renderAvatarFrame('flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-white')}
                </div>
            </div>
        );
    }

    if (activeTemplate.layoutKind === 'minimal') {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`pb-5 text-center ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS} scroll-mt-8`}
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                }}
            >
                {renderOverflowMarker('basic-info')}
                <h1 className="text-[32px] font-semibold tracking-[0.1em] text-gray-900 mt-2">
                    {profile.name}
                </h1>
                {contactItems.length ? (
                    <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-gray-500">
                        {contactItems.map((item) => (
                            <span key={item}>{item}</span>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    if (activeTemplate.layoutKind === 'accent') {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className="scroll-mt-8 mb-8 flex flex-col"
                style={{
                    ...commonHeaderStyle,
                    ...getSectionOverflowHighlightStyle('basic-info'),
                    paddingBottom: 0,
                    borderBottomWidth: 0,
                }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="flex items-center mb-4 mt-2">
                    <h1
                        className="text-[34px] font-bold tracking-[0.12em] text-gray-900 pl-4"
                        style={{
                            borderLeft: '6px solid var(--rf-accent-color)',
                            borderRadius: '2px',
                        }}
                    >
                        {profile.name}
                    </h1>
                </div>
                {contactItems.length ? (
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11.5px] font-medium text-gray-600 pl-5">
                        {contactItems.map((item, index) => (
                            <span key={item} className="inline-flex items-center whitespace-nowrap">
                                <span>{item}</span>
                                {index < contactItems.length - 1 && (
                                    <span className="text-gray-300 ml-1.5 mr-0.5 opacity-60">|</span>
                                )}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div
            id="basic-info"
            data-rf-section-id="basic-info"
            className={`border-b pb-4 ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS} scroll-mt-8`}
            style={{
                ...commonHeaderStyle,
                ...getSectionOverflowHighlightStyle('basic-info'),
            }}
        >
            {renderOverflowMarker('basic-info')}
            <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                    <div className="mb-3 h-1.5 w-20 rounded-full" style={{ backgroundColor: 'var(--rf-accent-color)' }} />
                    <h1 className="text-[32px] font-bold uppercase tracking-[0.16em] text-gray-900 leading-tight">
                        {profile.name}
                    </h1>
                    {contactItems.length ? (
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-gray-600">
                            {contactItems.map((item) => (
                                <span key={item}>{item}</span>
                            ))}
                        </div>
                    ) : null}
                </div>
                {activeTemplate.id === 'modern-slate-avatar' && renderAvatarFrame('flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white border border-gray-200 shadow-sm')}
            </div>
        </div>
    );
};

export default HeaderBlock;
