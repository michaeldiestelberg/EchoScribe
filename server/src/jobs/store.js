// Simple in-memory job store for progress tracking
// In production, replace with Redis/DB as needed

const jobs = new Map();

export function createJob(initial) {
  const job = {
    jobId: initial.jobId,
    status: 'queued',
    progress: 0,
    message: 'Queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    displayName: initial.displayName || null,
    ...initial,
  };
  jobs.set(job.jobId, job);
  return job;
}

export function getJob(jobId) { return jobs.get(jobId); }
export function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(jobId, job);
  return job;
}
export function getAllJobs() {
  return Array.from(jobs.values()).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function deleteJobFromStore(jobId) {
  jobs.delete(jobId);
}
