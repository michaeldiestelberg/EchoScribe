export function stripCodeFences(input) {
  if (!input) return input;
  let s = String(input).trim();
  if (!s.startsWith('```')) return s;

  // Match opening fence: ``` or ```lang
  const firstNewline = s.indexOf('\n');
  if (firstNewline === -1) return s;

  const opening = s.slice(0, firstNewline);
  if (!/^```[a-zA-Z0-9_-]*\s*$/.test(opening)) return s;

  // Remove opening fence line
  let body = s.slice(firstNewline + 1);

  // Remove closing fence (last ```)
  const lastFence = body.lastIndexOf('```');
  if (lastFence !== -1 && body.slice(lastFence).trim() === '```') {
    body = body.slice(0, lastFence);
  }

  return body.trim();
}

