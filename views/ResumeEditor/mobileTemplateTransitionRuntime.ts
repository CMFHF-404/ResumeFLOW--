import { flushSync } from 'react-dom';

let running: ViewTransition | undefined;
let fallbackAnimation: Animation | undefined;

export async function prepareMobileTemplateTransition() {
    await Promise.all([import('./components/MobileTemplateToolbar'), import('./components/MobileTemplateStrip')]);
    return transitionMobileTemplateMode;
}

/** Capture both layouts without delaying preset requests or resume saves. */
export function transitionMobileTemplateMode(update: () => void) {
    running?.skipTransition();
    fallbackAnimation?.cancel();
    if (typeof document === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        update();
        return Promise.resolve();
    }
    if (typeof document.startViewTransition === 'function') {
        document.documentElement.setAttribute('data-mobile-template-transition', '');
        const transition = document.startViewTransition(() => flushSync(update));
        running = transition;
        void transition.finished.catch(() => undefined).finally(() => {
            if (running === transition) {
                running = undefined;
                document.documentElement.removeAttribute('data-mobile-template-transition');
            }
        });
        return transition.updateCallbackDone;
    }
    flushSync(update);
    fallbackAnimation = document.querySelector('.rf-editor-viewport')?.animate?.(
        [{ opacity: 0.65, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
}
