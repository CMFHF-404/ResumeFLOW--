import React from 'react';
import { Circle, Diamond, Link2, Mail, MapPin, Phone, Quote, Square } from 'lucide-react';
import type { ResumeTemplateDefinition } from '../../../../../constants/resumeTemplates';
import type { ResumeEditorProfile } from '../../../../../types/resume';
import { usesLightDeepHireSidebar } from '../deepHireTemplateStyles';

type DeepHireHeaderBlockProps = {
    activeTemplate: ResumeTemplateDefinition;
    profile: ResumeEditorProfile;
    contactItems: string[];
    resumeDisplayTitle?: string;
    sectionSpacingClass: string;
    headerStyle: React.CSSProperties;
    getSectionOverflowHighlightStyle: (sectionId: string) => React.CSSProperties | undefined;
    renderOverflowMarker: (sectionId: string) => React.ReactNode;
    renderAvatarFrame: (className: string, imageObjectFit?: 'contain' | 'cover') => React.ReactNode;
};

const DeepHireHeaderBlock: React.FC<DeepHireHeaderBlockProps> = ({
    activeTemplate,
    profile,
    resumeDisplayTitle,
    sectionSpacingClass,
    headerStyle,
    getSectionOverflowHighlightStyle,
    renderOverflowMarker,
    renderAvatarFrame,
}) => {
    const tokens = activeTemplate.visualTokens;
    const commonStyle = {
        ...headerStyle,
        ...getSectionOverflowHighlightStyle('basic-info'),
        fontFamily: tokens?.fontFamily,
    } as React.CSSProperties;
    const contactEntries = [
        { label: '邮箱', value: profile.email?.trim() ?? '', Icon: Mail },
        { label: '电话', value: profile.phone?.trim() ?? '', Icon: Phone },
        { label: '地点', value: profile.location?.trim() ?? '', Icon: MapPin },
        { label: '链接', value: profile.linkedin?.trim() ?? '', Icon: Link2 },
    ].filter((item) => item.value);
    const renderContactList = (className: string) => contactEntries.length ? (
        <div className={`rf-deephire-contact-list ${className}`}>
            {contactEntries.map(({ label, value, Icon }) => (
                <span key={label} className="rf-deephire-contact-item inline-flex min-w-0 items-center gap-1.5">
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="break-all">{value}</span>
                </span>
            ))}
        </div>
    ) : null;

    if (activeTemplate.renderVariant === 'watercolor-profile') {
        const primaryContactEntries = contactEntries.filter(({ label }) => label === '电话' || label === '邮箱');
        const secondaryContactEntries = contactEntries.filter(({ label }) => label === '地点' || label === '链接');
        const renderWatercolorContactRow = (
            entries: typeof contactEntries,
            className: string
        ) => entries.length ? (
            <div className={className}>
                {entries.map(({ label, value, Icon }) => (
                    <span key={label} className="rf-watercolor-contact-item inline-flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="break-all">{value}</span>
                    </span>
                ))}
            </div>
        ) : null;

        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`rf-deephire-header rf-deephire-header--watercolor scroll-mt-8 ${sectionSpacingClass}`}
                style={{ ...commonStyle, borderBottomWidth: 0, marginBottom: headerStyle.marginBottom }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="rf-deephire-header-inner flex items-start justify-between gap-8">
                    <div className="rf-deephire-profile-copy min-w-0 flex-1 pt-1">
                        <h1 className="rf-watercolor-name text-[34px] font-bold leading-none tracking-[0.06em]">
                            {profile.name}
                        </h1>
                        {resumeDisplayTitle ? (
                            <p className="rf-watercolor-title mt-3 text-[11px] font-medium leading-snug">
                                {resumeDisplayTitle}
                            </p>
                        ) : null}
                        {renderWatercolorContactRow(
                            secondaryContactEntries,
                            'rf-watercolor-contact-row mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] font-medium'
                        )}
                        {renderWatercolorContactRow(
                            primaryContactEntries,
                            `rf-watercolor-contact-row ${secondaryContactEntries.length || resumeDisplayTitle ? 'mt-2.5' : 'mt-4'} flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] font-medium`
                        )}
                    </div>
                    {renderAvatarFrame(
                        'rf-deephire-avatar rf-deephire-avatar--watercolor flex h-[78px] w-[78px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white',
                        'cover'
                    )}
                </div>
                <img
                    src="/resume-templates/deephire/deephire-watercolor-divider.png"
                    alt=""
                    aria-hidden="true"
                    className="rf-watercolor-divider mt-6 h-[6px] w-full object-fill"
                />
            </div>
        );
    }

    if (activeTemplate.renderVariant === 'split-profile' || activeTemplate.renderVariant === 'editorial-split') {
        const useLightText = usesLightDeepHireSidebar(activeTemplate);
        const isChampion = activeTemplate.id === 'deephire-champion-blue';
        const isYouthEnergy = activeTemplate.id === 'deephire-youth-energy';

        if (isChampion || isYouthEnergy) {
            return (
                <div
                    id="basic-info"
                    data-rf-section-id="basic-info"
                    className={`rf-deephire-header rf-deephire-header--split rf-deephire-header--${isChampion ? 'champion' : 'youth'} scroll-mt-8 ${sectionSpacingClass}`}
                    style={{ ...commonStyle, marginBottom: headerStyle.marginBottom }}
                >
                    {renderOverflowMarker('basic-info')}
                    <div className="rf-deephire-header-inner flex items-start justify-between gap-6">
                        <div className="rf-deephire-profile-copy min-w-0 flex-1">
                            {isChampion ? (
                                <p className="rf-deephire-kicker text-[52px] font-black leading-none tracking-tight text-gray-950">HELLO</p>
                            ) : (
                                <Quote className="rf-deephire-quote h-8 w-8 text-amber-400" fill="currentColor" aria-hidden="true" />
                            )}
                            <h1 className="rf-deephire-name mt-2 text-[30px] font-bold leading-tight tracking-[0.06em] text-gray-950">
                                {profile.name}
                            </h1>
                            {!isChampion && resumeDisplayTitle ? (
                                <p className="rf-deephire-title mt-1.5 text-[11px] font-semibold leading-snug text-gray-600">
                                    {resumeDisplayTitle}
                                </p>
                            ) : null}
                            {!isChampion
                                ? renderContactList('mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-medium text-gray-600')
                                : null}
                        </div>
                        <div className="rf-deephire-avatar-wrap relative shrink-0">
                            {isYouthEnergy ? (
                                <img
                                    src="/resume-templates/deephire/deephire-youth-accent.png"
                                    alt=""
                                    aria-hidden="true"
                                    className="rf-youth-accent pointer-events-none absolute"
                                />
                            ) : null}
                            {renderAvatarFrame(
                                `rf-deephire-avatar relative z-[1] flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-sm ${isChampion ? 'h-[144px] w-[144px] rounded-lg' : 'h-[150px] w-[150px] rounded-full'}`,
                                'cover'
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`rf-deephire-header rf-deephire-header--split scroll-mt-8 ${sectionSpacingClass}`}
                style={{ ...commonStyle, marginBottom: headerStyle.marginBottom }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="rf-deephire-header-inner flex flex-col items-start">
                    {renderAvatarFrame(
                        activeTemplate.renderVariant === 'editorial-split'
                            ? 'rf-deephire-avatar mb-4 flex h-24 w-20 items-center justify-center overflow-hidden rounded-full border-[3px] border-white bg-white shadow-sm'
                            : 'rf-deephire-avatar mb-4 flex h-24 w-20 items-center justify-center overflow-hidden rounded-lg border border-white/80 bg-white shadow-sm',
                        'cover'
                    )}
                    <h1 className={`rf-deephire-name text-[28px] font-bold leading-tight tracking-[0.08em] ${useLightText ? 'text-white' : 'text-gray-950'}`}>
                        {profile.name}
                    </h1>
                    {resumeDisplayTitle ? (
                        <p className={`rf-deephire-title mt-1.5 text-[11px] font-semibold leading-snug ${useLightText ? 'text-white/75' : 'text-gray-600'}`}>
                            {resumeDisplayTitle}
                        </p>
                    ) : null}
                    <div className="mt-3 h-[2px] w-12 rounded-full" style={{ backgroundColor: useLightText ? 'rgba(255,255,255,0.72)' : 'var(--rf-accent-color)' }} />
                </div>
                {contactEntries.length ? (
                    <div className={`rf-deephire-contact-list mt-4 space-y-2 text-[10.5px] font-medium leading-snug ${useLightText ? 'text-white/80' : 'text-gray-600'}`}>
                        {contactEntries.map(({ label, value, Icon }) => (
                            <div key={label} className="rf-deephire-contact-item flex min-w-0 items-start gap-2">
                                <Icon className="mt-[1px] h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="break-all">{value}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    if (activeTemplate.renderVariant === 'curved-profile') {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`rf-deephire-header rf-deephire-header--curved scroll-mt-8 text-center ${sectionSpacingClass}`}
                style={{ ...commonStyle, borderBottomWidth: 0 }}
            >
                {renderOverflowMarker('basic-info')}
                <div
                    className="rf-deephire-curved-band -mx-[20mm] h-[92px] rounded-b-[50%]"
                    style={{
                        backgroundColor: tokens?.headerBackground ?? 'var(--rf-accent-color)',
                        marginTop: 'calc(var(--rf-template-top-padding) * -1)',
                    }}
                    aria-hidden="true"
                />
                <div className="rf-deephire-header-inner relative -mt-12 flex flex-col items-center">
                    {renderAvatarFrame('rf-deephire-avatar flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-white shadow-md', 'cover')}
                    <h1 className="rf-deephire-name mt-3 text-[31px] font-bold leading-none tracking-[0.1em] text-gray-950">
                        {profile.name}
                    </h1>
                    {renderContactList('mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10.5px] font-medium text-gray-600')}
                </div>
            </div>
        );
    }

    if (activeTemplate.renderVariant === 'top-banner-avatar') {
        return (
            <div
                id="basic-info"
                data-rf-section-id="basic-info"
                className={`rf-deephire-header rf-deephire-header--banner -mx-[20mm] scroll-mt-8 px-[20mm] pb-6 ${sectionSpacingClass}`}
                style={{
                    ...commonStyle,
                    backgroundColor: tokens?.headerBackground ?? 'var(--rf-accent-color)',
                    color: tokens?.headerForeground ?? '#ffffff',
                    borderBottomWidth: 0,
                    marginTop: 'calc(var(--rf-template-top-padding) * -1)',
                    paddingTop: 'calc(var(--rf-template-top-padding) + 18px)',
                }}
            >
                {renderOverflowMarker('basic-info')}
                <div className="rf-deephire-header-inner flex items-start justify-between gap-6">
                    <div className="rf-deephire-profile-copy min-w-0 flex-1">
                        <h1 className="rf-deephire-name text-[34px] font-bold leading-none tracking-[0.1em] text-inherit">
                            {profile.name}
                        </h1>
                        {resumeDisplayTitle ? (
                            <p className="rf-deephire-title mt-2 text-[11px] font-semibold leading-snug text-inherit opacity-80">
                                {resumeDisplayTitle}
                            </p>
                        ) : null}
                        {renderContactList('mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-medium text-inherit opacity-80')}
                    </div>
                    {renderAvatarFrame('rf-deephire-avatar flex h-24 w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-white/80 bg-white shadow-sm', 'cover')}
                </div>
            </div>
        );
    }

    const isCyberFuture = activeTemplate.id === 'deephire-cyber-future';
    const isRenaissance = activeTemplate.id === 'deephire-renaissance';
    const isCampusYouth = activeTemplate.id === 'deephire-campus-youth';

    return (
        <div
            id="basic-info"
            data-rf-section-id="basic-info"
            className={`rf-deephire-header rf-deephire-header--avatar-right scroll-mt-8 border-b pb-4 ${sectionSpacingClass}`}
            style={{ ...commonStyle, borderBottomColor: tokens?.borderColor ?? 'var(--rf-accent-border)' }}
        >
            {renderOverflowMarker('basic-info')}
            <div className="rf-deephire-header-inner flex items-start justify-between gap-6">
                <div className="rf-deephire-profile-copy min-w-0 flex-1">
                    <h1 className="rf-deephire-name text-[32px] font-bold leading-none tracking-[0.08em] text-gray-950">
                        {profile.name}
                    </h1>
                    {resumeDisplayTitle ? (
                        <p className="rf-deephire-title mt-2 text-[11px] font-semibold leading-snug text-gray-600">{resumeDisplayTitle}</p>
                    ) : null}
                    {renderContactList('mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-medium text-gray-600')}
                </div>
                <div className="rf-deephire-avatar-wrap relative shrink-0">
                    {isCyberFuture ? (
                        <>
                            <Square className="rf-cyber-avatar-square rf-cyber-avatar-square--back absolute" aria-hidden="true" />
                            <Square className="rf-cyber-avatar-square rf-cyber-avatar-square--front absolute" aria-hidden="true" />
                        </>
                    ) : null}
                    {isRenaissance ? (
                        <Diamond className="rf-renaissance-avatar-diamond absolute" aria-hidden="true" />
                    ) : null}
                    {isCampusYouth ? (
                        <Circle className="rf-campus-avatar-dot absolute" fill="currentColor" aria-hidden="true" />
                    ) : null}
                    {renderAvatarFrame('rf-deephire-avatar relative z-[1] flex h-24 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm', 'cover')}
                </div>
            </div>
        </div>
    );
};

export default DeepHireHeaderBlock;
