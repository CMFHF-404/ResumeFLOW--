import React from 'react';
import {
  ArrowLeft,
  Check,
  GripVertical,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  DEFAULT_RESUME_TEMPLATE_ID,
  RESUME_TEMPLATE_DEFINITIONS,
  RESUME_THEME_COLOR_PRESETS,
  resolveDefaultResumeThemeColorPresetId,
  resolveResumeThemeColor,
  resolveResumeTemplate,
  type ResumeThemeColorPresetId,
  type ResumeTemplateId,
} from '../../../constants/resumeTemplates';
import type { ResumeExperienceListMarkerStyle } from '../../../types/resume';
import {
  DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
  DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
  normalizeResumeExperienceListMarkerStyle,
  normalizeResumeSkillTagSeparator,
} from '../../../utils/resumeCustomization';
import type { ResumeTemplatePresetMap } from '../../resumeTemplateStorage';
import { DEFAULT_SECTION_ORDER, RESUME_SECTION_IDS } from '../constants';

type TemplateSelectorModalProps = {
  isOpen: boolean;
  selectedTemplateId: ResumeTemplateId;
  themeColorPresetId: ResumeThemeColorPresetId;
  sectionOrder: string[];
  experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
  skillTagSeparator: string;
  templatePresetMap: ResumeTemplatePresetMap;
  isPresetMapReady: boolean;
  isPresetSyncFallbackAvailable: boolean;
  onClose: () => void;
  onUseLocalPresetFallback: () => void;
  onSelectTemplate: (id: ResumeTemplateId) => void;
  onSaveTemplatePreset: (preset: {
    templateId: ResumeTemplateId;
    sectionOrder: string[];
    themeColorPresetId: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
  }) => Promise<void>;
};

const EXPERIENCE_LIST_MARKER_STYLE_OPTIONS: Array<{
  value: ResumeExperienceListMarkerStyle;
  label: string;
  hint: string;
}> = [
  { value: 'unordered', label: '无序', hint: '使用圆点项目符号' },
  { value: 'ordered', label: '有序', hint: '按 1. 2. 3. 展示' },
  { value: 'none', label: '无', hint: '仅保留纯文本分段' },
];

const TEMPLATE_SECTION_META: Record<string, { label: string; hint: string }> = {
  summary: { label: '个人评价', hint: '简历开场和优势概述' },
  education: { label: '教育背景', hint: '学历、专业和在校信息' },
  work: { label: '工作经历', hint: '正式工作与实习经验' },
  project: { label: '项目经历', hint: '独立项目或专项案例' },
  certifications: { label: '证书资质', hint: '证书、资格与补充背书' },
  skills: { label: '技能清单', hint: '技能分组与工具能力' },
};

const normalizeSectionOrder = (sectionOrder?: string[]) => {
  const filtered = (sectionOrder || []).filter((sectionId) => RESUME_SECTION_IDS.has(sectionId));
  const unique: string[] = [];
  filtered.forEach((sectionId) => {
    if (!unique.includes(sectionId)) {
      unique.push(sectionId);
    }
  });
  if (!unique.includes('summary')) {
    unique.unshift('summary');
  }
  DEFAULT_SECTION_ORDER.forEach((sectionId) => {
    if (!unique.includes(sectionId)) {
      unique.push(sectionId);
    }
  });
  return unique.length ? unique : [...DEFAULT_SECTION_ORDER];
};

const reorderSectionOrder = (
  sectionOrder: string[],
  draggedSectionId: string,
  targetSectionId: string,
  placement: 'before' | 'after'
) => {
  if (draggedSectionId === targetSectionId) {
    return sectionOrder;
  }
  const nextOrder = [...sectionOrder];
  const draggedIndex = nextOrder.indexOf(draggedSectionId);
  const targetIndex = nextOrder.indexOf(targetSectionId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return sectionOrder;
  }
  nextOrder.splice(draggedIndex, 1);
  const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  nextOrder.splice(insertIndex, 0, draggedSectionId);
  return nextOrder;
};

const MOBILE_LONG_PRESS_DURATION_MS = 260;
const TOUCH_DRAG_CANCEL_DISTANCE_PX = 10;

