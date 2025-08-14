import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve to server/.env regardless of CWD
const ENV_PATH = path.join(__dirname, '../../.env');

const ALLOWED_KEYS = [
  'OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'S3_BUCKET',
  'PUBLIC_BASE_URL',
  'TRANSCRIBE_AUDIO_BITRATE_KBPS',
  'TRANSCRIBE_MAX_CHUNK_MB',
  'TRANSCRIBE_MAX_DURATION_SEC',
];

export function getEffectiveConfig() {
  const env = process.env;
  return {
    OPENAI_API_KEY_PRESENT: !!env.OPENAI_API_KEY,
    AWS_ACCESS_KEY_ID_PRESENT: !!env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY_PRESENT: !!env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: env.AWS_REGION || '',
    S3_BUCKET: env.S3_BUCKET || '',
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL || '',
    TRANSCRIBE_AUDIO_BITRATE_KBPS: env.TRANSCRIBE_AUDIO_BITRATE_KBPS || '48',
    TRANSCRIBE_MAX_CHUNK_MB: env.TRANSCRIBE_MAX_CHUNK_MB || '24',
    TRANSCRIBE_MAX_DURATION_SEC: env.TRANSCRIBE_MAX_DURATION_SEC || '1400',
  };
}

export function getConfigStatus() {
  const cfg = getEffectiveConfig();
  const missing = [];
  if (!cfg.OPENAI_API_KEY_PRESENT) missing.push('OPENAI_API_KEY');
  if (!cfg.AWS_ACCESS_KEY_ID_PRESENT) missing.push('AWS_ACCESS_KEY_ID');
  if (!cfg.AWS_SECRET_ACCESS_KEY_PRESENT) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!cfg.AWS_REGION) missing.push('AWS_REGION');
  if (!cfg.S3_BUCKET) missing.push('S3_BUCKET');
  return { configured: missing.length === 0, missing };
}

export function updateConfig(updates) {
  const sanitized = {};
  for (const k of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) {
      const v = updates[k];
      if (typeof v === 'string' && v.trim() === '') continue; // ignore blanks
      sanitized[k] = v;
    }
  }
  // Apply to process.env (runtime)
  for (const [k, v] of Object.entries(sanitized)) {
    if (typeof v === 'string') process.env[k] = v;
  }
  // Persist to .env
  persistEnv();
  return getEffectiveConfig();
}

function persistEnv() {
  // Ensure directory exists
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
  const lines = [];
  for (const k of ALLOWED_KEYS) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).length > 0) {
      const escaped = String(v).replace(/\n/g, '\\n');
      lines.push(`${k}=${escaped}`);
    }
  }
  const content = lines.join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}
