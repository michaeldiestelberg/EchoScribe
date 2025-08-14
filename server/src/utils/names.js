import path from 'path';

export function displayNameFromFilename(filename, maxLen = 32) {
  if (!filename) return '';
  const base = path.parse(filename).name || String(filename);
  const trimmed = base.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + '…';
}

