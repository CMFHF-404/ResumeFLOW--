import type { ResumeEditorLayoutAdjustPanelProps } from '../components/ResumeEditorLayoutAdjustPanel';
import type { ResumeEditorMeasurePreviewProps } from '../components/ResumeEditorMeasurePreview';
import type { ResumePreviewProps } from '../components/ResumePreview';
import { supportsResumeTemplateThemeColorCustomization } from '../../../constants/resumeTemplates';

export type SharedResumePreviewProps = Pick<
    ResumePreviewProps,
    | 'templateId'
    | 'themeColorPresetId'
    | 'experienceListMarkerStyle'
    | 'skillTagSeparator'
    | 'profile'
    | 'listSpacingClass'
    | 'sectionOrder'
    | 'selectedWorkItems'
    | 'selectedProjectItems'
    | 'educations'
    | 'selectedEduIds'
    | 'sortedCertifications'
    | 'selectedCertIds'
    | 'selectedSkillGroups'
    | 'onNavigateTab'
    | 'resumeDisplayTitle'
>;

type UseResumeEditorPreviewWorkspacePropsOptions = {
    sharedPreviewProps: SharedResumePreviewProps;
    isLayoutAdjustToolbarOpen: ResumeEditorLayoutAdjustPanelProps['isOpen'];
    lineHeight: ResumeEditorLayoutAdjustPanelProps['lineHeight'];
    fontSize: ResumeEditorLayoutAdjustPanelProps['fontSize'];
    topPaddingPx: ResumeEditorLayoutAdjustPanelProps['topPaddingPx'];
    sectionSpacingKey: ResumeEditorLayoutAdjustPanelProps['sectionSpacingKey'];
    itemSpacingEm: ResumeEditorLayoutAdjustPanelProps['itemSpacingEm'];
    themeColorPresetId: ResumeEditorLayoutAdjustPanelProps['themeColorPresetId'];
    onLineHeightChange: ResumeEditorLayoutAdjustPanelProps['onLineHeightChange'];
    onFontSizeChange: ResumeEditorLayoutAdjustPanelProps['onFontSizeChange'];
    onTopPaddingChange: ResumeEditorLayoutAdjustPanelProps['onTopPaddingChange'];
    onSectionSpacingChange: ResumeEditorLayoutAdjustPanelProps['onSectionSpacingChange'];
    onItemSpacingChange: ResumeEditorLayoutAdjustPanelProps['onItemSpacingChange'];
    onThemeColorChange: ResumeEditorLayoutAdjustPanelProps['onThemeColorChange'];
    previewRef: ResumePreviewProps['previewRef'];
    previewContentRef: ResumePreviewProps['previewContentRef'];
    isPreviewOverflowing: NonNullable<ResumePreviewProps['showOverflowGuide']>;
    overflowingSectionIds: ResumePreviewProps['overflowHighlightSectionIds'];
    floatingPolishHighlightItemIds: ResumePreviewProps['polishHighlightItemIds'];
    isPreviewInteractionLocked: NonNullable<ResumePreviewProps['readOnly']>;
    listSpacingValue: ResumePreviewProps['listSpacingValue'];
    bulletSpacingValue: ResumePreviewProps['bulletSpacingValue'];
    sectionSpacingClass: ResumePreviewProps['sectionSpacingClass'];
    isDragging: ResumePreviewProps['isDragging'];
    draggedItemKey: ResumePreviewProps['draggedItemKey'];
    draggedSectionId: ResumePreviewProps['draggedSectionId'];
    onSectionDragStart: ResumePreviewProps['onSectionDragStart'];
    onSectionDragHover: ResumePreviewProps['onSectionDragHover'];
    onSectionDrop: ResumePreviewProps['onSectionDrop'];
    onTouchSectionDragStart: ResumePreviewProps['onTouchSectionDragStart'];
    onItemDragStart: ResumePreviewProps['onItemDragStart'];
    onItemDragHover: ResumePreviewProps['onItemDragHover'];
    onItemDrop: ResumePreviewProps['onItemDrop'];
    onTouchItemDragStart: ResumePreviewProps['onTouchItemDragStart'];
    onTouchDragEnd: ResumePreviewProps['onTouchDragEnd'];
    onTouchDragCancel: ResumePreviewProps['onTouchDragCancel'];
    onDragEnd: ResumePreviewProps['onDragEnd'];
    onEditExperience: ResumePreviewProps['onEditExperience'];
    onEditCertification: ResumePreviewProps['onEditCertification'];
    onEditSkill: ResumePreviewProps['onEditSkill'];
    measurePreviewRef: ResumeEditorMeasurePreviewProps['previewRef'];
    measurePreviewContentRef: ResumeEditorMeasurePreviewProps['previewContentRef'];
    measureLayout: Pick<ResumeEditorMeasurePreviewProps, 'lineHeight' | 'fontSize' | 'topPaddingPx'>;
    measureListSpacingValue: ResumeEditorMeasurePreviewProps['listSpacingValue'];
    measureBulletSpacingValue: ResumeEditorMeasurePreviewProps['bulletSpacingValue'];
    measureSectionSpacingClass: ResumeEditorMeasurePreviewProps['sectionSpacingClass'];
};

