import { nanoid } from 'nanoid';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mime from 'mime';
import { Readable } from 'stream';
import { createJob, updateJob, getJob, getAllJobs, deleteJobFromStore } from './store.js';
import { runFfmpeg, runFfprobeJson } from '../media/ffmpeg.js';
import { transcribeFileStream, cleanupTranscriptMarkdown } from '../openai/client.js';
import { stripCodeFences } from '../utils/text.js';
import { displayNameFromFilename } from '../utils/names.js';
import { putObject, listPrefix, getText, getJson, exists, s3JobKey, s3JobPrefix, deletePrefix } from '../s3/client.js';

function cfg() {
  return {
    bucket: process.env.S3_BUCKET,
    MAX_MB: parseInt(process.env.TRANSCRIBE_MAX_CHUNK_MB || '24', 10),
    MAX_DURATION_SEC: parseInt(process.env.TRANSCRIBE_MAX_DURATION_SEC || '1400', 10),
    BITRATE_KBPS: parseInt(process.env.TRANSCRIBE_AUDIO_BITRATE_KBPS || '48', 10),
  };
}

export async function startTranscriptionJob({ originalFilename, buffer, mimetype }) {
  const jobId = nanoid();
  const displayName = displayNameFromFilename(originalFilename);
  const job = createJob({ jobId, originalFilename, displayName });

  // fire and forget pipeline
  process.nextTick(() => pipeline(jobId, { originalFilename, buffer, mimetype }).catch(err => {
    console.error('Job failed', jobId, err);
    updateJob(jobId, { status: 'error', message: String(err), progress: 100 });
  }));

  return job;
}

export async function getJobStatus(jobId) {
  const j = getJob(jobId);
  const base = process.env.PUBLIC_BASE_URL || '';
  if (j) {
    return {
      jobId: j.jobId,
      status: j.status,
      progress: j.progress,
      message: j.message,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      resultUrl: j.status === 'completed' ? `${base}/api/result/${j.jobId}` : null,
    };
  }
  // Not in memory (e.g., after restart). If S3 has cleaned.md, treat as completed.
  const { bucket } = cfg();
  if (bucket) {
    const key = s3JobKey(jobId, 'cleaned.md');
    const ok = await exists({ Bucket: bucket, Key: key });
    if (ok) {
      return {
        jobId,
        status: 'completed',
        progress: 100,
        message: 'Done',
        resultUrl: `${base}/api/result/${jobId}`,
      };
    }
  }
  return null;
}

