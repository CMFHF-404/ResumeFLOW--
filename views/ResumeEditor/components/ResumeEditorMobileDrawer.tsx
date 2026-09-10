import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, ChevronDown, FileSearch, PanelsTopLeft, UserRound } from 'lucide-react';
import EditorSidebar, { type EditorSidebarProps } from './EditorSidebar';
import type { MobileWorkbenchPage } from '../hooks/useMobileEditorDrawer';

const PAGES = [
    { id: 'information', label: '个人信息', icon: UserRound },
    { id: 'analysis', label: '分析报告', icon: FileSearch },
    { id: 'assistant', label: 'AI 助手', icon: Bot },
] as const;

type ResumeEditorMobileDrawerProps = {
    isOpen: boolean;
    isVisible: boolean;
    hasOpened: boolean;
    page: MobileWorkbenchPage;
    suspended?: boolean;
    busy?: boolean;
    onOpen: (page?: MobileWorkbenchPage) => void;
    onClose: () => void;
    sidebarProps: Omit<EditorSidebarProps, 'layoutMode' | 'showJDPanel'>;
    analysis: React.ReactNode;
    assistant: React.ReactNode;
};

const ResumeEditorMobileDrawer: React.FC<ResumeEditorMobileDrawerProps> = ({
    isOpen, isVisible, hasOpened, page, suspended = false, busy = false, onOpen, onClose, sidebarProps, analysis, assistant,
}) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
    const active = isOpen && !suspended && !busy;
    useLayoutEffect(() => {
        // Browser bars also emit visualViewport events. Only an editor with
        // focus needs keyboard avoidance; report reading uses a stable height.
        if (!active) { setViewport(null); return; }
        if (!isVisible) return;
        const vv = window.visualViewport;
        const update = () => {
            const focused = document.activeElement;
            const editing = focused instanceof HTMLElement
                && dialogRef.current?.contains(focused)
                && focused.getClientRects().length > 0
                && !focused.closest('[inert]')
                && focused.matches('input:not([type="checkbox"]):not([type="radio"]):not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),[contenteditable="true"]');
            const next = editing && vv ? { top: vv.offsetTop, height: vv.height } : null;
            setViewport(previous => previous?.top === next?.top && previous?.height === next?.height ? previous : next);
        };
        update();
        vv?.addEventListener('resize', update);
        vv?.addEventListener('scroll', update);
        document.addEventListener('focusin', update);
        document.addEventListener('focusout', update);
        return () => {
            vv?.removeEventListener('resize', update);
            vv?.removeEventListener('scroll', update);
            document.removeEventListener('focusin', update);
            document.removeEventListener('focusout', update);
        };
    }, [active, isVisible]);
    useEffect(() => {
        if (!active || !isVisible) return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusAfterEnter = () => {
            // Do not focus a translated, off-screen control or steal focus
            // from an input the user has already tapped during the transition.
            if (!dialog.contains(document.activeElement)) {
                dialog.querySelector<HTMLElement>('[data-workbench-close]')?.focus({ preventScroll: true });
            }
        };
        const handleEnd = (event: TransitionEvent) => {
            if (event.target === dialog && event.propertyName === 'transform') focusAfterEnter();
        };
        dialog.addEventListener('transitionend', handleEnd);
        const timer = window.setTimeout(focusAfterEnter, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
        return () => { clearTimeout(timer); dialog.removeEventListener('transitionend', handleEnd); };
    }, [active, isVisible]);
    useEffect(() => {
        if (!active) return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const hasNestedOverlay = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],.fixed')).some(el => {
            if (el === dialog || el.contains(dialog) || !el.getClientRects().length || el.closest('[inert], [aria-hidden="true"]')) return false;
            if (getComputedStyle(el).pointerEvents === 'none') return false;
            return el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog' || Number(getComputedStyle(el).zIndex) > 70;
        });
        const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"],[contenteditable="true"]')).filter(el => el.getClientRects().length && !el.closest('[inert], [aria-hidden="true"]'));
        const keydown = (event: KeyboardEvent) => {
            // A nested picker/dialog owns its own Escape and focus cycle.
            if (event.defaultPrevented || hasNestedOverlay()) return;
            if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            if (event.key === 'Tab') {
                const elements = focusable();
                const first = elements[0]; const last = elements[elements.length - 1];
                if (!first) { event.preventDefault(); dialog.focus(); }
                else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
            }
        };
        const containFocus = (event: FocusEvent) => {
            if (!hasNestedOverlay() && event.target instanceof Node && !dialog.contains(event.target)) focusable()[0]?.focus({ preventScroll: true });
        };
        document.addEventListener('focusin', containFocus);
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            document.removeEventListener('focusin', containFocus);
            document.body.style.overflow = previousOverflow;
            const target = returnFocusRef.current;
            if (target?.isConnected && !target.closest('[inert]') && target.getClientRects().length) target.focus({ preventScroll: true });
        };
    }, [active, onClose]);
    return <>
        <div data-mobile-workbench-dock className="rf-workbench-dock-glass pointer-events-none absolute inset-x-0 bottom-0 z-20 rounded-t-[28px] md:hidden">
            <div className="pointer-events-auto rounded-t-[28px] border border-b-0 border-white/70 px-4 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-1 shadow-[0_-12px_36px_rgba(15,23,42,0.10)] dark:border-slate-700/60">
                <button type="button" disabled={busy} onClick={() => onOpen()} aria-haspopup="dialog" aria-expanded={active} className="mx-auto flex min-h-12 w-full max-w-sm flex-col items-center justify-center gap-2 rounded-2xl py-1 text-sm font-semibold text-slate-800 transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-50 dark:text-slate-100 dark:hover:bg-white/5">
                    <span aria-hidden="true" className="h-1 w-10 rounded-full bg-slate-400/45 dark:bg-slate-500/60" />
                    <span className="inline-flex items-center gap-2"><PanelsTopLeft className="h-4 w-4 text-primary" />工作台</span>
                </button>
            </div>
        </div>
        {hasOpened && createPortal(
            <div aria-hidden={!active || undefined} inert={!active ? true : undefined}
                style={{ visibility: active ? 'visible' : 'hidden', opacity: active ? 1 : 0 }}
                className="fixed inset-0 z-[70] md:hidden" data-mobile-workbench-overlay>
                <div aria-hidden="true" className={`absolute inset-0 bg-black/35 transition-opacity duration-200 motion-reduce:transition-none ${active && isVisible ? 'opacity-100' : 'opacity-0'}`} />
                <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mobile-workbench-title" tabIndex={-1}
                    style={{ top: `calc(${viewport?.top ?? 0}px + env(safe-area-inset-top, 0px) + 8px)`, height: `calc(${viewport ? `${viewport.height}px` : '100svh'} - env(safe-area-inset-top, 0px) - 8px)` }}
                    className={`absolute inset-x-0 flex min-h-0 flex-col overflow-hidden rounded-t-2xl border border-border-light bg-surface-light shadow-2xl transform-gpu transition-transform duration-200 motion-reduce:transition-none dark:border-border-dark dark:bg-surface-dark ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
                    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-light px-3 dark:border-border-dark">
                        <h2 id="mobile-workbench-title" className="text-sm font-semibold text-gray-900 dark:text-white">{PAGES.find(item => item.id === page)?.label}<span className="ml-2 text-xs font-normal text-gray-400">工作台</span></h2>
                        <button data-workbench-close type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs font-medium text-gray-500" aria-label="收起工作台">收起<ChevronDown className="h-4 w-4" /></button>
                    </header>
                    <div className="relative min-h-0 flex-1">
                        {PAGES.map(item => <div key={item.id} id={`workbench-${item.id}`} role="tabpanel" aria-labelledby={`workbench-tab-${item.id}`} hidden={page !== item.id} inert={page !== item.id ? true : undefined} className={`absolute inset-0 min-h-0 ${page === item.id ? 'rf-workbench-page-enter' : ''}`}>
                            {item.id === 'information' ? <EditorSidebar {...sidebarProps} layoutMode="drawer" showJDPanel={false} /> : item.id === 'analysis' ? analysis : assistant}
                        </div>)}
                    </div>
                    <nav role="tablist" aria-label="工作台功能" className="relative isolate grid shrink-0 grid-cols-3 border-t border-border-light bg-white px-2 pb-[env(safe-area-inset-bottom)] dark:border-border-dark dark:bg-surface-dark">
                        <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+4px)] top-1 -z-10">
                            <div className="h-full w-1/3 rounded-xl bg-primary/10 transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${PAGES.findIndex(item => item.id === page) * 100}%)` }} />
                        </div>
                        {PAGES.map(({ id, label, icon: Icon }) => <button key={id} id={`workbench-tab-${id}`} role="tab" aria-controls={`workbench-${id}`} aria-selected={page === id} type="button" onClick={() => onOpen(id)} className={`my-1 flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${page === id ? 'text-primary' : 'text-gray-500'}`}><Icon className="h-4 w-4" />{label}</button>)}
                    </nav>
                </div>
            </div>, document.body)}
    </>;
};
export default ResumeEditorMobileDrawer;