export const useResumeEditorPreviewWorkspaceProps = ({
    sharedPreviewProps,
    isLayoutAdjustToolbarOpen,
    lineHeight,
    fontSize,
    topPaddingPx,
    sectionSpacingKey,
    itemSpacingEm,
    themeColorPresetId,
    onLineHeightChange,
    onFontSizeChange,
    onTopPaddingChange,
    onSectionSpacingChange,
    onItemSpacingChange,
    onThemeColorChange,
    previewRef,
    previewContentRef,
    isPreviewOverflowing,
    overflowingSectionIds,
    floatingPolishHighlightItemIds,
    isPreviewInteractionLocked,
    listSpacingValue,
    bulletSpacingValue,
    sectionSpacingClass,
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
    onEditExperience,
    onEditCertification,
    onEditSkill,
    measurePreviewRef,
    measurePreviewContentRef,
    measureLayout,
    measureListSpacingValue,
    measureBulletSpacingValue,
    measureSectionSpacingClass,
}: UseResumeEditorPreviewWorkspacePropsOptions) => {
    const layoutAdjustProps: ResumeEditorLayoutAdjustPanelProps = {
        isOpen: isLayoutAdjustToolbarOpen,
        isThemeColorCustomizationEnabled: supportsResumeTemplateThemeColorCustomization(
            sharedPreviewProps.templateId
        ),
        lineHeight,
        fontSize,
        topPaddingPx,
        sectionSpacingKey,
        itemSpacingEm,
        themeColorPresetId,
        onLineHeightChange,
        onFontSizeChange,
        onTopPaddingChange,
        onSectionSpacingChange,
        onItemSpacingChange,
        onThemeColorChange,
    };

    const editorPreviewProps: ResumePreviewProps = {
        ...sharedPreviewProps,
        previewRef,
        previewContentRef,
        previewScope: 'editor',
        showOverflowGuide: isPreviewOverflowing,
        overflowHighlightSectionIds: overflowingSectionIds,
        polishHighlightItemIds: floatingPolishHighlightItemIds,
        readOnly: isPreviewInteractionLocked,
        lineHeight,
        fontSize,
        listSpacingValue,
        bulletSpacingValue,
        topPaddingPx,
        sectionSpacingClass,
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
        onEditExperience,
        onEditCertification,
        onEditSkill,
    };

    const measurePreviewProps: ResumeEditorMeasurePreviewProps = {
        ...sharedPreviewProps,
        previewRef: measurePreviewRef,
        previewContentRef: measurePreviewContentRef,
        lineHeight: measureLayout.lineHeight,
        fontSize: measureLayout.fontSize,
        listSpacingValue: measureListSpacingValue,
        bulletSpacingValue: measureBulletSpacingValue,
        topPaddingPx: measureLayout.topPaddingPx,
        sectionSpacingClass: measureSectionSpacingClass,
    };

    return {
        layoutAdjustProps,
        editorPreviewProps,
        measurePreviewProps,
    };
};
