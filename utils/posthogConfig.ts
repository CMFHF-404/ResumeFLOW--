const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const DEFAULT_POSTHOG_ENABLED = true;
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_DEFAULTS_VERSION = '2025-05-24';

const resolveEnvString = (value: string | undefined): string => (value ?? '').trim();

type PosthogConfig = {
  apiKey: string;
  options: {
    api_host: string;
    defaults: string;
    capture_exceptions: boolean;
    debug: boolean;
  };
};

const resolveBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return fallback;
};

export const isPosthogEnabled = (): boolean => {
  const envEnabled = resolveBooleanEnv(
    import.meta.env.VITE_PUBLIC_POSTHOG_ENABLED,
    DEFAULT_POSTHOG_ENABLED
  );
  const hasKey = Boolean(resolveEnvString(import.meta.env.VITE_PUBLIC_POSTHOG_KEY));
  return envEnabled && hasKey;
};

export const buildPosthogConfig = (): PosthogConfig => ({
  apiKey: resolveEnvString(import.meta.env.VITE_PUBLIC_POSTHOG_KEY),
  options: {
    api_host: resolveEnvString(import.meta.env.VITE_PUBLIC_POSTHOG_HOST) || DEFAULT_POSTHOG_HOST,
    defaults: POSTHOG_DEFAULTS_VERSION,
    capture_exceptions: true,
    debug: import.meta.env.MODE === 'development',
  },
});
