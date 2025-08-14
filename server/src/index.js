import 'dotenv/config';
import express from 'express';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ensureFfmpegAvailable } from './media/ffmpeg.js';
import { getEffectiveConfig, getConfigStatus, updateConfig } from './config/env.js';
import { testOpenAIConnection } from './openai/client.js';
import { testS3Connection } from './s3/client.js';
import { startTranscriptionJob, getJobStatus, listJobs, getJobResult, deleteJob } from './jobs/processor.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Static UI
app.use(express.static(path.join(__dirname, '../../public')));
app.use(express.json());

// In-memory upload storage (buffer), we stream it to temp file right away in pipeline
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Config endpoints
app.get('/api/config/status', (_req, res) => {
  res.json(getConfigStatus());
});

app.get('/api/config', (_req, res) => {
  const cfg = getEffectiveConfig();
  res.json(cfg);
});

app.post('/api/config', async (req, res) => {
  try {
    const cfg = updateConfig(req.body || {});
    res.json({ ok: true, config: cfg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.post('/api/config/test', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = body.config || {};
    const write = !!body.write;
    const [openai, s3] = await Promise.all([
      testOpenAIConnection(cfg.OPENAI_API_KEY),
      cfg.S3_BUCKET ? testS3Connection({
        Bucket: cfg.S3_BUCKET,
        region: cfg.AWS_REGION,
        accessKeyId: cfg.AWS_ACCESS_KEY_ID,
        secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
        write,
      }) : Promise.resolve({ ok: false, error: 'Missing S3_BUCKET' })
    ]);
    res.json({ openai, s3 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to test config' });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const job = await startTranscriptionJob({
      originalFilename: req.file.originalname,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    res.json({ jobId: job.jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start job' });
  }
});

app.get('/api/status/:jobId', async (req, res) => {
  const status = await getJobStatus(req.params.jobId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  res.json(status);
});

app.get('/api/jobs', async (_req, res) => {
  try {
    const jobs = await listJobs();
    res.json(jobs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

app.get('/api/result/:jobId', async (req, res) => {
  try {
    const result = await getJobResult(req.params.jobId);
    if (!result) return res.status(404).json({ error: 'Job not found' });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
});

app.get('/api/download/:jobId', async (req, res) => {
  try {
    const result = await getJobResult(req.params.jobId);
    if (!result) return res.status(404).json({ error: 'Job not found' });
    const filename = `transcript-${req.params.jobId}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result.markdown || '');
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to download result' });
  }
});

app.delete('/api/job/:jobId', async (req, res) => {
  try {
    const r = await deleteJob(req.params.jobId);
    res.json(r);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

app.listen(port, async () => {
  await ensureFfmpegAvailable();
  console.log(`Server listening on http://localhost:${port}`);
});
