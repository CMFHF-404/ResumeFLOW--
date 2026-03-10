const AUTH_LOGIN_EVENT = 'app:auth-login-required';

const getDefaultRedirectUri = () => {
  return import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href;
};

export const dispatchLoginRequired = (reason: string, redirectUri?: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(AUTH_LOGIN_EVENT, {
      detail: {
        reason,
        redirectUri: redirectUri || getDefaultRedirectUri(),
      },
    })
  );
};

export const subscribeLoginRequired = (
  handler: (payload: { reason?: string; redirectUri?: string }) => void
) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<{ reason?: string; redirectUri?: string }>;
    handler(customEvent.detail || {});
  };

  window.addEventListener(AUTH_LOGIN_EVENT, listener as EventListener);

  return () => {
    window.removeEventListener(AUTH_LOGIN_EVENT, listener as EventListener);
  };
};