export async function listJobs() {
  const { bucket } = cfg();
  if (!bucket) {
    return getAllJobs().map(j => ({ jobId: j.jobId, displayName: j.displayName || displayNameFromFilename(j.originalFilename) || j.jobId, createdAt: j.createdAt }));
  }
  const contents = await listPrefix({ Bucket: bucket, Prefix: 'jobs/' });
  const jobIds = new Set();
  for (const item of contents) {
    const parts = item.Key.split('/');
    if (parts.length >= 2 && parts[0] === 'jobs' && parts[1]) jobIds.add(parts[1]);
  }
  const results = [];
  for (const jobId of jobIds) {
    let displayName = null;
    let createdAt = null;
    try {
      const meta = await getJson({ Bucket: bucket, Key: s3JobKey(jobId, 'meta.json') });
      if (meta) {
        displayName = meta.displayName || null;
        createdAt = meta.createdAt || null;
      }
    } catch {}
    results.push({ jobId, displayName: displayName || jobId, createdAt });
  }
  results.sort((a,b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  results.reverse();
  return results;
}

export async function getJobResult(jobId) {
  const { bucket } = cfg();
  if (!bucket) {
    const j = getJob(jobId);
    if (!j?.result) return null;
    return { jobId, markdown: stripCodeFences(j.result.markdown) };
  }
  const key = s3JobKey(jobId, 'cleaned.md');
  try {
    const md = await getText({ Bucket: bucket, Key: key });
    return { jobId, markdown: stripCodeFences(md) };
  } catch (e) {
    return null;
  }
}

export async function deleteJob(jobId) {
  // Remove from S3 (if configured)
  const { bucket } = cfg();
  if (bucket) {
    const Prefix = s3JobPrefix(jobId);
    await deletePrefix({ Bucket: bucket, Prefix });
  }
  // Remove from memory store
  deleteJobFromStore(jobId);
  return { ok: true };
}

async function pipeline(jobId, { originalFilename, buffer, mimetype }) {
  const { bucket, MAX_MB, MAX_DURATION_SEC, BITRATE_KBPS } = cfg();
  updateJob(jobId, { status: 'processing', message: 'Uploading source...', progress: 5 });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
  try {
    const srcPath = path.join(tmpDir, originalFilename);
    fs.writeFileSync(srcPath, buffer);
    const jobRec = getJob(jobId);
    const jobDisplayName = jobRec?.displayName || displayNameFromFilename(originalFilename);

    // Upload original
    if (bucket) {
      await putObject({ Bucket: bucket, Key: s3JobKey(jobId, `original/${path.basename(srcPath)}`), Body: buffer, ContentType: mimetype || 'application/octet-stream' });
      const meta = {
        jobId,
        displayName: jobDisplayName,
        originalFilename,
        createdAt: getJob(jobId)?.createdAt,
      };
      await putObject({ Bucket: bucket, Key: s3JobKey(jobId, 'meta.json'), Body: JSON.stringify(meta), ContentType: 'application/json' });
    }

    // Decide if video and extract audio
    updateJob(jobId, { message: 'Analyzing media...' });
    const probe = await runFfprobeJson(srcPath);
    const hasVideo = (probe.streams || []).some(s => s.codec_type === 'video');
    const audioPath = path.join(tmpDir, 'audio.mp3');
    updateJob(jobId, { message: hasVideo ? 'Extracting audio...' : 'Compressing audio...' });

    // Transcode to mono mp3 at target bitrate and 16kHz to reduce size.
    await runFfmpeg([
      ...(hasVideo ? ['-i', srcPath] : ['-i', srcPath]),
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', `${BITRATE_KBPS}k`,
      audioPath,
    ]);

    // Probe duration
    const audioProbe = await runFfprobeJson(audioPath);
    const durationSec = parseFloat(audioProbe.format?.duration || '0') || 0;

    // Compute max segment length based on bitrate & max MB threshold AND model duration cap
    const maxBytes = MAX_MB * 1024 * 1024;
    const bytesPerSecond = (BITRATE_KBPS * 1000) / 8; // bytes/sec
    const maxSegBySize = Math.max(60, Math.floor(maxBytes / bytesPerSecond) - 2); // pad for headers
    const maxSegByDuration = Math.max(60, MAX_DURATION_SEC - 5); // small pad under limit
    const maxSegSec = Math.min(maxSegBySize, maxSegByDuration);
    const needSplit = (durationSec * bytesPerSecond) > maxBytes || durationSec > MAX_DURATION_SEC;
    const segmentsDir = path.join(tmpDir, 'segments');
    fs.mkdirSync(segmentsDir);

    if (needSplit) {
      updateJob(jobId, { message: 'Splitting into chunks...' });
      const segmentPattern = path.join(segmentsDir, 'part-%03d.mp3');
      await runFfmpeg([
        '-i', audioPath,
        '-f', 'segment',
        '-segment_time', String(maxSegSec),
        '-reset_timestamps', '1',
        '-c', 'copy',
        segmentPattern,
      ]);
    } else {
      fs.copyFileSync(audioPath, path.join(segmentsDir, 'part-000.mp3'));
    }

    // List segments
    const allSegs = fs.readdirSync(segmentsDir).filter(f => f.startsWith('part-')).sort();
    if (allSegs.length === 0) throw new Error('No segments produced');

    // Upload compressed/chunked artifacts
    if (bucket) {
      for (const f of allSegs) {
        const bf = fs.readFileSync(path.join(segmentsDir, f));
        await putObject({ Bucket: bucket, Key: s3JobKey(jobId, `segments/${f}`), Body: bf, ContentType: 'audio/mpeg' });
      }
    }

    // Transcribe each segment
    let raw = '';
    for (let i = 0; i < allSegs.length; i++) {
      updateJob(jobId, { message: `Transcribing chunk ${i + 1}/${allSegs.length}...`, progress: 10 + Math.floor((i / allSegs.length) * 60) });
      const segPath = path.join(segmentsDir, allSegs[i]);
      const stream = fs.createReadStream(segPath);
      const text = await transcribeFileStream({ fileStream: stream, filename: allSegs[i] });
      raw += (raw ? '\n\n' : '') + text;
    }

    // Upload raw transcript
    if (bucket) {
      await putObject({ Bucket: bucket, Key: s3JobKey(jobId, 'raw.txt'), Body: raw, ContentType: 'text/plain; charset=utf-8' });
    }

    // Cleanup + speaker labels in Markdown
    updateJob(jobId, { message: 'Cleaning transcript...', progress: 85 });
    const cleanedRaw = await cleanupTranscriptMarkdown({ rawTranscript: raw });
    const cleanedMd = stripCodeFences(cleanedRaw);

    // Upload cleaned transcript
    if (bucket) {
      await putObject({ Bucket: bucket, Key: s3JobKey(jobId, 'cleaned.md'), Body: cleanedMd, ContentType: 'text/markdown; charset=utf-8' });
    }

    updateJob(jobId, { status: 'completed', message: 'Done', progress: 100, result: { markdown: cleanedMd } });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Temp cleanup failed for ${tmpDir}:`, e?.message || e);
    }
  }
}
