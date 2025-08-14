const jobsEl = document.getElementById('jobs');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const markdownEl = document.getElementById('markdown');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const deleteBtn = document.getElementById('deleteBtn');
const newBtn = document.getElementById('newBtn');
const fileInput = document.getElementById('file');
const dropzone = document.getElementById('dropzone');
const fileNameEl = document.getElementById('fileName');
const startBtn = document.getElementById('startBtn');
const composerSection = document.getElementById('composerSection');
const contentSection = document.getElementById('contentSection');
const headerTitle = document.getElementById('headerTitle');
const detailsEl = document.getElementById('details');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsClose = document.getElementById('settingsClose');
const settingsCancel = document.getElementById('settingsCancel');
const settingsForm = document.getElementById('settingsForm');
const onboardingHint = document.getElementById('onboardingHint');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const testResultEl = document.getElementById('testResult');

let configStatus = { configured: true, missing: [] };

let currentJobId = null;

async function listJobs() {
  try {
    const res = await fetch('/api/jobs');
    const jobs = await res.json();
    jobsEl.innerHTML = '';
    (jobs || []).forEach(j => {
      const el = document.createElement('div');
      el.className = 'job-item';
      el.textContent = j.displayName || j.jobId || j?.id || j?.prefix || 'Transcript';
      el.title = j.displayName || j.jobId;
      el.onclick = () => loadJob(j.jobId || j.id);
      jobsEl.appendChild(el);
    });
  } catch (e) {
    console.error(e);
  }
}

async function loadJob(jobId) {
  if (!jobId) return;
  currentJobId = jobId;
  showDetailView();
  statusEl.textContent = `Loading ${jobId}...`;
  try {
    const res = await fetch(`/api/status/${jobId}`);
    if (!res.ok) throw new Error('status_not_found');
    const st = await res.json();
    showStatus(st);
    if (headerTitle) headerTitle.textContent = `Transcription ${jobId}`;
    if (detailsEl) detailsEl.textContent = `Transcript ID: ${jobId}`;
    if (st.status === 'completed' && st.resultUrl) {
      const rr = await fetch(st.resultUrl);
      const data = await rr.json();
      markdownEl.textContent = data.markdown || '';
      if (deleteBtn) deleteBtn.style.display = 'inline-block';
      if (downloadBtn) downloadBtn.style.display = 'inline-block';
    }
  } catch (e) {
    // Fallback: try fetching result directly (for completed jobs after restart)
    try {
      const rr = await fetch(`/api/result/${jobId}`);
      if (rr.ok) {
        const data = await rr.json();
        statusEl.textContent = 'completed • 100%';
        progressEl.textContent = 'Done';
        markdownEl.textContent = data.markdown || '';
        if (deleteBtn) deleteBtn.style.display = 'inline-block';
        if (downloadBtn) downloadBtn.style.display = 'inline-block';
      }
    } catch (_) {}
  }
}

function showStatus(st) {
  statusEl.textContent = `${st.status} • ${st.progress}%`;
  progressEl.textContent = st.message || '';
  const show = st.status === 'completed' ? 'inline-block' : 'none';
  if (deleteBtn) deleteBtn.style.display = show;
  if (downloadBtn) downloadBtn.style.display = show;
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('file').files[0];
  if (!file) return alert('Choose a file first.');
  if (!configStatus.configured) {
    openSettings(true);
    return;
  }
  // Switch to detail view now
  if (headerTitle) headerTitle.textContent = file.name;
  showDetailView({ name: file.name, size: file.size, type: file.type });
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  const jobId = data.jobId;
  if (!jobId) return alert('Failed to create job.');
  currentJobId = jobId;
  pollJob(jobId);
});

async function pollJob(jobId) {
  let done = false;
  while (!done) {
    const res = await fetch(`/api/status/${jobId}`);
    const st = await res.json();
    showStatus(st);
    if (st.status === 'completed') {
      done = true;
      const rr = await fetch(st.resultUrl);
      const data = await rr.json();
      markdownEl.textContent = data.markdown || '';
      listJobs();
      if (deleteBtn) deleteBtn.style.display = 'inline-block';
      if (downloadBtn) downloadBtn.style.display = 'inline-block';
      break;
    }
    if (st.status === 'error') {
      done = true;
      alert('Transcription error: ' + st.message);
      break;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

copyBtn.addEventListener('click', async () => {
  const text = markdownEl.textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
});

if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    if (!currentJobId) return;
    window.location.href = `/api/download/${currentJobId}`;
  });
}

if (deleteBtn) {
  deleteBtn.addEventListener('click', async () => {
    if (!currentJobId) return;
    const ok = confirm('Delete this transcription? This will remove all related files from S3.');
    if (!ok) return;
    const res = await fetch(`/api/job/${currentJobId}`, { method: 'DELETE' });
    if (res.ok) {
      currentJobId = null;
      statusEl.textContent = 'Deleted';
      progressEl.textContent = '';
      markdownEl.textContent = '';
      deleteBtn.style.display = 'none';
      listJobs();
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to delete: ' + (data.error || res.statusText));
    }
  });
}

