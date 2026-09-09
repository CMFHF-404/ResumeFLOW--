let transition: ((update: () => void) => void | Promise<void>) | undefined;

export async function prepareMobileTemplateTransition() {
    transition = await (await import('./mobileTemplateTransitionRuntime')).prepareMobileTemplateTransition();
}

export function transitionMobileTemplateMode(update: () => void) {
    return transition ? transition(update) : update();
}
