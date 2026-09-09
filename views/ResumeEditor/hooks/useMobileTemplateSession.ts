import { useEffect, useRef, useState } from 'react';
import type { ResumeTemplateId } from '../../../constants/resumeTemplates';
import { savePreferredResumeTemplateId, saveResumeTemplatePresets, type ResumeTemplatePresetMap } from '../../../services/resumeTemplateStorage';
import { applyTemplateDraft, selectTemplateAppearance, type TemplateAppearance, type TemplatePresetDraft } from '../mobileTemplateSession';
import { prepareMobileTemplateTransition, transitionMobileTemplateMode } from '../mobileTemplateTransition';

type Session = {
    owner: string;
    baseline: TemplateAppearance;
    appearance: TemplateAppearance;
    retainedAppearances: Partial<Record<ResumeTemplateId, TemplateAppearance>>;
    drafts: ResumeTemplatePresetMap;
};

export function useMobileTemplateSession({ owner, authUserKey, enabled, appearance, presets, ready, canCommit, onCommit, onPresetsSaved }: {
    owner: string;
    authUserKey: string | null;
    enabled: boolean;
    appearance: TemplateAppearance;
    presets: ResumeTemplatePresetMap;
    ready: boolean;
    canCommit: boolean;
    onCommit: (appearance: TemplateAppearance) => void;
    onPresetsSaved: (presets: ResumeTemplatePresetMap) => void;
}) {
    const [session, setSession] = useState<Session | null>(null);
    const [editingTemplateId, setEditingTemplateId] = useState<ResumeTemplateId | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const returnFocus = useRef<HTMLElement | null>(null);
    const latest = useRef({ owner, enabled, canCommit });
    latest.current = { owner, enabled, canCommit };
    const active = Boolean(enabled && session?.owner === owner);
    const activeSession = useRef<Session | null>(null);
    activeSession.current = active ? session : null;
    const current = active && session ? session.appearance : appearance;
    const effectivePresets = active && session ? { ...presets, ...session.drafts } : presets;

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (!active && returnFocus.current?.isConnected && returnFocus.current.getClientRects().length) {
            returnFocus.current.focus({ preventScroll: true });
            returnFocus.current = null;
        }
    }, [active]);

    useEffect(() => {
        setSession(null); setEditingTemplateId(null); setError('');
    }, [owner, enabled]);

    const cancel = () => {
        if (inFlight.current) return;
        transitionMobileTemplateMode(() => {
            if (activeSession.current !== session) return;
            setSession(null); setEditingTemplateId(null); setError('');
        });
    };
    const select = (templateId: ResumeTemplateId) => {
        if (!ready || inFlight.current) return;
        setSession(previous => {
            if (previous?.owner !== owner) return previous;
            // Retain the original appearance and explicit edits; ordinary previews
            // resolve from the baseline and latest presets on every selection.
            const next = previous.retainedAppearances[templateId]
                ?? selectTemplateAppearance(previous.baseline, templateId, { ...presets, ...previous.drafts });
            return {
                ...previous,
                appearance: next,
            };
        });
    };
    const stagePreset = async (preset: TemplatePresetDraft) => {
        if (!ready || inFlight.current) return;
        setSession(previous => {
            if (previous?.owner !== owner) return previous;
            const next = applyTemplateDraft(previous.appearance, preset);
            return {
                ...previous,
                appearance: next,
                retainedAppearances: { ...previous.retainedAppearances, [preset.templateId]: next },
                drafts: { ...previous.drafts, [preset.templateId]: { ...presets[preset.templateId], ...previous.drafts[preset.templateId], ...preset, updatedAt: new Date().toISOString() } },
            };
        });
        setEditingTemplateId(null);
    };
    const confirm = async () => {
        if (!active || !session || !ready || inFlight.current) return;
        if (!canCommit) { setError('当前简历暂时无法保存，请处理保存冲突后重试，或取消选择。'); return; }
        const isCurrent = () => mounted.current && activeSession.current === session
            && latest.current.owner === session.owner && latest.current.enabled && latest.current.canCommit;
        inFlight.current = true; setSaving(true); setError('');
        try {
            const drafts = Object.values(session.drafts).filter(preset => preset !== undefined);
            const saved = drafts.length ? await saveResumeTemplatePresets(drafts, authUserKey, isCurrent) : {};
            if (!isCurrent()) return;
            onPresetsSaved(saved);
            savePreferredResumeTemplateId(session.appearance.templateId, authUserKey);
            await transitionMobileTemplateMode(() => {
                if (!isCurrent()) return;
                onCommit(session.appearance);
                setSession(null); setEditingTemplateId(null);
            });
        } catch {
            if (mounted.current && activeSession.current === session) setError('确认失败，修改已保留，请重试。');
        } finally {
            inFlight.current = false;
            if (mounted.current) setSaving(false);
        }
    };
    return {
        prepareTransition: prepareMobileTemplateTransition,
        active, current, effectivePresets, editingTemplateId: active ? editingTemplateId : null, saving, error,
        open: () => {
            if (!enabled || inFlight.current) return;
            returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            transitionMobileTemplateMode(() => {
                if (!mounted.current || latest.current.owner !== owner || !latest.current.enabled) return;
                const baseline = { ...appearance, sectionOrder: [...appearance.sectionOrder], layout: { ...appearance.layout } };
                setSession({ owner, baseline, appearance: baseline, retainedAppearances: { [baseline.templateId]: baseline }, drafts: {} });
                setError('');
            });
        },
        cancel, select, stagePreset, confirm,
        customize: (id: ResumeTemplateId) => { if (ready && !inFlight.current) { select(id); setEditingTemplateId(id); } },
        closeCustomization: () => setEditingTemplateId(null),
    };
}
