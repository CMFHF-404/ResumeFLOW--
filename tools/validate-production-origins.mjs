import { writeFileSync } from 'node:fs';

const REQUIRED_HTTPS_ORIGINS = [
  'VITE_API_BASE_URL',
  'VITE_LOGTO_ENDPOINT',
  'YIFUT_BASE_URL',
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

export const validateProductionOrigins = (env = process.env) => {
  for (const name of REQUIRED_HTTPS_ORIGINS) {
    requireExactHttpsOrigin(name, env[name]);
  }
};

export const serializeProductionOrigins = (env = process.env) => {
  validateProductionOrigins(env);
  return `${REQUIRED_HTTPS_ORIGINS.map((name) => `${name}=${env[name]}`).join('\n')}\n`;
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
