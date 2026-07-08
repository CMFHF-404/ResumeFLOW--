import React from 'react';
import { User, Briefcase, Folder, GraduationCap, Wrench, BadgeCheck, List } from 'lucide-react';
import {
    FONT_SIZE_DEFAULT,
    PREVIEW_PADDING_MM,
    SECTION_TITLE_BOTTOM_PADDING,
    SECTION_TITLE_BOTTOM_SPACING,
} from '../constants';
import type {
    CertificationView,
    EducationView,
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    ResumeExperienceView,
    SkillGroupView,
} from '../../../types/resume';
import {
    RICH_TEXT_INLINE_STYLES_CLASS,
    sanitizeRichTextHtml,
    stripRichTextToText,
} from '../../../utils/richText';
import { resolveDragTarget } from '../../../utils/dragSort';
import {
    resolveResumeTemplate,
    resolveResumeThemeColor,
    type ResumeTemplateId,
    type ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';
import { normalizeResumeSkillTagSeparator } from '../../../utils/resumeCustomization';
import {
    A4_PAGE_HEIGHT_MM,
    A4_PAGE_WIDTH_MM,
    DESKTOP_EDITOR_MEDIA_QUERY,
    EDITOR_PREVIEW_MAX_A4_HEIGHT_RATIO,
    LIST_GAP_CLASS,
    MOBILE_EDITOR_MEDIA_QUERY,
    PREVIEW_SCALE_EPSILON,
    PREVIEW_SIZE_EPSILON,
    SPLIT_TEMPLATE_SIDEBAR_RATIO,
    buildPreviewTypographyCss,
    detectDesktopEditorViewport,
    detectTouchOnlyInteractionEnvironment,
    resolveContactItems,
    resolveProfileInitials,
    resolveSectionSpacingPx,
    resolveSplitColumnSectionIds,
    resolveVisibleSectionOrder,
} from './ResumePreview/previewRenderUtils';
import {
    DATA_ITEM_CONTAINER_ATTR,
    DATA_ITEM_ID_ATTR,
    DATA_ITEM_SURFACE_ATTR,
    DATA_SECTION_ID_ATTR,
    DATA_SECTION_SURFACE_ATTR,
    TOUCH_AUTOSCROLL_EDGE_PX,
    TOUCH_AUTOSCROLL_MAX_STEP_PX,
    TOUCH_DRAG_CANCEL_DISTANCE_PX,
    TOUCH_DRAG_PREVIEW_LIFT_PX,
    TOUCH_LONG_PRESS_DELAY_MS,
    findNearestScrollableAncestor,
    resolveElementVerticalPadding,
    type DragDropHandler,
    type DragHoverHandler,
    type ItemDragHandler,
    type SectionDragHandler,
    type TouchDragMode,
    type TouchDragPreviewState,
    type TouchDragSession,
    type TouchDragStartHandler,
    type TouchFeedbackState,
} from './ResumePreview/dragDrop';
import {
    buildPreviewContentLayoutClassName,
    buildPreviewContentLayoutStyle,
    buildPreviewInteractionClasses,
    buildPreviewPageStyle,
    buildPreviewSpacingStyles,
    buildSplitTemplateBackgroundStyle,
    buildTouchHandleStyle,
    resolveSectionHeadingBorderClassName,
    resolveSectionHeadingTextClassName,
    resolveTemplateSectionSurfaceToneClass,
} from './ResumePreview/templateStyles';
import SummarySection from './ResumePreview/sections/SummarySection';
import ExperienceSection from './ResumePreview/sections/ExperienceSection';
import EducationSection from './ResumePreview/sections/EducationSection';
import CertificationSection from './ResumePreview/sections/CertificationSection';
import SkillSection from './ResumePreview/sections/SkillSection';
import HeaderBlock from './ResumePreview/sections/HeaderBlock';

const CSS_PX_PER_MM = 96 / 25.4;

export type ResumePreviewProps = {
    previewRef: React.RefObject<HTMLDivElement>;
    previewContentRef: React.RefObject<HTMLDivElement>;
    previewScope: string;
    showOverflowGuide?: boolean;
    suppressOverflowIndicators?: boolean;
    overflowHighlightSectionIds?: Set<string>;
    polishHighlightItemIds?: Set<string>;
    lineHeight: number;
    fontSize: number;
    listSpacingValue: string;
    bulletSpacingValue: string;
    topPaddingPx: number;
    templateId?: ResumeTemplateId;
    themeColorPresetId?: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
    profile: ResumeEditorProfile;
    sectionSpacingClass: string;
    listSpacingClass: string;
    sectionOrder: string[];
    selectedWorkItems: ResumeExperienceView[];
    selectedProjectItems: ResumeExperienceView[];
    educations: EducationView[];
    selectedEduIds: Set<string>;
    sortedCertifications: CertificationView[];
    selectedCertIds: Set<string>;
    selectedSkillGroups: SkillGroupView[];
    readOnly?: boolean;
    isDragging: boolean;
    draggedItemKey: string | null;
    draggedSectionId: string | null;
    onSectionDragStart: SectionDragHandler;
    onSectionDragHover: DragHoverHandler;
    onSectionDrop: DragDropHandler;
    onTouchSectionDragStart: TouchDragStartHandler;
    onItemDragStart: ItemDragHandler;
    onItemDragHover: DragHoverHandler;
    onItemDrop: DragDropHandler;
    onTouchItemDragStart: TouchDragStartHandler;
    onTouchDragEnd: () => void;
    onTouchDragCancel: () => void;
    onDragEnd: () => void;
    onNavigateTab: (tab: 'profile' | 'experience') => void;
    onEditExperience: (id: string) => void;
    onEditCertification: (id: string) => void;
    onEditSkill: (id: string) => void;
    /** 简历文档标题（如「AI产品经理 - 某公司」），用于头像名片等页眉副标题 */
    resumeDisplayTitle?: string;
};

const ResumePreview: React.FC<ResumePreviewProps> = ({
    previewRef,
    previewContentRef,
    previewScope,
    showOverflowGuide = false,
    suppressOverflowIndicators = false,
    overflowHighlightSectionIds,
    polishHighlightItemIds,
    lineHeight,
    fontSize,
    listSpacingValue,
    bulletSpacingValue,
    topPaddingPx,
    templateId = 'modern-slate',
    themeColorPresetId,
    experienceListMarkerStyle,
    skillTagSeparator,
    profile,
    sectionSpacingClass,
    listSpacingClass,
    sectionOrder,
    selectedWorkItems,
    selectedProjectItems,
    educations,
    selectedEduIds,
    sortedCertifications,
    selectedCertIds,
    selectedSkillGroups,
    readOnly,
    isDragging,
    draggedItemKey,
    draggedSectionId,
    onSectionDragStart,
    onSectionDragHover,
    onSectionDrop,
    onTouchSectionDragStart,
    onItemDragStart,
    onItemDragHover,
    onItemDrop,
    onTouchItemDragStart,
    onTouchDragEnd,
    onTouchDragCancel,
    onDragEnd,
    onNavigateTab,
    onEditExperience,
    onEditCertification,
    onEditSkill,
    resumeDisplayTitle: resumeDisplayTitleProp,
}) => {
    const isDashboardCardPreview = previewScope === 'dashboard-card';
    const isDashboardThumbnailPreview = isDashboardCardPreview || previewScope === 'dashboard-row';
    const isScaledEditorPreview = previewScope === 'editor' || previewScope === 'dashboard-modal' || isDashboardThumbnailPreview;
    const isDashboardModalPreview = previewScope === 'dashboard-modal';
    const isPrintPreview = previewScope === 'print';
    const previewScrollRef = React.useRef<HTMLElement | null>(null);
    const previewViewportRef = React.useRef<HTMLDivElement | null>(null);
    const touchSessionRef = React.useRef<TouchDragSession | null>(null);
    const touchDragPreviewRef = React.useRef<HTMLDivElement | null>(null);
    const desktopDragPreviewRef = React.useRef<HTMLDivElement | null>(null);
    const [touchFeedback, setTouchFeedback] = React.useState<TouchFeedbackState>(null);
    const [touchDragPreview, setTouchDragPreview] = React.useState<TouchDragPreviewState | null>(null);
    const [activeMobileItemControlId, setActiveMobileItemControlId] = React.useState<string | null>(null);
    const [isTouchOnlyInteractionEnvironment, setIsTouchOnlyInteractionEnvironment] = React.useState(() => (
        previewScope === 'editor' && detectTouchOnlyInteractionEnvironment()
    )
    );
    const [isDesktopEditorViewport, setIsDesktopEditorViewport] = React.useState(() => (
        previewScope === 'editor' ? detectDesktopEditorViewport() : true
    )
    );
    const isReadOnly = Boolean(readOnly);
    const resumeDisplayTitle = React.useMemo(
        () => (resumeDisplayTitleProp ?? '').trim() || undefined,
        [resumeDisplayTitleProp]
    );
    const useMobileEditorInteraction = previewScope === 'editor' && !isDesktopEditorViewport;
    const showTouchDragHandles = !isReadOnly
        && (isTouchOnlyInteractionEnvironment || useMobileEditorInteraction);
    const usePageScrollOnMobile = useMobileEditorInteraction;
    const previewTypographyCss = React.useMemo(
        () => buildPreviewTypographyCss(fontSize / FONT_SIZE_DEFAULT, previewScope),
        [fontSize, previewScope]
    );
    const [scaledPreviewMetrics, setScaledPreviewMetrics] = React.useState({
        scale: 1,
        widthPx: 0,
        heightPx: 0,
    });
    const sectionSpacingPx = React.useMemo(
        () => resolveSectionSpacingPx(sectionSpacingClass),
        [sectionSpacingClass]
    );
    const {
        sectionWrapperStyle,
        sectionSurfaceStyle,
        itemSurfaceStyle,
        sectionTitleStyle,
        headerStyle,
    } = React.useMemo(
        () => buildPreviewSpacingStyles(sectionSpacingPx),
        [sectionSpacingPx]
    );
    const summaryHtml = React.useMemo(
        () => sanitizeRichTextHtml(profile.summary ?? ''),
        [profile.summary]
    );
    const hasMeaningfulSummary = React.useMemo(
        () => Boolean(stripRichTextToText(profile.summary ?? '').trim()),
        [profile.summary]
    );
    const visibleSectionOrder = React.useMemo(
        () => resolveVisibleSectionOrder(sectionOrder, hasMeaningfulSummary),
        [hasMeaningfulSummary, sectionOrder]
    );
    const contactItems = React.useMemo(
        () => resolveContactItems(profile),
        [profile]
    );

    const activeTemplate = React.useMemo(
        () => resolveResumeTemplate(templateId),
        [templateId]
    );
    const activeThemeColor = React.useMemo(
        () => resolveResumeThemeColor(templateId, themeColorPresetId),
        [templateId, themeColorPresetId]
    );
    const isOpenSourceClassicTemplate = activeTemplate.id === 'open-source-classic';
    const isTimelineBlueTemplate = activeTemplate.id === 'timeline-blue';
    const isPhotoCardTemplate = activeTemplate.id === 'photo-card';
    const isPhotoSidebarTemplate = activeTemplate.id === 'photo-sidebar';
    const resolvedSkillTagSeparator = React.useMemo(
        () => normalizeResumeSkillTagSeparator(skillTagSeparator),
        [skillTagSeparator]
    );
    const isSplitTemplate = activeTemplate.layoutKind === 'split';
    const splitColumnSectionIds = React.useMemo(
        () => resolveSplitColumnSectionIds(visibleSectionOrder, isSplitTemplate),
        [isSplitTemplate, visibleSectionOrder]
    );
    const splitSidebarSectionIdSet = React.useMemo(
        () => new Set(splitColumnSectionIds.sidebar),
        [splitColumnSectionIds.sidebar]
    );
    const profileInitials = React.useMemo(
        () => resolveProfileInitials(profile.name || ''),
        [profile.name]
    );
    const avatarSrc = React.useMemo(
        () => profile.avatarDataUrl?.trim() ?? '',
        [profile.avatarDataUrl]
    );
    const renderSkillGroupLine = React.useCallback((group: SkillGroupView) => (
        <div className={`grid grid-cols-[100px_1fr] ${LIST_GAP_CLASS}`}>
            <span className="font-bold text-gray-900">{group.name}:</span>
            <span>{group.skills.map((skill) => skill.name).join(resolvedSkillTagSeparator)}</span>
        </div>
    ), [resolvedSkillTagSeparator]);
    const [hasAvatarLoadError, setHasAvatarLoadError] = React.useState(false);

    React.useEffect(() => {
        setHasAvatarLoadError(false);
    }, [avatarSrc]);

    const enableNativeHtmlDrag = !isReadOnly && !isTouchOnlyInteractionEnvironment;
    const isTouchDragging = touchFeedback?.phase === 'dragging';

    // 拖拽时浏览器可能“冻结”hover 状态（尤其是起始元素），导致 hover 高光在拖动过程中残留。
    // 因此拖拽期间禁用所有 hover 视觉反馈，只保留拖拽交互本身（实时重排）。
    const {
        itemControlBaseClass,
        sectionControlClass,
        itemHoverBgClass,
        sectionDragClass,
        itemDragClass,
        touchSelectionClass,
        interactionTransitionClass,
    } = React.useMemo(
        () => buildPreviewInteractionClasses({
            showTouchDragHandles,
            isDragging,
            isReadOnly,
        }),
        [isDragging, isReadOnly, showTouchDragHandles]
    );
    const touchHandleStyle = React.useMemo(
        () => buildTouchHandleStyle(isReadOnly, isDragging),
        [isDragging, isReadOnly]
    );
    const getTouchFeedbackState = React.useCallback((mode: TouchDragMode, sourceId: string) => {
        if (!touchFeedback || touchFeedback.mode !== mode || touchFeedback.sourceId !== sourceId) {
            return null;
        }
        return touchFeedback.phase;
    }, [touchFeedback]);
    const getTemplateSectionSurfaceToneClass = React.useCallback((sectionId: string) => {
        return resolveTemplateSectionSurfaceToneClass({
            sectionId,
            activeTemplate,
            isSplitTemplate,
            isTimelineBlueTemplate,
            splitSidebarSectionIdSet,
        });
    }, [activeTemplate, isSplitTemplate, isTimelineBlueTemplate, splitSidebarSectionIdSet]);
    const getSectionSurfaceClass = React.useCallback((sectionId: string) => {
        const feedbackPhase = getTouchFeedbackState('section', sectionId);
        const templateToneClass = getTemplateSectionSurfaceToneClass(sectionId);
        const isAccentOrAvatar = activeTemplate.layoutKind === 'accent' || activeTemplate.layoutKind === 'avatar' || activeTemplate.layoutKind === 'minimal' || isTimelineBlueTemplate;
        const baseClass = isAccentOrAvatar
            ? `-m-1 rounded p-1 ${templateToneClass} ${interactionTransitionClass}`.trim()
            : `-m-2 rounded p-2 ${templateToneClass} ${interactionTransitionClass}`.trim();
        if (feedbackPhase === 'dragging' && touchDragPreview?.sourceId === sectionId) {
            return `${baseClass} border border-dashed border-primary/35 bg-primary/[0.03] shadow-none`;
        }
        if (feedbackPhase === 'dragging') {
            return `${baseClass} bg-primary/10 ring-1 ring-primary/35 shadow-[0_14px_32px_rgba(16,185,129,0.14)] -translate-y-0.5`;
        }
        if (feedbackPhase === 'pressing') {
            return `${baseClass} bg-primary/6 ring-1 ring-primary/20 shadow-[0_10px_22px_rgba(16,185,129,0.10)]`;
        }
        return baseClass;
    }, [activeTemplate.layoutKind, getTemplateSectionSurfaceToneClass, getTouchFeedbackState, interactionTransitionClass, isTimelineBlueTemplate, touchDragPreview?.sourceId]);
    const getItemSurfaceClass = React.useCallback((itemKey: string) => {
        const feedbackPhase = getTouchFeedbackState('item', itemKey);
        const baseClass = `${itemHoverBgClass} -m-2 rounded p-2 ${touchSelectionClass} ${interactionTransitionClass}`;
        if (feedbackPhase === 'dragging' && touchDragPreview?.sourceId === itemKey) {
            return `${baseClass} opacity-20 ring-1 ring-primary/15 shadow-none`;
        }
        if (feedbackPhase === 'dragging') {
            return `${baseClass} bg-white ring-1 ring-primary/35 shadow-[0_18px_38px_rgba(15,23,42,0.16)] -translate-y-1`;
        }
        if (feedbackPhase === 'pressing') {
            return `${baseClass} bg-white/95 ring-1 ring-primary/20 shadow-[0_10px_24px_rgba(15,23,42,0.10)] -translate-y-0.5`;
        }
        return baseClass;
    }, [getTouchFeedbackState, interactionTransitionClass, itemHoverBgClass, touchDragPreview?.sourceId, touchSelectionClass]);
    const getItemControlClass = React.useCallback((itemKey: string) => {
        if (isDragging || isReadOnly) {
            return `${itemControlBaseClass} pointer-events-none opacity-0`;
        }
        if (showTouchDragHandles) {
            const feedbackPhase = getTouchFeedbackState('item', itemKey);
            const isVisible = activeMobileItemControlId === itemKey || feedbackPhase !== null;
            return isVisible
                ? `${itemControlBaseClass} opacity-100`
                : `${itemControlBaseClass} pointer-events-none opacity-0`;
        }
        return `${itemControlBaseClass} opacity-0 group-hover/item:opacity-100 transition-opacity`;
    }, [
        activeMobileItemControlId,
        getTouchFeedbackState,
        isDragging,
        isReadOnly,
        itemControlBaseClass,
        showTouchDragHandles,
    ]);

    const clearTouchDragPreview = React.useCallback(() => {
        setTouchDragPreview(null);
    }, []);

    const clearDesktopDragPreview = React.useCallback(() => {
        const previewNode = desktopDragPreviewRef.current;
        if (!previewNode) {
            return;
        }

        previewNode.remove();
        desktopDragPreviewRef.current = null;
    }, []);

    const createDesktopDragPreview = React.useCallback((
        event: React.DragEvent<HTMLElement>,
        sourceElement: HTMLElement | null
    ) => {
        if (!event.dataTransfer || !sourceElement || typeof document === 'undefined') {
            return;
        }

        clearDesktopDragPreview();

        const rect = sourceElement.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const clone = sourceElement.cloneNode(true) as HTMLElement;
        clone.style.margin = '0';
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.maxWidth = 'none';
        clone.style.transform = 'none';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';
        clone.style.boxSizing = 'border-box';

        const previewNode = document.createElement('div');
        previewNode.style.position = 'fixed';
        previewNode.style.left = '-9999px';
        previewNode.style.top = '-9999px';
        previewNode.style.pointerEvents = 'none';
        previewNode.style.zIndex = '-1';
        previewNode.style.width = `${rect.width}px`;
        previewNode.style.height = `${rect.height}px`;
        previewNode.style.borderRadius = '18px';
        previewNode.style.overflow = 'visible';
        previewNode.style.filter = 'drop-shadow(0 22px 40px rgba(15, 23, 42, 0.18))';
        previewNode.style.transform = 'scale(1.03)';
        previewNode.style.transformOrigin = 'top left';
        previewNode.appendChild(clone);
        document.body.appendChild(previewNode);
        desktopDragPreviewRef.current = previewNode;

        const offsetX = Math.min(rect.width - 12, Math.max(12, event.clientX - rect.left));
        const offsetY = Math.min(rect.height - 12, Math.max(12, event.clientY - rect.top));
        event.dataTransfer.setDragImage(previewNode, offsetX, offsetY);
    }, [clearDesktopDragPreview]);

    const updateTouchDragPreviewPosition = React.useCallback((clientX: number, clientY: number) => {
        const previewNode = touchDragPreviewRef.current;
        const session = touchSessionRef.current;
        const previewElement = previewRef.current;
        if (!previewNode || !session || !previewElement) {
            return;
        }

        const previewRect = previewElement.getBoundingClientRect();
        const previewScale = previewElement.offsetWidth > 0
            ? previewRect.width / previewElement.offsetWidth
            : 1;
        const safeScale = previewScale > 0 ? previewScale : 1;
        const left = (clientX - previewRect.left - session.startX + session.sourceRectLeft) / safeScale;
        const top = (clientY - previewRect.top - session.startY + session.sourceRectTop) / safeScale
            - (TOUCH_DRAG_PREVIEW_LIFT_PX / safeScale);

        previewNode.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.03)`;
    }, [previewRef]);

    const createTouchDragPreview = React.useCallback((session: TouchDragSession) => {
        if (!session.sourceElement) {
            clearTouchDragPreview();
            return;
        }

        const previewElement = previewRef.current;
        if (!previewElement) {
            clearTouchDragPreview();
            return;
        }

        const sourceRect = session.sourceElement.getBoundingClientRect();
        const previewRect = previewElement.getBoundingClientRect();
        const previewScale = previewElement.offsetWidth > 0
            ? previewRect.width / previewElement.offsetWidth
            : 1;
        const safeScale = previewScale > 0 ? previewScale : 1;
        const clone = session.sourceElement.cloneNode(true) as HTMLElement;
        clone.style.margin = '0';
        clone.style.width = '100%';
        clone.style.height = '100%';
        clone.style.maxWidth = 'none';
        clone.style.transform = 'none';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';

        session.sourceRectLeft = sourceRect.left;
        session.sourceRectTop = sourceRect.top;

        setTouchDragPreview({
            sourceId: session.sourceId,
            width: sourceRect.width / safeScale,
            height: sourceRect.height / safeScale,
            html: clone.outerHTML,
        });
    }, [clearTouchDragPreview, previewRef]);

    const cancelTouchSession = React.useCallback(() => {
        const session = touchSessionRef.current;
        if (!session) {
            return;
        }
        if (session.timerId !== null && typeof window !== 'undefined') {
            window.clearTimeout(session.timerId);
        }
        touchSessionRef.current = null;
        setTouchFeedback(null);
        clearTouchDragPreview();
    }, [clearTouchDragPreview]);

    const finishTouchSession = React.useCallback((shouldCommit: boolean) => {
        const session = touchSessionRef.current;
        if (!session) {
            return;
        }
        if (session.timerId !== null && typeof window !== 'undefined') {
            window.clearTimeout(session.timerId);
        }
        const wasActivated = session.activated;
        const shouldPreserveMobileItemControl = showTouchDragHandles && session.mode === 'item';
        touchSessionRef.current = null;
        setTouchFeedback(null);
        clearTouchDragPreview();
        if (!shouldPreserveMobileItemControl && (!shouldCommit || !wasActivated)) {
            setActiveMobileItemControlId(null);
        }
        if (shouldCommit && wasActivated) {
            onTouchDragEnd();
            return;
        }
        if (wasActivated) {
            onTouchDragCancel();
        }
    }, [clearTouchDragPreview, onTouchDragCancel, onTouchDragEnd, showTouchDragHandles]);

    const autoScrollPreview = React.useCallback((clientY: number) => {
        const scrollContainer = usePageScrollOnMobile
            ? findNearestScrollableAncestor(previewScrollRef.current)
            : previewScrollRef.current;
        if (!scrollContainer) {
            return;
        }

        const rect = scrollContainer.getBoundingClientRect();
        if (!rect.height) {
            return;
        }

        let delta = 0;
        if (clientY < rect.top + TOUCH_AUTOSCROLL_EDGE_PX) {
            const ratio = (rect.top + TOUCH_AUTOSCROLL_EDGE_PX - clientY) / TOUCH_AUTOSCROLL_EDGE_PX;
            delta = -Math.max(6, Math.round(TOUCH_AUTOSCROLL_MAX_STEP_PX * Math.min(1, ratio)));
        } else if (clientY > rect.bottom - TOUCH_AUTOSCROLL_EDGE_PX) {
            const ratio = (clientY - (rect.bottom - TOUCH_AUTOSCROLL_EDGE_PX)) / TOUCH_AUTOSCROLL_EDGE_PX;
            delta = Math.max(6, Math.round(TOUCH_AUTOSCROLL_MAX_STEP_PX * Math.min(1, ratio)));
        }

        if (delta !== 0) {
            scrollContainer.scrollTop += delta;
        }
    }, [usePageScrollOnMobile]);

    const updateTouchDragHover = React.useCallback((clientX: number, clientY: number) => {
        const session = touchSessionRef.current;
        if (!session || !session.activated || typeof document === 'undefined') {
            return;
        }

        autoScrollPreview(clientY);
        const currentTarget = document.elementFromPoint(clientX, clientY);

        if (session.mode === 'section') {
            const container = previewContentRef.current;
            if (!container) {
                return;
            }
            const target = resolveDragTarget(
                container,
                clientY,
                DATA_SECTION_ID_ATTR,
                session.sourceId,
                currentTarget
            );
            if (target) {
                onSectionDragHover(target.id, target.position);
            }
            return;
        }

        if (!session.container) {
            return;
        }

        const target = resolveDragTarget(
            session.container,
            clientY,
            DATA_ITEM_ID_ATTR,
            session.sourceId,
            currentTarget
        );
        if (target) {
            onItemDragHover(target.id, target.position);
        }
    }, [autoScrollPreview, onItemDragHover, onSectionDragHover, previewContentRef]);

    const startTouchLongPress = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        mode: TouchDragMode,
        sourceId: string,
        container: HTMLElement | null,
        sourceElement: HTMLElement | null
    ) => {
        if (isReadOnly || event.touches.length !== 1 || typeof window === 'undefined') {
            return;
        }

        if (touchSessionRef.current?.activated) {
            onTouchDragEnd();
        }
        cancelTouchSession();
        const touch = event.changedTouches[0];
        if (!touch) {
            return;
        }

        const nextSession: TouchDragSession = {
            touchId: touch.identifier,
            mode,
            sourceId,
            container,
            sourceElement,
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            sourceRectLeft: 0,
            sourceRectTop: 0,
            activated: false,
            timerId: null,
        };
        setTouchFeedback({
            mode,
            sourceId,
            phase: 'pressing',
        });

        nextSession.timerId = window.setTimeout(() => {
            const current = touchSessionRef.current;
            if (
                !current
                || current.touchId !== nextSession.touchId
                || current.mode !== mode
                || current.sourceId !== sourceId
            ) {
                return;
            }

            current.activated = true;
            createTouchDragPreview(current);
            setTouchFeedback({
                mode,
                sourceId,
                phase: 'dragging',
            });
            if (mode === 'section') {
                onTouchSectionDragStart(sourceId);
                return;
            }
            onTouchItemDragStart(sourceId);
        }, TOUCH_LONG_PRESS_DELAY_MS);

        touchSessionRef.current = nextSession;
    }, [cancelTouchSession, createTouchDragPreview, isReadOnly, onTouchDragEnd, onTouchItemDragStart, onTouchSectionDragStart]);

    const handleSectionTitleTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        sectionId: string
    ) => {
        const sectionSurface = event.currentTarget.closest(`[${DATA_SECTION_SURFACE_ATTR}]`);
        startTouchLongPress(
            event,
            'section',
            sectionId,
            previewContentRef.current,
            sectionSurface instanceof HTMLElement ? sectionSurface : null
        );
    }, [previewContentRef, startTouchLongPress]);

    const handleItemCardTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        itemKey: string
    ) => {
        setActiveMobileItemControlId(itemKey);
        if (showTouchDragHandles) {
            return;
        }
        const container = event.currentTarget.closest(`[${DATA_ITEM_CONTAINER_ATTR}]`);
        startTouchLongPress(
            event,
            'item',
            itemKey,
            container instanceof HTMLElement ? container : null,
            event.currentTarget
        );
    }, [showTouchDragHandles, startTouchLongPress]);

    const handleSectionControlTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        sectionId: string
    ) => {
        event.stopPropagation();
        const sectionWrapper = event.currentTarget.closest(`[${DATA_SECTION_ID_ATTR}]`);
        const sectionSurface = sectionWrapper?.querySelector(`[${DATA_SECTION_SURFACE_ATTR}]`);
        startTouchLongPress(
            event,
            'section',
            sectionId,
            previewContentRef.current,
            sectionSurface instanceof HTMLElement ? sectionSurface : null
        );
    }, [previewContentRef, startTouchLongPress]);

    const handleItemControlTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        itemKey: string
    ) => {
        event.stopPropagation();
        setActiveMobileItemControlId(itemKey);
        const itemSurface = event.currentTarget
            .closest(`[${DATA_ITEM_ID_ATTR}]`)
            ?.querySelector(`[${DATA_ITEM_SURFACE_ATTR}]`);
        const container = event.currentTarget.closest(`[${DATA_ITEM_CONTAINER_ATTR}]`);
        startTouchLongPress(
            event,
            'item',
            itemKey,
            container instanceof HTMLElement ? container : null,
            itemSurface instanceof HTMLElement ? itemSurface : null
        );
    }, [startTouchLongPress]);

    const stopTouchStartPropagation = React.useCallback((event: React.TouchEvent<HTMLElement>) => {
        event.stopPropagation();
    }, []);

    const handleNativeSectionDragStart = React.useCallback((
        event: React.DragEvent<HTMLElement>,
        sectionId: string
    ) => {
        const sourceElement = event.currentTarget.querySelector(`[${DATA_SECTION_SURFACE_ATTR}]`);
        createDesktopDragPreview(
            event,
            sourceElement instanceof HTMLElement ? sourceElement : event.currentTarget
        );
        onSectionDragStart(event, sectionId);
    }, [createDesktopDragPreview, onSectionDragStart]);

    const handleNativeItemDragStart = React.useCallback((
        event: React.DragEvent<HTMLElement>,
        itemKey: string
    ) => {
        event.stopPropagation();
        const sourceElement = event.currentTarget.querySelector(`[${DATA_ITEM_SURFACE_ATTR}]`);
        createDesktopDragPreview(
            event,
            sourceElement instanceof HTMLElement ? sourceElement : event.currentTarget
        );
        onItemDragStart(event, itemKey);
    }, [createDesktopDragPreview, onItemDragStart]);

    const handleNativeDragEnd = React.useCallback((event: React.DragEvent<HTMLElement>) => {
        event.stopPropagation();
        clearDesktopDragPreview();
        onDragEnd();
    }, [clearDesktopDragPreview, onDragEnd]);

    React.useEffect(() => {
        if (previewScope !== 'editor' || typeof window === 'undefined') {
            return undefined;
        }

        const mediaQueries = [
            window.matchMedia(MOBILE_EDITOR_MEDIA_QUERY),
            window.matchMedia('(pointer: coarse)'),
            window.matchMedia('(any-pointer: coarse)'),
            window.matchMedia('(hover: hover) and (pointer: fine)'),
            window.matchMedia('(any-hover: hover) and (any-pointer: fine)'),
            window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY),
        ];
        const updateInteractionEnvironment = () => {
            setIsTouchOnlyInteractionEnvironment(detectTouchOnlyInteractionEnvironment());
            setIsDesktopEditorViewport(detectDesktopEditorViewport());
        };

        updateInteractionEnvironment();
        window.addEventListener('resize', updateInteractionEnvironment);
        mediaQueries.forEach((mediaQuery) => {
            if (typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', updateInteractionEnvironment);
                return;
            }
            mediaQuery.addListener(updateInteractionEnvironment);
        });

        return () => {
            window.removeEventListener('resize', updateInteractionEnvironment);
            mediaQueries.forEach((mediaQuery) => {
                if (typeof mediaQuery.removeEventListener === 'function') {
                    mediaQuery.removeEventListener('change', updateInteractionEnvironment);
                    return;
                }
                mediaQuery.removeListener(updateInteractionEnvironment);
            });
        };
    }, [previewScope]);

    React.useEffect(() => {
        if (isReadOnly || typeof document === 'undefined') {
            return undefined;
        }

        const resolveTrackedTouch = (touchList: TouchList, touchId: number) => {
            for (let index = 0; index < touchList.length; index += 1) {
                const touch = touchList.item(index);
                if (touch?.identifier === touchId) {
                    return touch;
                }
            }
            return null;
        };

        const handleTouchMove = (event: TouchEvent) => {
            const session = touchSessionRef.current;
            if (!session) {
                return;
            }
            const touch = resolveTrackedTouch(event.touches, session.touchId);
            if (!touch) {
                return;
            }
            session.currentX = touch.clientX;
            session.currentY = touch.clientY;

            if (!session.activated) {
                const distance = Math.hypot(touch.clientX - session.startX, touch.clientY - session.startY);
                if (distance > TOUCH_DRAG_CANCEL_DISTANCE_PX) {
                    finishTouchSession(false);
                }
                return;
            }

            event.preventDefault();
            updateTouchDragHover(touch.clientX, touch.clientY);
            updateTouchDragPreviewPosition(touch.clientX, touch.clientY);
        };

        const handleTouchFinish = (event: TouchEvent) => {
            const session = touchSessionRef.current;
            if (!session) {
                return;
            }
            const touch = resolveTrackedTouch(event.changedTouches, session.touchId);
            if (!touch) {
                return;
            }

            if (session.activated) {
                event.preventDefault();
            }
            finishTouchSession(session.activated);
        };

        const handleTouchCancel = (event: TouchEvent) => {
            const session = touchSessionRef.current;
            if (!session) {
                return;
            }
            const touch = resolveTrackedTouch(event.changedTouches, session.touchId);
            if (!touch) {
                return;
            }

            finishTouchSession(false);
        };

        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchFinish, { passive: false });
        document.addEventListener('touchcancel', handleTouchCancel, { passive: false });

        return () => {
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchFinish);
            document.removeEventListener('touchcancel', handleTouchCancel);
        };
    }, [finishTouchSession, isReadOnly, updateTouchDragHover, updateTouchDragPreviewPosition]);

    React.useEffect(() => {
        return () => {
            cancelTouchSession();
        };
    }, [cancelTouchSession]);

    React.useEffect(() => {
        if (!showTouchDragHandles || typeof document === 'undefined') {
            return undefined;
        }

        const handleDocumentTouchStart = (event: TouchEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                setActiveMobileItemControlId(null);
                return;
            }

            if (target.closest(`[${DATA_ITEM_ID_ATTR}]`) || target.closest(`[${DATA_SECTION_ID_ATTR}]`)) {
                return;
            }

            setActiveMobileItemControlId(null);
        };

        document.addEventListener('touchstart', handleDocumentTouchStart, { passive: true });
        return () => {
            document.removeEventListener('touchstart', handleDocumentTouchStart);
        };
    }, [showTouchDragHandles]);

    React.useEffect(() => {
        return () => {
            clearDesktopDragPreview();
        };
    }, [clearDesktopDragPreview]);

    React.useEffect(() => {
        if (!isTouchDragging || typeof window === 'undefined' || typeof document === 'undefined') {
            return undefined;
        }

        const preventScroll = (event: TouchEvent | WheelEvent) => {
            event.preventDefault();
        };

        document.addEventListener('touchmove', preventScroll, { passive: false });
        document.addEventListener('wheel', preventScroll, { passive: false });

        return () => {
            document.removeEventListener('touchmove', preventScroll);
            document.removeEventListener('wheel', preventScroll);
        };
    }, [isTouchDragging]);

    React.useLayoutEffect(() => {
        const session = touchSessionRef.current;
        if (!touchDragPreview || !session || !session.activated) {
            return;
        }
        updateTouchDragPreviewPosition(session.currentX, session.currentY);
    }, [touchDragPreview, updateTouchDragPreviewPosition]);

    const syncScaledPreviewMetrics = React.useCallback(() => {
        if (!isScaledEditorPreview) {
            return;
        }

        const scrollContainer = previewScrollRef.current;
        const viewport = previewViewportRef.current;
        const previewElement = previewRef.current;
        if (!viewport || !previewElement) {
            return;
        }

        const intrinsicWidth = isDashboardCardPreview
            ? A4_PAGE_WIDTH_MM * CSS_PX_PER_MM
            : previewElement.offsetWidth;
        const intrinsicHeight = isDashboardCardPreview
            ? A4_PAGE_HEIGHT_MM * CSS_PX_PER_MM
            : previewElement.offsetHeight;
        const availableWidth = viewport.clientWidth;
        if (!intrinsicWidth || !intrinsicHeight || !availableWidth) {
            return;
        }

        const widthFitScale = availableWidth / intrinsicWidth;
        let scale = widthFitScale;

        const isDesktopEditorPreview = previewScope === 'editor' && detectDesktopEditorViewport();
        if (isDesktopEditorPreview && scrollContainer) {
            const availableHeight = scrollContainer.clientHeight - resolveElementVerticalPadding(scrollContainer);

            if (availableHeight > 0 && intrinsicHeight > 0) {
                const heightFitScale = (availableHeight * EDITOR_PREVIEW_MAX_A4_HEIGHT_RATIO) / intrinsicHeight;
                scale = Math.min(scale, heightFitScale);
            }
        }

        scale = Math.min(1, scale);
        const nextMetrics = {
            scale,
            widthPx: intrinsicWidth * scale,
            heightPx: intrinsicHeight * scale,
        };

        setScaledPreviewMetrics((currentMetrics) => {
            if (
                Math.abs(currentMetrics.scale - nextMetrics.scale) < PREVIEW_SCALE_EPSILON
                && Math.abs(currentMetrics.widthPx - nextMetrics.widthPx) < PREVIEW_SIZE_EPSILON
                && Math.abs(currentMetrics.heightPx - nextMetrics.heightPx) < PREVIEW_SIZE_EPSILON
            ) {
                return currentMetrics;
            }
            return nextMetrics;
        });
    }, [isDashboardCardPreview, isScaledEditorPreview, previewRef, previewScope]);

    React.useLayoutEffect(() => {
        if (!isScaledEditorPreview) {
            return;
        }

        syncScaledPreviewMetrics();

        const handleResize = () => {
            syncScaledPreviewMetrics();
        };

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('resize', handleResize);
            };
        }

        const resizeObserver = new ResizeObserver(() => {
            syncScaledPreviewMetrics();
        });

        if (!isDashboardCardPreview && previewScrollRef.current) {
            resizeObserver.observe(previewScrollRef.current);
        }
        if (previewViewportRef.current) {
            resizeObserver.observe(previewViewportRef.current);
        }
        if (!isDashboardCardPreview && previewRef.current) {
            resizeObserver.observe(previewRef.current);
        }

        window.addEventListener('resize', handleResize);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, [isDashboardCardPreview, isScaledEditorPreview, previewRef, syncScaledPreviewMetrics]);

    const scaledPreviewWrapperStyle = React.useMemo(() => {
        if (!isScaledEditorPreview) {
            return undefined;
        }

        return {
            width: `${scaledPreviewMetrics.widthPx}px`,
            minHeight: `${scaledPreviewMetrics.heightPx}px`,
        } as React.CSSProperties;
    }, [isScaledEditorPreview, scaledPreviewMetrics.heightPx, scaledPreviewMetrics.widthPx]);

    const previewStyle = React.useMemo(() => {
        return buildPreviewPageStyle({
            lineHeight,
            fontSize,
            topPaddingPx,
            listSpacingValue,
            bulletSpacingValue,
            activeThemeColor,
            isPrintPreview,
            isScaledEditorPreview,
            isSplitTemplate,
            isPhotoCardTemplate,
            scale: scaledPreviewMetrics.scale,
        });
    }, [
        bulletSpacingValue,
        fontSize,
        isPrintPreview,
        isScaledEditorPreview,
        isSplitTemplate,
        isPhotoCardTemplate,
        lineHeight,
        listSpacingValue,
        scaledPreviewMetrics.scale,
        topPaddingPx,
        activeThemeColor.accentBorder,
        activeThemeColor.accentColor,
        activeThemeColor.accentSoftBg,
        activeThemeColor.accentText,
    ]);

    const previewContentLayoutClassName = React.useMemo(
        () => buildPreviewContentLayoutClassName(isSplitTemplate, isReadOnly),
        [isReadOnly, isSplitTemplate]
    );
    const previewContentLayoutStyle = React.useMemo(
        () => buildPreviewContentLayoutStyle(isSplitTemplate, topPaddingPx),
        [isSplitTemplate, topPaddingPx]
    );
    const splitTemplateBackgroundStyle = React.useMemo(
        () => buildSplitTemplateBackgroundStyle(isSplitTemplate, isPrintPreview),
        [isPrintPreview, isSplitTemplate]
    );
    const splitSidebarColumnStyle = React.useMemo(
        () => ({
            backgroundColor: isPhotoSidebarTemplate ? '#111827' : 'var(--rf-accent-soft-bg)',
            borderRight: isPhotoSidebarTemplate ? 'none' : '1px solid var(--rf-accent-border)',
        } as React.CSSProperties),
        [isPhotoSidebarTemplate]
    );
    const splitMainColumnStyle = React.useMemo(
        () => ({
            backgroundColor: '#ffffff',
        } as React.CSSProperties),
        []
    );
    const overflowHighlightStyle = React.useMemo(
        () => ({
            position: 'relative',
            outline: '2px dashed #dc2626',
            outlineOffset: '2px',
            borderRadius: '12px',
            backgroundColor: 'rgba(254, 242, 242, 0.55)',
        } as React.CSSProperties),
        []
    );
    const overflowGuideStyle = React.useMemo(
        () => ({
            left: `${PREVIEW_PADDING_MM}mm`,
            right: `${PREVIEW_PADDING_MM}mm`,
            bottom: `${PREVIEW_PADDING_MM}mm`,
            borderTop: '2px dashed #16a34a',
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.82)',
        } as React.CSSProperties),
        []
    );
    const polishHighlightStyle = React.useMemo(
        () => ({
            backgroundColor: 'rgba(220, 252, 231, 0.72)',
            boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.22), 0 12px 28px rgba(34, 197, 94, 0.12)',
        } as React.CSSProperties),
        []
    );
    const shouldShowOverflowIndicators = showOverflowGuide && !suppressOverflowIndicators;
    const isSectionOverflowHighlighted = React.useCallback(
        (sectionId: string) => Boolean(shouldShowOverflowIndicators && overflowHighlightSectionIds?.has(sectionId)),
        [overflowHighlightSectionIds, shouldShowOverflowIndicators]
    );
    const getSectionOverflowHighlightStyle = React.useCallback(
        (sectionId: string) => (
            isSectionOverflowHighlighted(sectionId)
                ? overflowHighlightStyle
                : undefined
        ),
        [isSectionOverflowHighlighted, overflowHighlightStyle]
    );
    const getItemPolishHighlightStyle = React.useCallback(
        (itemKey: string) => (
            polishHighlightItemIds?.has(itemKey)
                ? polishHighlightStyle
                : undefined
        ),
        [polishHighlightItemIds, polishHighlightStyle]
    );
    const renderOverflowMarker = React.useCallback(
        (sectionId: string) => {
            if (!isSectionOverflowHighlighted(sectionId)) {
                return null;
            }

            return (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-3 right-3 z-[45] whitespace-nowrap rounded-full border border-red-300 bg-white px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-red-600 shadow-sm"
                >
                    超出A4纸
                </div>
            );
        },
        [isSectionOverflowHighlighted]
    );
    const getTemplateSectionWrapperStyle = React.useCallback((sectionId: string) => {
        return sectionWrapperStyle;
    }, [sectionWrapperStyle]);
    const sectionHeadingTextClassName = React.useMemo(() => {
        return resolveSectionHeadingTextClassName(
            activeTemplate,
            isOpenSourceClassicTemplate,
            isTimelineBlueTemplate
        );
    }, [activeTemplate, isOpenSourceClassicTemplate, isTimelineBlueTemplate]);
    const sectionHeadingBorderClassName = React.useMemo(() => {
        return resolveSectionHeadingBorderClassName(
            activeTemplate,
            isOpenSourceClassicTemplate,
            isPhotoCardTemplate,
            isTimelineBlueTemplate
        );
    }, [activeTemplate, isOpenSourceClassicTemplate, isPhotoCardTemplate, isTimelineBlueTemplate]);
    const renderAvatarFrame = React.useCallback((className: string, imageObjectFit: 'contain' | 'cover' = 'contain') => {
        if (avatarSrc && !hasAvatarLoadError) {
            const isAvatarLayout = activeTemplate.layoutKind === 'avatar';
            return (
                <div className={`${className} ${isAvatarLayout ? 'ring-1 ring-gray-900/10 shadow-sm' : ''}`}>
                    <img
                        src={avatarSrc}
                        alt="个人头像"
                        className={`h-full w-full ${imageObjectFit === 'cover' ? 'object-cover' : 'object-contain'}`}
                        onError={() => setHasAvatarLoadError(true)}
                    />
                </div>
            );
        }
        return (
            <div className={`${className} items-center justify-center bg-gray-100 p-0.5 text-sm font-bold text-gray-700`}>
                {profileInitials}
            </div>
        );
    }, [activeTemplate.layoutKind, avatarSrc, hasAvatarLoadError, profileInitials]);
    const CLASSIC_SECTION_ICONS: Record<string, React.ElementType> = {
        summary: User,
        work: Briefcase,
        project: Folder,
        education: GraduationCap,
        skills: Wrench,
        certifications: BadgeCheck,
    };
    const renderSectionHeading = React.useCallback((
        title: string,
        sectionId: string
    ) => {
        const isAccent = activeTemplate.layoutKind === 'accent';
        const isAccentEmerald = activeTemplate.id === 'accent-emerald';
        const isAvatar = activeTemplate.layoutKind === 'avatar';
        const isClassic = activeTemplate.layoutKind === 'classic';
        const isModernAvatar = activeTemplate.id === 'modern-slate-avatar';
        const isOpenSourceClassic = isOpenSourceClassicTemplate;
        const isPhotoCard = isPhotoCardTemplate;
        const isTimelineBlue = isTimelineBlueTemplate;
        const isPhotoSidebarSection = isPhotoSidebarTemplate && splitSidebarSectionIdSet.has(sectionId);
        const SectionIconComponent = CLASSIC_SECTION_ICONS[sectionId] || List;
        const IconComponent = (isClassic || isModernAvatar || isTimelineBlue) ? SectionIconComponent : null;
        
        return (
            <h2
                className={`${touchSelectionClass} font-bold uppercase ${sectionHeadingTextClassName} ${sectionHeadingBorderClassName} ${isAccent || isClassic || isModernAvatar || isTimelineBlue ? 'flex items-center' : ''} ${isAccent && !isTimelineBlue ? 'pl-3.5 py-1.5' : (isAvatar ? '' : SECTION_TITLE_BOTTOM_PADDING)} ${isAccent && !isTimelineBlue ? '' : SECTION_TITLE_BOTTOM_SPACING} ${isAvatar ? 'mb-4' : ''} ${isClassic || isModernAvatar ? 'gap-[0.4em]' : ''} ${isTimelineBlue ? 'relative min-w-0 w-full gap-2 pr-1' : ''}`}
                style={{
                    ...(isAccentEmerald || !isAccent ? sectionTitleStyle : {}),
                    ...touchHandleStyle,
                    color: isPhotoSidebarSection ? '#ffffff'
                        : isAvatar || isTimelineBlue ? 'var(--rf-accent-color)'
                        : 'var(--rf-accent-text)',
                    borderBottomColor: activeTemplate.layoutKind === 'minimal'
                        ? '#e5e7eb'
                        : isPhotoSidebarSection ? 'rgba(255,255,255,0.35)'
                        : isPhotoCard ? 'var(--rf-accent-border)'
                        : isAccent ? (isTimelineBlue ? 'var(--rf-accent-border)' : 'transparent')
                        : isAvatar ? 'var(--rf-accent-color)'
                        : 'var(--rf-accent-border)',
                    ...(isAccent && !isTimelineBlue ? {
                        borderLeft: `5px solid var(--rf-accent-color)`,
                        background: `linear-gradient(to right, var(--rf-accent-soft-bg), transparent)`,
                        borderRadius: '0 4px 4px 0',
                    } : {}),
                    ...(isOpenSourceClassic ? {
                        fontFamily: 'Georgia, "Times New Roman", serif',
                    } : {})
                }}
                onTouchStart={
                    isReadOnly || showTouchDragHandles
                        ? undefined
                        : (event) => handleSectionTitleTouchStart(event, sectionId)
                }
            >
                {isTimelineBlue ? (
                    <>
                        {IconComponent ? (
                            <span
                                aria-hidden="true"
                                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-white"
                                style={{ borderColor: 'var(--rf-accent-border)' }}
                            >
                                <IconComponent className="h-2.5 w-2.5" style={{ color: 'var(--rf-accent-color)' }} />
                            </span>
                        ) : null}
                        <span className="shrink-0">{title}</span>
                        <span
                            aria-hidden="true"
                            className="ms-3 h-px min-w-[1.25rem] flex-1 self-center rounded-full"
                            style={{ backgroundColor: 'var(--rf-accent-border)', opacity: 0.88 }}
                        />
                    </>
                ) : (
                    <>
                        {IconComponent && (
                            <IconComponent
                                className="h-[1.1em] w-[1.1em]"
                                style={{ color: isPhotoSidebarSection ? '#ffffff' : 'var(--rf-accent-color)' }}
                            />
                        )}
                        <span>{title}</span>
                    </>
                )}
            </h2>
        );
    }, [
        activeTemplate.id,
        activeTemplate.layoutKind,
        isOpenSourceClassicTemplate,
        isPhotoCardTemplate,
        isPhotoSidebarTemplate,
        isReadOnly,
        isTimelineBlueTemplate,
        sectionHeadingBorderClassName,
        sectionHeadingTextClassName,
        sectionTitleStyle,
        showTouchDragHandles,
        splitSidebarSectionIdSet,
        touchHandleStyle,
        touchSelectionClass,
    ]);
    const renderAccentTopDecoration = React.useCallback(() => {
        if (activeTemplate.layoutKind !== 'accent' || isTimelineBlueTemplate) {
            return null;
        }

        return (
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 top-0 h-1.5"
                style={{ backgroundColor: 'var(--rf-accent-color)' }}
            />
        );
    }, [activeTemplate.layoutKind, isTimelineBlueTemplate]);

    const renderExperienceSection = (
        sectionId: 'work' | 'project',
        title: string,
        items: ResumeExperienceView[]
    ) => (
        <ExperienceSection
            sectionId={sectionId}
            title={title}
            items={items}
            experienceListMarkerStyle={experienceListMarkerStyle}
            sectionSpacingClass={sectionSpacingClass}
            listSpacingClass={listSpacingClass}
            sectionDragClass={sectionDragClass}
            itemDragClass={itemDragClass}
            sectionControlClass={sectionControlClass}
            sectionSurfaceStyle={sectionSurfaceStyle}
            itemSurfaceStyle={itemSurfaceStyle}
            touchHandleStyle={touchHandleStyle}
            enableNativeHtmlDrag={enableNativeHtmlDrag}
            isReadOnly={isReadOnly}
            showTouchDragHandles={showTouchDragHandles}
            isTimelineBlueTemplate={isTimelineBlueTemplate}
            draggedItemKey={draggedItemKey}
            draggedSectionId={draggedSectionId}
            getTemplateSectionWrapperStyle={getTemplateSectionWrapperStyle}
            getSectionSurfaceClass={getSectionSurfaceClass}
            getItemSurfaceClass={getItemSurfaceClass}
            getItemControlClass={getItemControlClass}
            getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
            getItemPolishHighlightStyle={getItemPolishHighlightStyle}
            renderOverflowMarker={renderOverflowMarker}
            renderSectionHeading={renderSectionHeading}
            handleNativeSectionDragStart={handleNativeSectionDragStart}
            handleNativeItemDragStart={handleNativeItemDragStart}
            handleNativeDragEnd={handleNativeDragEnd}
            handleSectionControlTouchStart={handleSectionControlTouchStart}
            handleItemControlTouchStart={handleItemControlTouchStart}
            handleItemCardTouchStart={handleItemCardTouchStart}
            stopTouchStartPropagation={stopTouchStartPropagation}
            setActiveMobileItemControlId={setActiveMobileItemControlId}
            onSectionDrop={onSectionDrop}
            onItemDragHover={onItemDragHover}
            onItemDrop={onItemDrop}
            onEditExperience={onEditExperience}
        />
    );

    const renderSummarySection = () => {
        if (!hasMeaningfulSummary || !summaryHtml.trim()) {
            return null;
        }

        return (
            <SummarySection
                summaryHtml={summaryHtml}
                sectionSpacingClass={sectionSpacingClass}
                sectionDragClass={sectionDragClass}
                sectionControlClass={sectionControlClass}
                sectionSurfaceStyle={sectionSurfaceStyle}
                enableNativeHtmlDrag={enableNativeHtmlDrag}
                isReadOnly={isReadOnly}
                showTouchDragHandles={showTouchDragHandles}
                getTemplateSectionWrapperStyle={getTemplateSectionWrapperStyle}
                getSectionSurfaceClass={getSectionSurfaceClass}
                getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
                renderOverflowMarker={renderOverflowMarker}
                renderSectionHeading={renderSectionHeading}
                handleNativeSectionDragStart={handleNativeSectionDragStart}
                handleNativeDragEnd={handleNativeDragEnd}
                handleSectionControlTouchStart={handleSectionControlTouchStart}
                onSectionDrop={onSectionDrop}
            />
        );
    };
    const renderEducationSection = (variant: 'split' | 'page', includeOverflowState: boolean) => {
        const visibleEducations = educations.filter((edu) => selectedEduIds.has(edu.id));

        return (
            <EducationSection
                items={visibleEducations}
                variant={variant}
                sectionSpacingClass={sectionSpacingClass}
                listSpacingClass={listSpacingClass}
                sectionDragClass={sectionDragClass}
                itemDragClass={itemDragClass}
                sectionControlClass={sectionControlClass}
                sectionSurfaceStyle={sectionSurfaceStyle}
                itemSurfaceStyle={itemSurfaceStyle}
                touchHandleStyle={touchHandleStyle}
                enableNativeHtmlDrag={enableNativeHtmlDrag}
                isReadOnly={isReadOnly}
                showTouchDragHandles={showTouchDragHandles}
                isTimelineBlueTemplate={isTimelineBlueTemplate}
                draggedItemKey={draggedItemKey}
                draggedSectionId={draggedSectionId}
                includeOverflowState={includeOverflowState}
                getTemplateSectionWrapperStyle={getTemplateSectionWrapperStyle}
                getSectionSurfaceClass={getSectionSurfaceClass}
                getItemSurfaceClass={getItemSurfaceClass}
                getItemControlClass={getItemControlClass}
                getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
                getItemPolishHighlightStyle={getItemPolishHighlightStyle}
                renderOverflowMarker={renderOverflowMarker}
                renderSectionHeading={renderSectionHeading}
                handleNativeSectionDragStart={handleNativeSectionDragStart}
                handleNativeItemDragStart={handleNativeItemDragStart}
                handleNativeDragEnd={handleNativeDragEnd}
                handleSectionControlTouchStart={handleSectionControlTouchStart}
                handleItemControlTouchStart={handleItemControlTouchStart}
                handleItemCardTouchStart={handleItemCardTouchStart}
                stopTouchStartPropagation={stopTouchStartPropagation}
                setActiveMobileItemControlId={setActiveMobileItemControlId}
                onSectionDrop={onSectionDrop}
                onItemDragHover={onItemDragHover}
                onItemDrop={onItemDrop}
                onNavigateTab={onNavigateTab}
            />
        );
    };

    const renderCertificationSection = (variant: 'split' | 'page', includeOverflowState: boolean) => {
        const visibleCerts = sortedCertifications.filter((cert) => selectedCertIds.has(cert.id));

        return (
            <CertificationSection
                items={visibleCerts}
                variant={variant}
                sectionSpacingClass={sectionSpacingClass}
                listSpacingClass={listSpacingClass}
                sectionDragClass={sectionDragClass}
                itemDragClass={itemDragClass}
                sectionControlClass={sectionControlClass}
                sectionSurfaceStyle={sectionSurfaceStyle}
                itemSurfaceStyle={itemSurfaceStyle}
                touchHandleStyle={touchHandleStyle}
                enableNativeHtmlDrag={enableNativeHtmlDrag}
                isReadOnly={isReadOnly}
                showTouchDragHandles={showTouchDragHandles}
                isTimelineBlueTemplate={isTimelineBlueTemplate}
                draggedItemKey={draggedItemKey}
                draggedSectionId={draggedSectionId}
                includeOverflowState={includeOverflowState}
                getTemplateSectionWrapperStyle={getTemplateSectionWrapperStyle}
                getSectionSurfaceClass={getSectionSurfaceClass}
                getItemSurfaceClass={getItemSurfaceClass}
                getItemControlClass={getItemControlClass}
                getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
                getItemPolishHighlightStyle={getItemPolishHighlightStyle}
                renderOverflowMarker={renderOverflowMarker}
                renderSectionHeading={renderSectionHeading}
                handleNativeSectionDragStart={handleNativeSectionDragStart}
                handleNativeItemDragStart={handleNativeItemDragStart}
                handleNativeDragEnd={handleNativeDragEnd}
                handleSectionControlTouchStart={handleSectionControlTouchStart}
                handleItemControlTouchStart={handleItemControlTouchStart}
                handleItemCardTouchStart={handleItemCardTouchStart}
                stopTouchStartPropagation={stopTouchStartPropagation}
                setActiveMobileItemControlId={setActiveMobileItemControlId}
                onSectionDrop={onSectionDrop}
                onItemDragHover={onItemDragHover}
                onItemDrop={onItemDrop}
                onEditCertification={onEditCertification}
            />
        );
    };

    const renderSkillSection = (includeOverflowState: boolean) => (
        <SkillSection
            groups={selectedSkillGroups}
            sectionSpacingClass={sectionSpacingClass}
            sectionDragClass={sectionDragClass}
            itemDragClass={itemDragClass}
            sectionControlClass={sectionControlClass}
            sectionSurfaceStyle={sectionSurfaceStyle}
            itemSurfaceStyle={itemSurfaceStyle}
            touchHandleStyle={touchHandleStyle}
            enableNativeHtmlDrag={enableNativeHtmlDrag}
            isReadOnly={isReadOnly}
            showTouchDragHandles={showTouchDragHandles}
            isTimelineBlueTemplate={isTimelineBlueTemplate}
            draggedItemKey={draggedItemKey}
            draggedSectionId={draggedSectionId}
            includeOverflowState={includeOverflowState}
            getTemplateSectionWrapperStyle={getTemplateSectionWrapperStyle}
            getSectionSurfaceClass={getSectionSurfaceClass}
            getItemSurfaceClass={getItemSurfaceClass}
            getItemControlClass={getItemControlClass}
            getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
            getItemPolishHighlightStyle={getItemPolishHighlightStyle}
            renderOverflowMarker={renderOverflowMarker}
            renderSectionHeading={renderSectionHeading}
            renderSkillGroupLine={renderSkillGroupLine}
            handleNativeSectionDragStart={handleNativeSectionDragStart}
            handleNativeItemDragStart={handleNativeItemDragStart}
            handleNativeDragEnd={handleNativeDragEnd}
            handleSectionControlTouchStart={handleSectionControlTouchStart}
            handleItemControlTouchStart={handleItemControlTouchStart}
            handleItemCardTouchStart={handleItemCardTouchStart}
            stopTouchStartPropagation={stopTouchStartPropagation}
            setActiveMobileItemControlId={setActiveMobileItemControlId}
            onSectionDrop={onSectionDrop}
            onItemDragHover={onItemDragHover}
            onItemDrop={onItemDrop}
            onEditSkill={onEditSkill}
        />
    );

    const renderHeaderBlock = () => (
        <HeaderBlock
            activeTemplate={activeTemplate}
            profile={profile}
            contactItems={contactItems}
            resumeDisplayTitle={resumeDisplayTitle}
            sectionSpacingClass={sectionSpacingClass}
            headerStyle={headerStyle}
            isOpenSourceClassicTemplate={isOpenSourceClassicTemplate}
            isTimelineBlueTemplate={isTimelineBlueTemplate}
            isPhotoCardTemplate={isPhotoCardTemplate}
            isPhotoSidebarTemplate={isPhotoSidebarTemplate}
            getSectionOverflowHighlightStyle={getSectionOverflowHighlightStyle}
            renderOverflowMarker={renderOverflowMarker}
            renderAvatarFrame={renderAvatarFrame}
        />
    );

    const renderSectionById = (sectionId: string) => {
        if (sectionId === 'summary') {
            return renderSummarySection();
        }

        if (sectionId === 'work') {
            return renderExperienceSection('work', '工作经历', selectedWorkItems);
        }

        if (sectionId === 'project') {
            return renderExperienceSection('project', '项目经历', selectedProjectItems);
        }

        if (sectionId === 'education') {
            return renderEducationSection('split', false);
        }

        if (sectionId === 'certifications') {
            return renderCertificationSection('split', false);
        }

        if (sectionId === 'skills') {
            return renderSkillSection(false);
        }

        return null;
    };

    const renderOrderedSections = (sectionIds: string[]) => sectionIds.map((sectionId) => (
        <React.Fragment key={sectionId}>
            {renderSectionById(sectionId)}
        </React.Fragment>
    ));

    return (
        <main
            ref={previewScrollRef}
            className={isDashboardThumbnailPreview
                ? 'relative flex h-full w-full justify-center overflow-hidden bg-transparent p-0'
                : `bg-gray-100 dark:bg-gray-900/50 overflow-x-hidden relative flex justify-center p-3 scroll-smooth md:p-8 ${
                    usePageScrollOnMobile || isDashboardModalPreview ? 'overflow-visible' : 'flex-1 overflow-y-auto'
                }`
            }
            style={{
                touchAction: isDragging ? 'none' : 'pan-y',
                overscrollBehaviorY: isDashboardThumbnailPreview
                    ? 'contain'
                    : isDragging
                    ? 'none'
                    : (usePageScrollOnMobile || isDashboardModalPreview ? undefined : 'contain'),
                WebkitOverflowScrolling: isDashboardThumbnailPreview || usePageScrollOnMobile || isDashboardModalPreview ? undefined : 'touch',
            }}
        >
            <div
                ref={isScaledEditorPreview ? previewViewportRef : null}
                className={isDashboardThumbnailPreview ? 'flex h-full w-full justify-center overflow-hidden' : 'flex w-full justify-center'}
            >
                <div
                    className={isScaledEditorPreview ? 'relative shrink-0' : 'relative'}
                    style={scaledPreviewWrapperStyle}
                >
                    <div
                        ref={previewRef}
                        className="a4-preview text-gray-900 relative"
                        data-rf-preview-scope={previewScope}
                        style={previewStyle}
                    >
                {shouldShowOverflowIndicators ? (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute z-[40]"
                        style={overflowGuideStyle}
                    />
                ) : null}
                {isSplitTemplate ? (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-[0.8fr_1.2fr] overflow-hidden rounded-[30px]"
                        style={splitTemplateBackgroundStyle}
                    >
                        <div style={splitSidebarColumnStyle} />
                        <div style={splitMainColumnStyle} />
                    </div>
                ) : null}
                {renderAccentTopDecoration()}
                <div
                    ref={previewContentRef}
                    className={previewContentLayoutClassName}
                    style={previewContentLayoutStyle}
                    onDragOver={
                        isReadOnly
                            ? undefined
                            : (event) => {
                                if (!draggedSectionId || draggedItemKey) {
                                    return;
                                }
                                event.preventDefault();
                                const container = event.currentTarget as HTMLElement;
                                const target = resolveDragTarget(
                                    container,
                                    event.clientY,
                                    DATA_SECTION_ID_ATTR,
                                    draggedSectionId,
                                    event.target
                                );
                                if (!target) {
                                    return;
                                }
                                onSectionDragHover(target.id, target.position);
                            }
                    }
                    onDrop={
                        isReadOnly
                            ? undefined
                            : (event) => {
                                event.preventDefault();
                                onSectionDrop(event);
                            }
                    }
                >
                    {isSplitTemplate ? (
                        <>
                            <div
                                className={`flex min-h-0 min-w-0 flex-col self-stretch px-6 pb-7 pt-6 ${isPhotoSidebarTemplate ? 'text-white [&_.text-gray-900]:!text-white [&_.text-gray-800]:!text-white/85 [&_.text-gray-700]:!text-white/75 [&_.text-gray-600]:!text-white/70 [&_.text-gray-500]:!text-white/60' : ''}`}
                            >
                                {renderHeaderBlock()}
                                {renderOrderedSections(splitColumnSectionIds.sidebar)}
                            </div>
                            <div
                                className="flex min-h-0 min-w-0 flex-col self-stretch px-7 pb-7 pt-6"
                            >
                                {renderOrderedSections(splitColumnSectionIds.main)}
                            </div>
                        </>
                    ) : (
                    <>
                    {renderHeaderBlock()}
                    {visibleSectionOrder.map((sectionId) => (
                        <React.Fragment key={sectionId}>
                            {(() => {
                        if (sectionId === 'summary') {
                            return renderSummarySection();
                        }

                        if (sectionId === 'work') {
                            return renderExperienceSection('work', '工作经历', selectedWorkItems);
                        }

                        if (sectionId === 'project') {
                            return renderExperienceSection('project', '项目经历', selectedProjectItems);
                        }

                        if (sectionId === 'education') {
                            return renderEducationSection('page', true);
                        }

                        if (sectionId === 'certifications') {
                            return renderCertificationSection('page', true);
                        }

                        if (sectionId === 'skills') {
                            return renderSkillSection(true);
                        }

                        return null;
                            })()}
                        </React.Fragment>
                    ))}
                    </>
                    )}
                </div>
                {touchDragPreview ? (
                    <div
                        ref={touchDragPreviewRef}
                        className="pointer-events-none absolute left-0 top-0 z-[60] overflow-visible rounded-[18px]"
                        style={{
                            width: `${touchDragPreview.width}px`,
                            height: `${touchDragPreview.height}px`,
                            transform: 'translate3d(-200vw, -200vh, 0) scale(1.03)',
                            transformOrigin: 'top left',
                            willChange: 'transform',
                            filter: 'drop-shadow(0 22px 40px rgba(15, 23, 42, 0.18))',
                        }}
                        dangerouslySetInnerHTML={{ __html: touchDragPreview.html }}
                    />
                ) : null}
                    </div>
                </div>
            </div>
            <style>{previewTypographyCss}</style>
        </main>
    );
};

export default ResumePreview;