newBtn.addEventListener('click', () => {
  // Reset to a fresh transcription state
  currentJobId = null;
  if (headerTitle) headerTitle.textContent = 'Upload and Transcribe';
  statusEl.textContent = '';
  progressEl.textContent = '';
  markdownEl.textContent = '';
  if (fileInput) fileInput.value = '';
  if (fileNameEl) fileNameEl.textContent = 'No file selected';
  if (startBtn) startBtn.disabled = true;
  showStartView();
});

listJobs();

// Dropzone interactions
function setSelectedFile(file) {
  if (!file) return;
  // Construct a DataTransfer to assign files to the input
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  if (fileNameEl) fileNameEl.textContent = file.name;
  if (startBtn) startBtn.disabled = false;
}

if (dropzone) {
  dropzone.addEventListener('click', () => fileInput && fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput && fileInput.click();
    }
  });
  ;['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  }));
  ;['dragleave','dragend','drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) setSelectedFile(f);
  });
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) setSelectedFile(f);
  });
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function showStartView() {
  if (composerSection) composerSection.style.display = '';
  if (contentSection) contentSection.style.display = 'none';
}

function showDetailView(fileInfo) {
  if (composerSection) composerSection.style.display = 'none';
  if (contentSection) contentSection.style.display = '';
  if (detailsEl) {
    if (fileInfo) {
      detailsEl.textContent = `File: ${fileInfo.name} • ${formatBytes(fileInfo.size)} • ${fileInfo.type || 'unknown type'}`;
    } else {
      detailsEl.textContent = '';
    }
  }
}

// Initialize start view on load
showStartView();

// Settings handling
async function fetchConfigStatus() {
  try {
    const res = await fetch('/api/config/status');
    if (res.ok) configStatus = await res.json();
  } catch {}
}

async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) return null;
  return await res.json();
}

function openSettings(isOnboarding = false) {
  if (settingsModal) settingsModal.classList.remove('hidden');
  if (onboardingHint) onboardingHint.style.display = isOnboarding ? '' : 'none';
  preloadSettings();
}

function closeSettings() {
  if (settingsModal) settingsModal.classList.add('hidden');
}

async function preloadSettings() {
  const cfg = await fetchConfig();
  if (!cfg) return;
  setValue('AWS_REGION', cfg.AWS_REGION);
  setValue('S3_BUCKET', cfg.S3_BUCKET);
  setValue('TRANSCRIBE_AUDIO_BITRATE_KBPS', cfg.TRANSCRIBE_AUDIO_BITRATE_KBPS);
  setValue('TRANSCRIBE_MAX_CHUNK_MB', cfg.TRANSCRIBE_MAX_CHUNK_MB);
  setValue('TRANSCRIBE_MAX_DURATION_SEC', cfg.TRANSCRIBE_MAX_DURATION_SEC);
  setValue('PUBLIC_BASE_URL', cfg.PUBLIC_BASE_URL);
  // Do not prefill secrets; leave blank to keep unchanged
}

function setValue(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v || '';
}

if (settingsBtn) settingsBtn.addEventListener('click', () => openSettings(false));
if (settingsClose) settingsClose.addEventListener('click', closeSettings);
if (settingsCancel) settingsCancel.addEventListener('click', closeSettings);

if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {};
    const ids = ['OPENAI_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','S3_BUCKET','PUBLIC_BASE_URL','TRANSCRIBE_AUDIO_BITRATE_KBPS','TRANSCRIBE_MAX_CHUNK_MB','TRANSCRIBE_MAX_DURATION_SEC'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const val = (el.value || '').trim();
      if (val !== '') payload[id] = val;
    });
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) {
      await fetchConfigStatus();
      if (configStatus.configured) closeSettings();
      alert('Settings saved.');
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to save settings: ' + (data.error || res.statusText));
    }
  });
}

(async function initConfig() {
  await fetchConfigStatus();
  if (!configStatus.configured) openSettings(true);
})();

function readSettingsForm() {
  const ids = ['OPENAI_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','S3_BUCKET','PUBLIC_BASE_URL','TRANSCRIBE_AUDIO_BITRATE_KBPS','TRANSCRIBE_MAX_CHUNK_MB','TRANSCRIBE_MAX_DURATION_SEC'];
  const cfg = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value.trim() !== '') cfg[id] = el.value.trim();
  });
  return cfg;
}

async function testConnection() {
  const cfg = readSettingsForm();
  try {
    if (testResultEl) { testResultEl.style.display = ''; testResultEl.textContent = 'Testing...'; }
    const res = await fetch('/api/config/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg, write: true }) });
    const data = await res.json();
    const ok = data.openai?.ok && data.s3?.ok && data.s3?.writeOk;
    if (testResultEl) {
      testResultEl.style.display = '';
      testResultEl.textContent = `OpenAI: ${data.openai?.ok ? 'OK' : 'Fail'}${data.openai?.error ? ' – ' + data.openai.error : ''} • S3: ${data.s3?.ok ? 'OK' : 'Fail'}${data.s3?.error ? ' – ' + data.s3.error : ''}${data.s3?.ok ? ` • Write: ${data.s3?.writeOk ? 'OK' : 'Fail'}` : ''}`;
    }
  } catch (e) {
    if (testResultEl) { testResultEl.style.display = ''; testResultEl.textContent = 'Test failed: ' + (e?.message || e); }
  }
}

if (testConnectionBtn) testConnectionBtn.addEventListener('click', testConnection);
