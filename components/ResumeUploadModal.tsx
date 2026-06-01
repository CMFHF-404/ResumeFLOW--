import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ParsedPersonalInfo,
  ParsedPersonalInfoSelection,
} from '../services/parserService';
import { buildEmptyPersonalInfoSelection } from './ResumeUploadModal/parseUtils';
import {
  buildPersonalInfoSelection,
  countSelectedPersonalInfo,
} from './ResumeUploadModal/derivedData';

import { ModalFooter, ModalHeader, PreviewPanel, UploadPanel } from './ResumeUploadModal/PreviewPanels';
import {
  STAGE_PROGRESS,
  type ToastHandlers,
  useParsedCertifications,
  useParsedSkills,
  useResumeImport,
  useResumeItems,
  useResumeParsing,
} from './ResumeUploadModal/stateHooks';

interface ResumeUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (
    parsedPersonalInfo?: ParsedPersonalInfo,
    personalInfoSelection?: ParsedPersonalInfoSelection
  ) => Promise<void> | void;
  profileSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  toast: ToastHandlers;
}

const ResumeUploadModal: React.FC<ResumeUploadModalProps> = ({
  isOpen,
  onClose,
  onImported,
  profileSnapshot,
  toast,
}) => {
  const {
    items,
    selectedIds,
    selectedItems,
    applyParsedItems,
    resetSelection,
    toggleSelection,
    toggleSelectionBatch,
  } = useResumeItems();
  const {
    items: parsedCertifications,
    selectedIds: selectedCertificationIds,
    selectedItems: selectedCertifications,
    applyParsedCertifications,
    resetSelection: resetCertifications,
    toggleSelection: toggleCertification,
    toggleSelectAll: toggleAllCertifications,
  } = useParsedCertifications();
  const {
    groups: parsedSkillGroups,
    selectedIds: selectedSkillIds,
    selectedTags: selectedSkillTags,
    duplicateIds: duplicateSkillIds,
    applyParsedSkills,
    resetSelection: resetSkills,
    toggleSelection: toggleSkill,
    toggleSelectAll: toggleAllSkills,
  } = useParsedSkills();
  const [parsedPersonalInfo, setParsedPersonalInfo] = useState<ParsedPersonalInfo | undefined>(undefined);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [isCompactLandscape, setIsCompactLandscape] = useState(
    () => window.innerWidth < 960 && window.innerWidth > window.innerHeight
  );
  const [personalInfoSelection, setPersonalInfoSelection] = useState<ParsedPersonalInfoSelection>(
    buildEmptyPersonalInfoSelection()
  );
  const hasTouchedPersonalInfoSelectionRef = useRef(false);
  const applyParsedPersonalInfo = useCallback(
    (info?: ParsedPersonalInfo) => {
      setParsedPersonalInfo(info);
      hasTouchedPersonalInfoSelectionRef.current = false;
      setPersonalInfoSelection(buildPersonalInfoSelection(info, profileSnapshot));
    },
    [profileSnapshot]
  );
  const togglePersonalInfoSelection = useCallback(
    (field: keyof ParsedPersonalInfoSelection) => {
      hasTouchedPersonalInfoSelectionRef.current = true;
      setPersonalInfoSelection((prev) => ({ ...prev, [field]: !prev[field] }));
    },
    []
  );
  useEffect(() => {
    if (!parsedPersonalInfo || hasTouchedPersonalInfoSelectionRef.current) {
      return;
    }
    setPersonalInfoSelection(buildPersonalInfoSelection(parsedPersonalInfo, profileSnapshot));
  }, [parsedPersonalInfo, profileSnapshot]);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const landscapeQuery = window.matchMedia('(max-width: 959px) and (orientation: landscape)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    const handleLandscapeChange = (event: MediaQueryListEvent) => {
      setIsCompactLandscape(event.matches);
    };
    setIsMobile(mediaQuery.matches);
    setIsCompactLandscape(landscapeQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      landscapeQuery.addEventListener('change', handleLandscapeChange);
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
        landscapeQuery.removeEventListener('change', handleLandscapeChange);
      };
    }
    mediaQuery.addListener(handleChange);
    landscapeQuery.addListener(handleLandscapeChange);
    return () => {
      mediaQuery.removeListener(handleChange);
      landscapeQuery.removeListener(handleLandscapeChange);
    };
  }, []);
  const {
    file,
    stage,
    errorMessage,
    isDragging,
    thinkingNodes,
    enableThinking,
    setEnableThinking,
    setIsDragging,
    handleFileChange,
    handleDrop,
    resetParsing,
  } = useResumeParsing(
    applyParsedItems,
    applyParsedPersonalInfo,
    applyParsedCertifications,
    applyParsedSkills,
    toast
  );
  const { isImporting, handleImport } = useResumeImport(
    selectedItems,
    selectedCertifications,
    selectedSkillTags,
    personalInfoSelection,
    toast,
    () => onImported(parsedPersonalInfo, personalInfoSelection),
    onClose
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progress = STAGE_PROGRESS[stage];
  const selectedTotalCount =
    selectedItems.length
    + selectedCertifications.length
    + selectedSkillTags.length
    + countSelectedPersonalInfo(personalInfoSelection);
  const resetAll = useCallback(() => {
    resetParsing();
    resetSelection();
    resetCertifications();
    resetSkills();
    setParsedPersonalInfo(undefined);
    setPersonalInfoSelection(buildEmptyPersonalInfoSelection());
    hasTouchedPersonalInfoSelectionRef.current = false;
  }, [resetParsing, resetSelection, resetCertifications, resetSkills]);
  const handleResetToUpload = useCallback(() => {
    resetAll();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [resetAll]);
  const handleReupload = useCallback(() => {
    resetAll();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, [resetAll]);
  const handleFileChangeWithReset = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (nextFile) {
        resetAll();
      }
      handleFileChange(event);
    },
    [handleFileChange, resetAll]
  );
  const handleDropWithReset = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const nextFile = event.dataTransfer.files?.[0];
      if (nextFile) {
        resetAll();
      }
      handleDrop(event);
    },
    [handleDrop, resetAll]
  );
  useEffect(() => {
    if (!isOpen) {
      resetAll();
    }
  }, [isOpen, resetAll]);
  const isReady = stage === 'ready';
  const shouldShowSplitLayout = !isMobile || isCompactLandscape;
  const shouldShowMobilePreview = isMobile && !isCompactLandscape && isReady;
  const shouldShowFooter = shouldShowSplitLayout || isReady;
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center overflow-hidden bg-black/50 p-3 backdrop-blur-md sm:p-4">
      <div className={`relative flex w-full max-w-[min(1100px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-white/95 via-white/85 to-emerald-50/80 shadow-2xl dark:from-gray-900 dark:via-gray-900/95 dark:to-emerald-900/20 sm:max-h-[calc(100dvh-32px)] sm:max-w-[min(1100px,calc(100vw-48px))] ${shouldShowMobilePreview ? 'h-[calc(100dvh-24px)]' : 'max-h-[calc(100dvh-24px)]'}`}>
        <div className="absolute inset-x-0 -top-20 h-40 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative flex min-h-0 flex-1 flex-col p-4 sm:p-6">
          <ModalHeader
            onClose={onClose}
            actionLabel={shouldShowMobilePreview ? '重新上传' : undefined}
            onAction={shouldShowMobilePreview ? handleResetToUpload : undefined}
            hideDescription={shouldShowMobilePreview || isCompactLandscape}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {shouldShowSplitLayout ? (
              <div className="mt-4 grid min-h-0 flex-1 grid-cols-[minmax(220px,0.9fr)_minmax(0,1.6fr)] gap-4 lg:mt-6 lg:gap-6 lg:grid-cols-[1.1fr_1.9fr]">
                <div className="min-h-0 overflow-y-auto pr-1">
                  <UploadPanel
                    file={file}
                    stage={stage}
                    progress={progress}
                    errorMessage={errorMessage}
                    thinkingNodes={thinkingNodes}
                    enableThinking={enableThinking}
                    isDragging={isDragging}
                    inputRef={fileInputRef}
                    onFileChange={handleFileChangeWithReset}
                    onDrop={handleDropWithReset}
                    onDragState={setIsDragging}
                    onEnableThinkingChange={setEnableThinking}
                    onReupload={handleReupload}
                    modeCardPlacement="bottom"
                    showStatusCard={false}
                  />
                </div>
                <div className="min-h-0 overflow-hidden">
                  <PreviewPanel
                    personalInfo={parsedPersonalInfo}
                    personalInfoSelection={personalInfoSelection}
                    onTogglePersonalInfo={togglePersonalInfoSelection}
                    items={items}
                    selectedExperienceIds={selectedIds}
                    onToggleExperience={toggleSelection}
                    onToggleExperienceGroup={toggleSelectionBatch}
                    certifications={parsedCertifications}
                    selectedCertificationIds={selectedCertificationIds}
                    onToggleCertification={toggleCertification}
                    onToggleAllCertifications={toggleAllCertifications}
                    skillGroups={parsedSkillGroups}
                    selectedSkillIds={selectedSkillIds}
                    duplicateSkillIds={duplicateSkillIds}
                    onToggleSkill={toggleSkill}
                    onToggleAllSkills={toggleAllSkills}
                  />
                </div>
              </div>
            ) : (
              <div className={shouldShowMobilePreview ? 'mt-6 min-h-0 flex-1 overflow-hidden' : 'mt-6'}>
                {shouldShowMobilePreview ? (
                  <PreviewPanel
                    personalInfo={parsedPersonalInfo}
                    personalInfoSelection={personalInfoSelection}
                    onTogglePersonalInfo={togglePersonalInfoSelection}
                    items={items}
                    selectedExperienceIds={selectedIds}
                    onToggleExperience={toggleSelection}
                    onToggleExperienceGroup={toggleSelectionBatch}
                    certifications={parsedCertifications}
                    selectedCertificationIds={selectedCertificationIds}
                    onToggleCertification={toggleCertification}
                    onToggleAllCertifications={toggleAllCertifications}
                    skillGroups={parsedSkillGroups}
                    selectedSkillIds={selectedSkillIds}
                    duplicateSkillIds={duplicateSkillIds}
                    onToggleSkill={toggleSkill}
                    onToggleAllSkills={toggleAllSkills}
                  />
                ) : (
                  <UploadPanel
                    file={file}
                    stage={stage}
                    progress={progress}
                    errorMessage={errorMessage}
                    thinkingNodes={thinkingNodes}
                    enableThinking={enableThinking}
                    isDragging={isDragging}
                    inputRef={fileInputRef}
                    onFileChange={handleFileChangeWithReset}
                    onDrop={handleDropWithReset}
                    onDragState={setIsDragging}
                    onEnableThinkingChange={setEnableThinking}
                    onReupload={handleReupload}
                    showStatusCard={false}
                    showReupload={false}
                  />
                )}
              </div>
            )}
          </div>
          {shouldShowFooter ? (
            <div className="shrink-0">
              <ModalFooter
                selectedCount={selectedTotalCount}
                onClose={onClose}
                onImport={handleImport}
                isImporting={isImporting}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ResumeUploadModal;
