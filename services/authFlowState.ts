export const USER_SIGN_OUT_SUPPRESSION_MS = 15_000;

const FORCE_REAUTH_REASONS = new Set(['unauthorized', 'unauthorized-write']);

let lastUserSignOutAt = 0;

export type LoginRequiredDecisionInput = {
    reason?: string;
    isAuthenticated: boolean;
    isLoading: boolean;
    isSigningIn: boolean;
    now?: number;
};

export const markUserSignOutStarted = (now = Date.now()) => {
    lastUserSignOutAt = now;
};

export const markUserSignInStarted = () => {
    lastUserSignOutAt = 0;
};

export const isForceReauthReason = (reason?: string): boolean => {
    return reason ? FORCE_REAUTH_REASONS.has(reason) : false;
};

export const shouldAutoSignInForLoginRequired = ({
    reason,
    isAuthenticated,
    isLoading,
    isSigningIn,
    now = Date.now(),
}: LoginRequiredDecisionInput): boolean => {
    if (isLoading || isSigningIn) {
        return false;
    }

    if (
        lastUserSignOutAt > 0
        && now - lastUserSignOutAt < USER_SIGN_OUT_SUPPRESSION_MS
    ) {
        return false;
    }

    if (reason === 'unauthorized' && !isAuthenticated) {
        return false;
    }

    if (isAuthenticated && !isForceReauthReason(reason)) {
        return false;
    }

    return true;
};
