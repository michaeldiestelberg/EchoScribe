import 'dotenv/config';
import OpenAI from 'openai';

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured. Please add it in Settings.');
  return new OpenAI({ apiKey: key });
}

export async function transcribeFileStream({ fileStream, filename, language = undefined }) {
  // Uses gpt-4o-transcribe
  // OpenAI Node SDK expects a File-like object or Readable stream with a filename
  const client = getOpenAI();
  const response = await client.audio.transcriptions.create({
    file: await toOpenAIFile(fileStream, filename),
    model: 'gpt-4o-transcribe',
    // language: undefined to auto-detect
  });
  // response.text expected
  return response?.text || '';
}

// Cleanup + speaker labeling using a lightweight model
export async function cleanupTranscriptMarkdown({ rawTranscript, languageHint }) {
  const sys = `You are a transcript editor. Clean transcripts by removing filler words (um, uh, like when not meaningful), stutters, and false starts; normalize numbers into numerals; correct punctuation and casing; and group lines into paragraphs. Add speaker labels as Speaker 1, Speaker 2, etc. If the source language is not English, keep that language. Output only clean Markdown as plain text. Do not wrap the output in code fences or backticks.`;
  const user = `Raw transcript:\n\n${rawTranscript}\n\nRequirements:\n- Remove disfluencies and false starts\n- Normalize numbers to digits (e.g., twenty five -> 25)\n- Punctuate and paragraph appropriately\n- Label speakers as Speaker 1, Speaker 2, ...\n- Output in Markdown only`;
  const client = getOpenAI();
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
  });
  const text = resp.choices?.[0]?.message?.content?.trim() || '';
  return text;
}

export async function testOpenAIConnection(apiKey) {
  try {
    const client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
    // Minimal call to validate auth
    // Listing models is a lightweight authenticated request
    const iter = await client.models.list();
    // If we got here without throwing, auth works
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function toOpenAIFile(stream, filename) {
  // The SDK accepts Readable|Blob, but we can use web File polyfill via SDK helper
  // If stream is a Buffer, wrap in a Blob
  if (Buffer.isBuffer(stream)) {
    return new File([stream], filename, { type: 'audio/mpeg' });
  }
  // For Readable stream, collect to a Buffer (small files) — recommended for chunks
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  return new File([buf], filename, { type: 'audio/mpeg' });
}
