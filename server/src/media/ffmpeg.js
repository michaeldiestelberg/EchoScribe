import { spawn } from 'child_process';

export async function ensureFfmpegAvailable() {
  await Promise.all([
    execCheck(['ffmpeg', ['-version']]),
    execCheck(['ffprobe', ['-version']]),
  ]).catch(() => {
    console.warn('Warning: ffmpeg/ffprobe not detected on PATH. Media processing will fail.');
  });
}

export function runFfmpeg(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args], { cwd });
    let stderr = '';
    proc.stderr.on('data', d => (stderr += d.toString()));
    proc.on('close', code => {
      if (code === 0) return resolve({ code });
      reject(new Error(`ffmpeg failed: ${code}\n${stderr}`));
    });
  });
}

export function runFfprobeJson(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath];
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => (stdout += d.toString()));
    proc.stderr.on('data', d => (stderr += d.toString()));
    proc.on('close', code => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      } else {
        reject(new Error(`ffprobe failed: ${code}\n${stderr}`));
      }
    });
  });
}

async function execCheck([cmd, args]) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    p.on('close', code => (code === 0 ? resolve() : reject()));
    p.on('error', reject);
  });
}

