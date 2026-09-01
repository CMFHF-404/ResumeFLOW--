import { writeFileSync } from 'node:fs';

const REQUIRED_HTTPS_ORIGINS = [
  'VITE_LOGTO_ENDPOINT',
  'YIFUT_BASE_URL',
];

const MANIFEST_KEYS = [
  'VITE_API_BASE_URL',
  'VITE_FRONTEND_ORIGIN',
  ...REQUIRED_HTTPS_ORIGINS,
  'VITE_LOGTO_APP_ID',
  'VITE_LOGTO_REDIRECT_URI',
  'VITE_LOGTO_ACCOUNT_CENTER_URL',
];

export const requireExactHttpsOrigin = (name, value) => {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} must be an exact HTTPS origin`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an exact HTTPS origin`);
  }

  const hostnameLabels = parsed.hostname.split('.');
  if (
    parsed.protocol !== 'https:'
    || parsed.origin !== value
    || (parsed.port !== '' && Number(parsed.port) < 1)
    || !/^[A-Za-z0-9.-]+$/.test(parsed.hostname)
    || hostnameLabels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))
  ) {
    throw new Error(`${name} must be an exact HTTPS origin`);
  }
  return value;
};

export const requireProductionApiBaseUrl = (value) => {
  if (value === '/api') {
    return value;
  }
  throw new Error('VITE_API_BASE_URL must be exactly /api in production');
};

export const requireLogtoAppId = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('VITE_LOGTO_APP_ID must contain only letters, numbers, hyphens, or underscores');
  }
  return value;
};

export const requireLogtoRedirectUri = (value, frontendOrigin) => {
  const exactFrontendOrigin = requireExactHttpsOrigin('VITE_FRONTEND_ORIGIN', frontendOrigin);
  const requiredRedirectUri = `${exactFrontendOrigin}/callback`;
  if (value !== requiredRedirectUri) {
    throw new Error(`VITE_LOGTO_REDIRECT_URI must exactly equal ${requiredRedirectUri}`);
  }
  return value;
};

export const requireHttpsUrl = (name, value) => {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} must be an HTTPS URL`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL`);
  }
  if (
    parsed.protocol !== 'https:'
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    throw new Error(`${name} must be an HTTPS URL`);
  }
  return value;
};

export const validateProductionOrigins = (env = process.env) => {
  requireProductionApiBaseUrl(env.VITE_API_BASE_URL);
  const frontendOrigin = requireExactHttpsOrigin('VITE_FRONTEND_ORIGIN', env.VITE_FRONTEND_ORIGIN);
  for (const name of REQUIRED_HTTPS_ORIGINS) {
    requireExactHttpsOrigin(name, env[name]);
  }
  requireLogtoAppId(env.VITE_LOGTO_APP_ID);
  requireLogtoRedirectUri(env.VITE_LOGTO_REDIRECT_URI, frontendOrigin);
  requireHttpsUrl(
    'VITE_LOGTO_ACCOUNT_CENTER_URL',
    env.VITE_LOGTO_ACCOUNT_CENTER_URL,
  );
};

export const serializeProductionOrigins = (env = process.env) => {
  validateProductionOrigins(env);
  return `${MANIFEST_KEYS.map((name) => `${name}=${env[name]}`).join('\n')}\n`;
};

if (process.argv[1]?.endsWith('validate-production-origins.mjs')) {
  const manifestArg = process.argv.find((arg) => arg.startsWith('--write-manifest='));
  if (manifestArg) {
    const manifestPath = manifestArg.slice('--write-manifest='.length);
    if (!manifestPath) throw new Error('manifest path is required');
    writeFileSync(manifestPath, serializeProductionOrigins(), { encoding: 'utf8', mode: 0o444 });
  } else {
    validateProductionOrigins();
  }
}
