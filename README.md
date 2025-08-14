EchoScribe — Transcription App (OpenAI + S3)

Overview
- Upload audio/video; server extracts audio (if video), compresses to mono, and splits into chunks by size and duration limits.
- Transcribes via OpenAI `gpt-4o-transcribe` (auto language detection).
- Cleans text (remove ums/uhs, stutters, false starts), normalizes numbers, adds punctuation, and labels speakers.
- Stores original, segments, and final Markdown in S3 under `jobs/<jobId>/`.
- ChatGPT-style UI: New Transcription, history with friendly names, progress, copy/download, and delete.
- Settings & onboarding: Configure OpenAI + S3 in-app; “Test Connection” validates credentials.

Get the Code
- Clone the repository:
  - `git clone <repo-url>`
  - `cd transcription-app`

Run Locally on macOS
- Prerequisites:
  - Node.js 18+ (20+ recommended)
  - ffmpeg and ffprobe: `brew install ffmpeg`
  - OpenAI API key, AWS S3 credentials, and a bucket (see `s3-setup.md`)
- Start the server:
  - `cd server`
  - `npm install`
  - `npm run dev` (auto reload) or `npm start`
- Open the app: http://localhost:3000
- Configure settings (preferred):
  - Click the ⚙️ Settings button in the header
  - Enter OpenAI and AWS/S3 details
  - Click “Test Connection” to validate
  - Save (writes to `server/.env`)
- Optional: Configure via `.env` file
  - Copy `server/.env.example` to `server/.env`
  - Set values for: `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`
  - Never commit `.env` to version control
- Notes:
  - Temp job folders are created under your OS temp dir (on macOS: `/var/folders/.../T/`) and auto-deleted after jobs complete
  - Progress is available via `/api/status/:jobId`

Run via Docker
- Prerequisites: Docker Desktop
- Build the image:
  - `docker build -t echoscribe:latest .`
- Run (with env file):
  - `docker run --rm -p 3000:3000 --env-file ./server/.env echoscribe:latest`
- Or pass env vars directly:
  - `docker run --rm -p 3000:3000 \
      -e OPENAI_API_KEY=... \
      -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
      -e AWS_REGION=us-east-1 -e S3_BUCKET=your-bucket \
      echoscribe:latest`
- Open http://localhost:3000
- Production tip: prefer environment variables/secrets for containers; the Settings UI writes to `.env`, which is not persistent inside containers

Deploy to Fly.io
- Prerequisites:
  - Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
  - `flyctl auth login`
- Initialize (unique app name required):
  - `flyctl launch --no-deploy`
  - Choose Dockerfile deploy; set a unique name (or edit `fly.toml`, `app = "..."`)
- Set secrets (do not commit secrets):
  - `flyctl secrets set OPENAI_API_KEY=sk-...`
  - `flyctl secrets set AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 S3_BUCKET=your-bucket`
- Deploy:
  - `flyctl deploy`
- Open:
  - `flyctl open` (or browse https://<your-app>.fly.dev)
- Notes:
  - Dockerfile installs ffmpeg and runs on port 3000; `fly.toml` maps 80/443 to 3000
  - Use `flyctl secrets` for config in production; container filesystems are ephemeral
  - Health check: `/api/health`

Environment Variables (server/.env)
- `OPENAI_API_KEY` — OpenAI key
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — AWS creds + region
- `S3_BUCKET` — Target S3 bucket
- `PUBLIC_BASE_URL` — Optional, public URL (for generated links)
- `TRANSCRIBE_AUDIO_BITRATE_KBPS` — Optional, audio bitrate (default 48)
- `TRANSCRIBE_MAX_CHUNK_MB` — Optional, per-chunk max MB (default 24)
- `TRANSCRIBE_MAX_DURATION_SEC` — Optional, per-chunk max seconds (default 1400)

S3 Setup
- See `s3-setup.md` for a detailed guide and least-privilege IAM policy.

How it Works (Notes)
- Compression: mono 16kHz, low bitrate; chunks split by size and model duration limits
- Cleanup: removes filler words, stutters, false starts; normalizes numbers; adds punctuation; labels speakers
- Storage: original, segments, raw, and cleaned Markdown saved under `jobs/<jobId>/` in S3
- Temp files: per-job temp folder is deleted after completion