const TemplateThumbnail: React.FC<{
  templateId: ResumeTemplateId;
  themeColorPresetId?: string;
}> = ({ templateId, themeColorPresetId }) => {
  const resolvedPresetId = (themeColorPresetId && RESUME_THEME_COLOR_PRESETS.some((item) => item.id === themeColorPresetId))
    ? (themeColorPresetId as ResumeThemeColorPresetId)
    : resolveDefaultResumeThemeColorPresetId(templateId);
  const theme = resolveResumeThemeColor(templateId, resolvedPresetId);
  const template = resolveResumeTemplate(templateId);

  if (template.layoutKind === 'classic') {
    const isModernAvatar = templateId === 'modern-slate-avatar';
    return (
      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="mb-2 h-1.5 w-20 rounded-full" style={{ backgroundColor: theme.accentColor }} />
            <div className="mb-1 h-2.5 w-16 rounded bg-gray-900/80" />
            <div className="mb-3 h-1 w-28 rounded bg-gray-200" />
          </div>
          {isModernAvatar && (
            <div className="flex h-10 w-7 items-center justify-center rounded border border-gray-200 bg-gray-50">
              <div className="h-full w-full bg-gray-100" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((item) => (
            <div key={item}>
              <div className="mb-1 flex items-center gap-1.5">
                {isModernAvatar && <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />}
                <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: theme.accentColor, opacity: isModernAvatar ? 0.7 : 1 }} />
              </div>
              <div className="h-1 w-full rounded bg-gray-200" />
              <div className="mt-1 h-1 w-4/5 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (template.layoutKind === 'minimal') {
    return (
      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
        <div className="mb-2 flex justify-center">
          <div className="h-2.5 w-20 rounded bg-gray-900/80" />
        </div>
        <div className="mb-3 flex justify-center">
          <div className="h-1 w-16 rounded-full" style={{ backgroundColor: theme.accentBorder }} />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item}>
              <div className="mb-1 h-1.5 w-10 rounded-full bg-gray-300" />
              <div className="h-1.5 w-full rounded bg-gray-200" />
              <div className="mt-1 h-1.5 w-3/4 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (template.layoutKind === 'accent') {
    return (
      <div className="relative h-full overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
        <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ backgroundColor: theme.accentColor }} />
        <div className="p-3 pt-4">
          <div className="mb-3">
            <div className="mb-1.5 flex items-center">
              <div className="mr-1.5 h-2.5 w-1 rounded-[1px]" style={{ backgroundColor: theme.accentColor }} />
              <div className="h-2.5 w-16 rounded bg-gray-900/80" />
            </div>
            <div className="flex items-center gap-1.5 pl-2.5">
              <div className="h-1 w-12 rounded bg-gray-300/80" />
              <div className="h-1.5 w-[1px] bg-gray-300/50" />
              <div className="h-1 w-14 rounded bg-gray-300/80" />
            </div>
          </div>
          <div className="space-y-2.5">
            {[0, 1, 2].map((item) => (
              <div key={item}>
                <div className="mb-1.5 flex items-stretch">
                  <div className="w-[3px] shrink-0 rounded-l-[1px]" style={{ backgroundColor: theme.accentColor }} />
                  <div
                    className="flex flex-1 items-center px-1.5 py-0.5"
                    style={{ background: `linear-gradient(to right, ${theme.accentSoftBg}, transparent)` }}
                  >
                    <div className="h-1.5 w-12 rounded opacity-70" style={{ backgroundColor: theme.accentColor }} />
                  </div>
                </div>
                <div className="space-y-1.5 pl-[4.5px]">
                  <div className="h-1.5 w-full rounded bg-gray-200 dark:bg-gray-800" />
                  <div className="h-1.5 w-5/6 rounded bg-gray-200 dark:bg-gray-800" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (template.layoutKind === 'avatar') {
    return (
      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 h-2.5 w-16 rounded bg-gray-900/80" />
            <div className="h-1.5 w-full rounded bg-gray-200" />
          </div>
          <div className="h-10 w-7 rounded-md border border-gray-300 bg-gray-100" />
        </div>
        <div className="mb-3 h-1 rounded-full" style={{ backgroundColor: theme.accentColor }} />
        <div className="space-y-2">
          {[0, 1].map((item) => (
            <div key={item}>
              <div className="mb-1 h-1.5 w-12 rounded-full" style={{ backgroundColor: theme.accentColor }} />
              <div className="h-1.5 w-full rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
      <div className="grid h-full grid-cols-[0.7fr_1.3fr]">
        <div className="p-3" style={{ backgroundColor: theme.accentSoftBg }}>
          <div className="mb-2 h-10 w-7 rounded-md border border-white/70 bg-white/80" />
          <div className="mb-1 h-1.5 w-10 rounded-full" style={{ backgroundColor: theme.accentColor }} />
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded bg-white/80" />
            <div className="h-1.5 w-4/5 rounded bg-white/80" />
            <div className="h-1.5 w-3/5 rounded bg-white/80" />
          </div>
        </div>
        <div className="p-3">
          <div className="mb-2 h-2.5 w-[4.5rem] rounded bg-gray-900/80" />
          {[0, 1, 2].map((item) => (
            <div key={item} className="mb-2">
              <div className="mb-1 h-1.5 w-11 rounded-full" style={{ backgroundColor: theme.accentColor }} />
              <div className="h-1.5 w-full rounded bg-gray-200" />
              <div className="mt-1 h-1.5 w-3/4 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const TemplateSelectorModal: React.FC<TemplateSelectorModalProps> = ({
  isOpen,
  selectedTemplateId,
  themeColorPresetId,
  sectionOrder,
  experienceListMarkerStyle,
  skillTagSeparator,
  templatePresetMap,
  isPresetMapReady,
  isPresetSyncFallbackAvailable,
  onClose,
  onUseLocalPresetFallback,
  onSelectTemplate,
  onSaveTemplatePreset,
}) => {
  const [editingTemplateId, setEditingTemplateId] = React.useState<ResumeTemplateId | null>(null);
  const [editingSectionOrder, setEditingSectionOrder] = React.useState<string[]>(() => [...DEFAULT_SECTION_ORDER]);
  const [editingThemeColorPresetId, setEditingThemeColorPresetId] = React.useState<ResumeThemeColorPresetId>(
    resolveDefaultResumeThemeColorPresetId(DEFAULT_RESUME_TEMPLATE_ID)
  );
  const [editingExperienceListMarkerStyle, setEditingExperienceListMarkerStyle] =
    React.useState<ResumeExperienceListMarkerStyle>(DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE);
  const [editingSkillTagSeparator, setEditingSkillTagSeparator] = React.useState(DEFAULT_RESUME_SKILL_TAG_SEPARATOR);
  const [isSavingPreset, setIsSavingPreset] = React.useState(false);
  const [presetError, setPresetError] = React.useState('');
  const [draggingSectionId, setDraggingSectionId] = React.useState<string | null>(null);
  const touchLongPressTimerRef = React.useRef<number | null>(null);
  const touchDragStartPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const bodyScrollLockRef = React.useRef<{ scrollY: number; bodyStyle: string | null; htmlStyle: string | null } | null>(null);

  const openTemplatePresetEditor = React.useCallback((templateId: ResumeTemplateId) => {
    if (!isPresetMapReady) {
      return;
    }
    const preset = templatePresetMap[templateId];
    const draftSectionOrder = templateId === selectedTemplateId
      ? normalizeSectionOrder(sectionOrder)
      : normalizeSectionOrder(preset?.sectionOrder);
    const draftThemeColorPresetId = templateId === selectedTemplateId
      ? themeColorPresetId
      : (preset?.themeColorPresetId ?? resolveDefaultResumeThemeColorPresetId(templateId));
    const draftExperienceListMarkerStyle = templateId === selectedTemplateId
      ? experienceListMarkerStyle
      : normalizeResumeExperienceListMarkerStyle(preset?.experienceListMarkerStyle);
    const draftSkillTagSeparator = templateId === selectedTemplateId
      ? skillTagSeparator
      : normalizeResumeSkillTagSeparator(preset?.skillTagSeparator);
    setEditingTemplateId(templateId);
    setEditingSectionOrder(draftSectionOrder);
    setEditingThemeColorPresetId(draftThemeColorPresetId);
    setEditingExperienceListMarkerStyle(draftExperienceListMarkerStyle);
    setEditingSkillTagSeparator(draftSkillTagSeparator);
    setPresetError('');
  }, [
    experienceListMarkerStyle,
    isPresetMapReady,
    sectionOrder,
    selectedTemplateId,
    skillTagSeparator,
    templatePresetMap,
    themeColorPresetId,
  ]);

  const closeTemplatePresetEditor = React.useCallback(() => {
    if (isSavingPreset) {
      return;
    }
    setEditingTemplateId(null);
    setPresetError('');
    setDraggingSectionId(null);
  }, [isSavingPreset]);

  const clearTouchLongPressTimer = React.useCallback(() => {
    if (touchLongPressTimerRef.current !== null) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
  }, []);

  const reorderByPointerPosition = React.useCallback((clientX: number, clientY: number) => {
    setEditingSectionOrder((prev) => {
      if (!draggingSectionId) {
        return prev;
      }
      const targetElement = document.elementFromPoint(clientX, clientY)?.closest('[data-section-id]');
      if (!(targetElement instanceof HTMLElement)) {
        return prev;
      }
      const targetSectionId = targetElement.dataset.sectionId;
      if (!targetSectionId || targetSectionId === draggingSectionId) {
        return prev;
      }
      const targetRect = targetElement.getBoundingClientRect();
      const placement = clientY < targetRect.top + targetRect.height / 2 ? 'before' : 'after';
      return reorderSectionOrder(prev, draggingSectionId, targetSectionId, placement);
    });
  }, [draggingSectionId]);

  const finishDrag = React.useCallback(() => {
    clearTouchLongPressTimer();
    touchDragStartPointRef.current = null;
    setDraggingSectionId(null);
  }, [clearTouchLongPressTimer]);

  const handleHandleDragStart = React.useCallback((event: React.DragEvent, sectionId: string) => {
    setDraggingSectionId(sectionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sectionId);
  }, []);

  const handleSectionDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingSectionId) {
      return;
    }
    event.preventDefault();
    reorderByPointerPosition(event.clientX, event.clientY);
  }, [draggingSectionId, reorderByPointerPosition]);

  const handleSectionTouchStart = React.useCallback((event: React.TouchEvent<HTMLDivElement>, sectionId: string) => {
    if (event.touches.length !== 1) {
      return;
    }
    clearTouchLongPressTimer();
    if (typeof window !== 'undefined') {
      window.getSelection?.()?.removeAllRanges();
    }
    const touch = event.touches[0];
    touchDragStartPointRef.current = { x: touch.clientX, y: touch.clientY };
    touchLongPressTimerRef.current = window.setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.getSelection?.()?.removeAllRanges();
      }
      setDraggingSectionId(sectionId);
    }, MOBILE_LONG_PRESS_DURATION_MS);
  }, [clearTouchLongPressTimer]);

  const handleSectionTouchMove = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    const startPoint = touchDragStartPointRef.current;
    if (!draggingSectionId && startPoint) {
      const distance = Math.hypot(touch.clientX - startPoint.x, touch.clientY - startPoint.y);
      if (distance > TOUCH_DRAG_CANCEL_DISTANCE_PX) {
        clearTouchLongPressTimer();
      }
      return;
    }
    if (!draggingSectionId) {
      return;
    }
    event.preventDefault();
    reorderByPointerPosition(touch.clientX, touch.clientY);
  }, [clearTouchLongPressTimer, draggingSectionId, reorderByPointerPosition]);

  const handleSavePreset = React.useCallback(async () => {
    if (!editingTemplateId || isSavingPreset) {
      return;
    }
    setIsSavingPreset(true);
    setPresetError('');
    try {
      await onSaveTemplatePreset({
        templateId: editingTemplateId,
        sectionOrder: editingSectionOrder,
        themeColorPresetId: editingThemeColorPresetId,
        experienceListMarkerStyle: editingExperienceListMarkerStyle,
        skillTagSeparator: editingSkillTagSeparator,
      });
      setEditingTemplateId(null);
    } catch {
      setPresetError('保存失败，请稍后重试。');
    } finally {
      setIsSavingPreset(false);
    }
  }, [
    editingSectionOrder,
    editingExperienceListMarkerStyle,
    editingTemplateId,
    editingThemeColorPresetId,
    editingSkillTagSeparator,
    isSavingPreset,
    onSaveTemplatePreset,
  ]);

  const handleModalClose = React.useCallback(() => {
    if (isSavingPreset) {
      return;
    }
    onClose();
  }, [isSavingPreset, onClose]);

  React.useEffect(() => {
    if (!isOpen) {
      setEditingTemplateId(null);
      setPresetError('');
      setDraggingSectionId(null);
      clearTouchLongPressTimer();
    }
  }, [clearTouchLongPressTimer, isOpen]);

  React.useEffect(() => {
    if (isPresetMapReady || isSavingPreset) {
      return;
    }
    setEditingTemplateId(null);
    setPresetError('');
    setDraggingSectionId(null);
    clearTouchLongPressTimer();
  }, [clearTouchLongPressTimer, isPresetMapReady, isSavingPreset]);

  React.useEffect(() => () => {
    clearTouchLongPressTimer();
  }, [clearTouchLongPressTimer]);

  React.useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    bodyScrollLockRef.current = {
      scrollY,
      bodyStyle: body.getAttribute('style'),
      htmlStyle: html.getAttribute('style'),
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';

    return () => {
      const snapshot = bodyScrollLockRef.current;
      if (snapshot?.bodyStyle === null) {
        body.removeAttribute('style');
      } else if (snapshot) {
        body.setAttribute('style', snapshot.bodyStyle);
      }
      if (snapshot?.htmlStyle === null) {
        html.removeAttribute('style');
      } else if (snapshot) {
        html.setAttribute('style', snapshot.htmlStyle);
      }
      if (snapshot) {
        window.scrollTo(0, snapshot.scrollY);
      }
      bodyScrollLockRef.current = null;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!draggingSectionId || typeof window === 'undefined') {
      return;
    }

    const handleWindowTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      event.preventDefault();
      reorderByPointerPosition(touch.clientX, touch.clientY);
    };

    const handleWindowTouchEnd = () => {
      finishDrag();
    };

    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('touchend', handleWindowTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleWindowTouchEnd, { passive: false });

    return () => {
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
      window.removeEventListener('touchcancel', handleWindowTouchEnd);
    };
  }, [draggingSectionId, finishDrag, reorderByPointerPosition]);

  if (!isOpen) {
    return null;
  }

  const editingTemplate = editingTemplateId ? resolveResumeTemplate(editingTemplateId) : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" onClick={handleModalClose}>
      <div
        className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        {editingTemplate ? (
          <>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={closeTemplatePresetEditor}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  aria-label="返回模板列表"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold text-gray-900 dark:text-white">{editingTemplate.name}模板自定义</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    保存后，后续选择该模板会默认使用这里的主题色和模块顺序。
                  </p>
                </div>
              </div>
              <button type="button" onClick={handleModalClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                  <div className="mb-3 h-40 overflow-hidden rounded-xl">
                    <TemplateThumbnail
                      templateId={editingTemplate.id}
                      themeColorPresetId={editingThemeColorPresetId}
                    />
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{editingTemplate.name}</div>
                  <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{editingTemplate.description}</div>
                </div>

                <div className="space-y-6">
                  <section>
                    <div className="mb-3">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">主题颜色</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">选择该模板默认使用的高亮色风格。</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {RESUME_THEME_COLOR_PRESETS.map((color) => {
                        const isActive = color.id === editingThemeColorPresetId;
                        return (
                          <button
                            key={color.id}
                            type="button"
                            onClick={() => setEditingThemeColorPresetId(color.id)}
                            className={`rounded-xl border px-3 py-3 text-left transition ${isActive ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/80'}`}
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <span
                                className="h-4 w-4 rounded-full border border-black/5"
                                style={{ backgroundColor: color.accentColor }}
                              />
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">{color.name}</span>
                            </div>
                            <div className="flex gap-1">
                              <span className="h-2 flex-1 rounded-full" style={{ backgroundColor: color.accentColor }} />
                              <span className="h-2 flex-1 rounded-full" style={{ backgroundColor: color.accentBorder }} />
                              <span className="h-2 flex-1 rounded-full border border-black/5" style={{ backgroundColor: color.accentSoftBg }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-950/70">
                        <div className="mb-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">段落样式</div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">控制经历内容中 Action 段落的排序符号。</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {EXPERIENCE_LIST_MARKER_STYLE_OPTIONS.map((option) => {
                            const isActive = option.value === editingExperienceListMarkerStyle;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setEditingExperienceListMarkerStyle(option.value)}
                                className={`rounded-xl border px-3 py-3 text-left transition ${
                                  isActive
                                    ? 'border-primary bg-primary/5 shadow-sm'
                                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800'
                                }`}
                              >
                                <div className="text-sm font-semibold text-gray-900 dark:text-white">{option.label}</div>
                                <div className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">{option.hint}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-950/70">
                        <div className="mb-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">技能样式</div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">自定义技能 TAG 之间的连接符号，默认使用逗号。</div>
                        </div>
                        <label className="block">
                          <span className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-300">TAG 连接符</span>
                          <input
                            type="text"
                            value={editingSkillTagSeparator}
                            onChange={(event) => setEditingSkillTagSeparator(event.target.value)}
                            placeholder={DEFAULT_RESUME_SKILL_TAG_SEPARATOR}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          />
                        </label>
                        <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-white/70 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
                          示例：React{normalizeResumeSkillTagSeparator(editingSkillTagSeparator)}TypeScript{normalizeResumeSkillTagSeparator(editingSkillTagSeparator)}Node.js
                        </div>
                      </div>
                    </div>
                  </section>

                  <section>
                    <div className="mb-3">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">模块排序</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">桌面端拖动左侧句柄排序，移动端长按卡片后拖动排序。</div>
                    </div>
                    <div className="space-y-2">
                      {editingSectionOrder.map((sectionId, index) => {
                        const meta = TEMPLATE_SECTION_META[sectionId] ?? { label: sectionId, hint: '' };
                        const isDragging = draggingSectionId === sectionId;
                        return (
                          <div
                            key={sectionId}
                            data-section-id={sectionId}
                            onDragOver={handleSectionDragOver}
                            onDrop={finishDrag}
                            onTouchStart={(event) => handleSectionTouchStart(event, sectionId)}
                            onTouchMove={handleSectionTouchMove}
                            onTouchEnd={finishDrag}
                            onTouchCancel={finishDrag}
                            className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${isDragging ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950'}`}
                            onContextMenu={(event) => event.preventDefault()}
                            style={{
                              userSelect: 'none',
                              WebkitUserSelect: 'none',
                              WebkitTouchCallout: 'none',
                              WebkitTapHighlightColor: 'transparent',
                              touchAction: draggingSectionId ? 'none' : 'pan-y',
                            }}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {index + 1}
                            </div>
                            <button
                              type="button"
                              draggable
                              onDragStart={(event) => handleHandleDragStart(event, sectionId)}
                              onDragEnd={finishDrag}
                              className="hidden h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition hover:bg-gray-50 active:cursor-grabbing md:inline-flex dark:border-gray-700 dark:hover:bg-gray-800"
                              aria-label={`拖动排序${meta.label}`}
                              title={`拖动排序${meta.label}`}
                            >
                              <GripVertical className="h-4 w-4" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-gray-900 dark:text-white">{meta.label}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{meta.hint}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>

              {presetError ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  {presetError}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                type="button"
                onClick={closeTemplatePresetEditor}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSavePreset()}
                disabled={isSavingPreset}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingPreset ? '保存中...' : '保存预设'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">选择简历模板</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  选择模板后会优先套用该模板的个人预设。
                </p>
              </div>
              <button type="button" onClick={handleModalClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {!isPresetMapReady ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <div>正在同步当前账号的模板预设，请稍候后再选择模板或进入自定义。</div>
                  {isPresetSyncFallbackAvailable ? (
                    <button
                      type="button"
                      onClick={onUseLocalPresetFallback}
                      className="mt-2 inline-flex rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-100 dark:hover:bg-amber-500/10"
                    >
                      继续使用本地预设
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {RESUME_TEMPLATE_DEFINITIONS.map((template) => {
                  const isSelected = template.id === selectedTemplateId;
                  const hasCustomPreset = Boolean(templatePresetMap[template.id]);
                  return (
                    <article
                      key={template.id}
                      className={`flex h-full flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${isSelected ? 'ring-2 ring-primary' : ''}`}
                    >
                      <div className="relative mb-3 h-44 overflow-hidden">
                        <TemplateThumbnail
                          templateId={template.id}
                          themeColorPresetId={
                            isSelected
                              ? themeColorPresetId
                              : templatePresetMap[template.id]?.themeColorPresetId
                          }
                        />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openTemplatePresetEditor(template.id);
                          }}
                          disabled={!isPresetMapReady}
                          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-white/80 bg-white/95 px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm transition hover:bg-white disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-200 dark:hover:bg-gray-900"
                          aria-label={`自定义${template.name}模板`}
                          title={`自定义${template.name}模板`}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          自定义
                        </button>
                      </div>

                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{template.name}</h3>
                        {hasCustomPreset ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                            已自定义
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 min-h-[38px] text-xs text-gray-500 dark:text-gray-400">{template.description}</p>
                      <button
                        type="button"
                        onClick={() => onSelectTemplate(template.id)}
                        disabled={!isPresetMapReady}
                        className={`mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-60 ${isSelected ? 'bg-primary text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                      >
                        {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                        {isSelected ? '已选中' : '选中此模板'}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TemplateSelectorModal;
