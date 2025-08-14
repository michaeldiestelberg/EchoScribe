# S3 Setup Guide (Step‑by‑Step)

This guide walks you through creating an S3 bucket, a least‑privilege IAM user, and credentials the app can use. It assumes no prior AWS experience.

Note: Never use the AWS root account for applications. Create an IAM user with minimal permissions instead.

## 0) Prerequisites
- An AWS account (sign up at aws.amazon.com). Enable MFA on the root user.
- Install AWS CLI v2 (search “Install AWS CLI v2” on the AWS docs for your OS) and verify with `aws --version`.
- Decide on a bucket name (globally unique) and a region (e.g., `us-east-1`).

## 1) Create the S3 Bucket (Console)
1. Sign in to the AWS Console and open S3.
2. Click Create bucket.
3. Bucket name: choose a unique name (e.g., `my-transcription-app-prod`).
4. AWS Region: pick where to store data (e.g., `us-east-1`).
5. Block Public Access: leave all four options ON (recommended). This keeps your bucket private.
6. Bucket Versioning: optional. You can keep this Off for now.
7. Default encryption: enable (SSE-S3) for at-rest encryption.
8. Click Create bucket.

Optional: Create a logical prefix for this app (you don’t need to create folders now; the app writes to `jobs/<jobId>/`).

## 2) Create a Least‑Privilege IAM Policy
We’ll create a policy that allows only required actions on your bucket.

1. Open IAM in the AWS Console → Policies → Create policy.
2. Choose the JSON tab and paste the policy below, replacing `YOUR_BUCKET_NAME` and region/account IDs only if present in the ARN pattern:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
    },
    {
      "Sid": "ObjectRW",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

3. Next → Name your policy (e.g., `TranscriptionAppS3Policy`) and Create policy.

Notes
- This policy limits access to just your bucket and its objects.
- If you plan to upload very large files using multipart uploads via the CLI or SDK, you can extend permissions to include `s3:AbortMultipartUpload` and multipart listing actions later.

## 3) Create an IAM User for the App
1. IAM → Users → Create user.
2. User name: `transcription-app` (or any name you like).
3. Select “Provide user access to the AWS Management Console” OFF; we only need programmatic access via access keys.
4. Click Next.
5. Attach permissions → “Attach policies directly” → select `TranscriptionAppS3Policy` you created above.
6. Create user.

## 4) Generate Access Keys for the User
1. IAM → Users → click your user → Security credentials tab.
2. Under Access keys, click Create access key.
3. Use for: Application running outside AWS.
4. Copy the Access key ID and Secret access key and store them securely (password manager). You’ll put these in the app’s `.env`.

Security tips
- Treat access keys like passwords. Don’t commit them to git.
- Rotate keys periodically and delete old keys.

## 5) Configure AWS CLI Locally (Test Credentials)
1. In a terminal, run:
   - `aws configure`
2. Enter:
   - AWS Access Key ID: your key from step 4
   - AWS Secret Access Key: your secret from step 4
   - Default region name: your bucket region (e.g., `us-east-1`)
   - Default output format: `json` (or leave blank)

Quick tests (replace `YOUR_BUCKET_NAME`):
- `aws s3 ls s3://YOUR_BUCKET_NAME`
- Optional upload test: `echo test > /tmp/test.txt && aws s3 cp /tmp/test.txt s3://YOUR_BUCKET_NAME/test.txt && aws s3 rm s3://YOUR_BUCKET_NAME/test.txt`

If these commands succeed, your credentials and policy are set correctly.

## 6) Set Environment Variables for the App
In this repo, copy `server/.env.example` to `server/.env` and set the following:

- `AWS_ACCESS_KEY_ID`: Access key ID from step 4
- `AWS_SECRET_ACCESS_KEY`: Secret access key from step 4
- `AWS_REGION`: Region used for the bucket (e.g., `us-east-1`)
- `S3_BUCKET`: Your bucket name

Example `server/.env` snippet:
```
AWS_ACCESS_KEY_ID=AKIA****************
AWS_SECRET_ACCESS_KEY=abcdEFGHijklMNOPqrstUVWXyz1234567890
AWS_REGION=us-east-1
S3_BUCKET=my-transcription-app-prod
```

The server reads these via the AWS SDK v3; no additional configuration needed.

## 7) Recommended Bucket Settings (Security & Maintenance)
- Block Public Access: keep all four checks enabled.
- Default Encryption: enable SSE-S3 (or SSE-KMS if you require key control; update IAM policy accordingly if using KMS).
- TLS enforcement: add a bucket policy to deny non-SSL requests:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME",
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

- Lifecycle rules: Optional. You can add rules to expire temporary artifacts. For example, delete `jobs/*/segments/*` after 30 days while keeping final transcripts indefinitely.

## 8) Using the Bucket with This App
- The app writes to `jobs/<jobId>/`:
  - `original/<filename>` – original upload
  - `segments/part-***.mp3` – compressed chunks
  - `raw.txt` – raw stitched transcript
  - `cleaned.md` – final Markdown transcript
- Ensure `S3_BUCKET` is set; start the server and run a small test upload to verify objects appear in the bucket.

## 9) Troubleshooting
- AccessDenied: Confirm the IAM policy has your correct bucket name and includes `s3:ListBucket`, `s3:PutObject`, and `s3:GetObject`.
- SignatureDoesNotMatch: Ensure region in `.env` matches the bucket region.
- Bucket name not unique: Choose a different bucket name; names are global.
- ffmpeg errors (unrelated to S3): Make sure ffmpeg/ffprobe are installed and on PATH.

You’re done! Your S3 bucket and IAM user are ready for the transcription app.
