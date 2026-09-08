import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ResumeScoreSuggestion } from '../../../../types/ai';
import { scoreModuleKey } from '../../../../utils/resumeScore.mjs';

type State = { suggestions: ResumeScoreSuggestion[]; selected: string[]; toggle: (ids: string[]) => void; locate: (key: string) => void; active: string | null };
const ScoreContext = createContext<State>({ suggestions: [], selected: [], toggle: () => {}, locate: () => {}, active: null });
export const useScoreAnnotations = () => useContext(ScoreContext);

export function ScoreAnnotationProvider({ suggestions, reportKey, onLocate, children }: { onLocate?: () => void; suggestions: ResumeScoreSuggestion[]; reportKey: string; children: React.ReactNode }) {
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: reportKey, ids: [] });
  const [active, setActive] = useState<string | null>(null);
  const selected = selection.key === reportKey ? selection.ids : [];
  useEffect(() => { setSelection({ key: reportKey, ids: [] }); setActive(null); }, [reportKey]);
  const state: State = { suggestions, selected, active,
    toggle: ids => setSelection(old => { const current = old.key === reportKey ? old.ids : []; return { key: reportKey,
      ids: ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])] }; }),
    locate: key => {
      setActive(key);
      onLocate?.();
      window.requestAnimationFrame(() => {
      const node = [...document.querySelectorAll<HTMLElement>('[data-score-module]')].find(n => n.dataset.scoreModule === key && n.getClientRects().length > 0);
      if (node) { node.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); node.focus({ preventScroll: true });
        const details = node.querySelector('details'); if (details) details.open = true; }
      });
    } };
  return <ScoreContext.Provider value={state}>{children}</ScoreContext.Provider>;
}

export function ModuleScoreNote({ moduleType, moduleId, readOnly }: { moduleType: string; moduleId: string; readOnly: boolean }) {
  const state = useScoreAnnotations();
  const key = `${moduleType}:${moduleId}`;
  const rows = state.suggestions.filter(row => scoreModuleKey(row) === key);
  if (readOnly || !rows.length) return null;
  return <aside data-score-module={key} data-html2canvas-ignore="true" data-export-ignore="true" tabIndex={-1}
    className={`absolute right-0 top-0 z-20 max-w-[85%] print:hidden ${state.active === key ? 'ring-2 ring-amber-400' : ''}`}>
    <details className="rounded-md border border-amber-200 bg-amber-50 text-[11px] text-amber-950 shadow-sm">
      <summary className="cursor-pointer px-2 py-1 font-semibold">可优化 · {rows.length} 项</summary>
      <div className="absolute right-0 z-30 mt-1 w-64 max-w-[75vw] space-y-2 rounded-lg border border-amber-200 bg-white p-3 text-slate-800 shadow-lg">
        {rows.map(row => <div key={row.suggestionId}><strong>{row.label}</strong><p>{row.problem}</p><p className="mt-1 text-emerald-700">{row.direction}</p></div>)}
      </div>
    </details>
  </aside>;
}
