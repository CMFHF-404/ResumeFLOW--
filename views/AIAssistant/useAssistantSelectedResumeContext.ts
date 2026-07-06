import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantSelectedResume } from '../../services/aiService';
import {
  buildSelectedResumeForTurn,
  type AssistantResumeModuleSelection,
} from './resumeSelectionUtils';

export type AssistantResumeModuleOption = {
  id: string;
  label: string;
  displayLabel: string;
  kind: AssistantResumeModuleSelection['kind'];
  contextId?: string;
};

export type AssistantSelectedResumeContextRestore = {
  selectedResume: AssistantSelectedResume | null;
  selectedResumeModuleIds?: string[];
};

const buildResumeModuleOptions = (
  selectedResume: AssistantSelectedResume | null,
): AssistantResumeModuleOption[] => {
  if (!selectedResume?.snapshot) {
    return [];
  }
  const snap = selectedResume.snapshot;
  const modules: AssistantResumeModuleOption[] = [];

  if (Array.isArray(snap.educations)) {
    snap.educations.forEach((edu, idx) => {
      modules.push({
        id: `edu-${edu.id || idx}`,
        label: `教育经历: ${edu.school}${edu.major ? `·${edu.major}` : ''}`,
        displayLabel: edu.school || '教育经历',
        kind: 'education',
        contextId: edu.id,
      });
    });
  }

  if (Array.isArray(snap.experiences)) {
    snap.experiences.forEach((exp, idx) => {
      modules.push({
        id: `exp-${exp.id || idx}`,
        label: `经历: ${exp.org}${exp.title ? `·${exp.title}` : ''}`,
        displayLabel: exp.org || exp.title || '经历',
        kind: 'experience',
        contextId: exp.id,
      });
    });
  }

  if (Array.isArray(snap.certifications)) {
    snap.certifications.forEach((cert, idx) => {
      modules.push({
        id: `cert-${cert.id || idx}`,
        label: `证书: ${cert.name}`,
        displayLabel: cert.name || '证书资质',
        kind: 'certification',
        contextId: cert.id,
      });
    });
  }

  if (Array.isArray(snap.skills) && snap.skills.length > 0) {
    modules.push({
      id: 'skills-all',
      label: '掌握技能',
      displayLabel: '掌握技能',
      kind: 'skills',
    });
  }

  return modules;
};

export const useAssistantSelectedResumeContext = () => {
  const [selectedResume, setSelectedResume] = useState<AssistantSelectedResume | null>(null);
  const [selectedResumeModuleIds, setSelectedResumeModuleIds] = useState<string[]>([]);
  const selectedResumeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentSelectedResumeId = selectedResume?.resumeId ?? null;
    if (selectedResumeIdRef.current === currentSelectedResumeId) {
      return;
    }
    selectedResumeIdRef.current = currentSelectedResumeId;
    setSelectedResumeModuleIds([]);
  }, [selectedResume?.resumeId]);

  const resumeModules = useMemo(
    () => buildResumeModuleOptions(selectedResume),
    [selectedResume],
  );

  const selectedResumeModulesForTurn = useMemo(() => {
    if (selectedResumeModuleIds.length === 0) {
      return [];
    }
    const selectedIdSet = new Set(selectedResumeModuleIds);
    return resumeModules.filter((item) => selectedIdSet.has(item.id));
  }, [resumeModules, selectedResumeModuleIds]);

  const selectedResumeForTurn = useMemo(() => (
    buildSelectedResumeForTurn(selectedResume, selectedResumeModulesForTurn)
  ), [selectedResume, selectedResumeModulesForTurn]);

  const clearSelectedResume = useCallback(() => {
    setSelectedResume(null);
    setSelectedResumeModuleIds([]);
  }, []);

  const restoreSelectedResumeContext = useCallback((context: AssistantSelectedResumeContextRestore) => {
    const nextSelectedResume = context.selectedResume;
    selectedResumeIdRef.current = nextSelectedResume?.resumeId ?? null;
    setSelectedResume(nextSelectedResume);
    setSelectedResumeModuleIds(context.selectedResumeModuleIds ?? []);
  }, []);

  return {
    selectedResume,
    setSelectedResume,
    selectedResumeModuleIds,
    setSelectedResumeModuleIds,
    resumeModules,
    selectedResumeForTurn,
    clearSelectedResume,
    restoreSelectedResumeContext,
  };
};
