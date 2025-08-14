import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

function s3Client() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const creds = accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {};
  return new S3Client({ region, ...creds });
}

export function makeS3FromConfig({ region, accessKeyId, secretAccessKey }) {
  const creds = accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {};
  return new S3Client({ region: region || process.env.AWS_REGION || 'us-east-1', ...creds });
}

export async function putObject({ Bucket, Key, Body, ContentType }) {
  const BodyStream = Buffer.isBuffer(Body) ? Body : Body instanceof Readable ? Body : Buffer.from(Body);
  await s3Client().send(new PutObjectCommand({ Bucket, Key, Body: BodyStream, ContentType }));
  return { Bucket, Key };
}

export async function listPrefix({ Bucket, Prefix }) {
  const resp = await s3Client().send(new ListObjectsV2Command({ Bucket, Prefix }));
  return resp.Contents || [];
}

export async function listAllKeys({ Bucket, Prefix }) {
  let ContinuationToken = undefined;
  const keys = [];
  do {
    const resp = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    (resp.Contents || []).forEach(o => keys.push(o.Key));
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

export async function getText({ Bucket, Key }) {
  const resp = await s3Client().send(new GetObjectCommand({ Bucket, Key }));
  const str = await streamToString(resp.Body);
  return str;
}

export async function getJson({ Bucket, Key }) {
  const text = await getText({ Bucket, Key });
  try { return JSON.parse(text); } catch { return null; }
}

export async function exists({ Bucket, Key }) {
  try {
    await s3Client().send(new HeadObjectCommand({ Bucket, Key }));
    return true;
  } catch (e) {
    return false;
  }
}

export async function deletePrefix({ Bucket, Prefix }) {
  const keys = await listAllKeys({ Bucket, Prefix });
  if (keys.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000).map(Key => ({ Key }));
    const resp = await s3Client().send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk, Quiet: true } }));
    deleted += (resp.Deleted || []).length;
  }
  return deleted;
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(Buffer.from(d)));
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.once('error', reject);
  });
}

export function s3JobPrefix(jobId) { return `jobs/${jobId}/`; }
export function s3JobKey(jobId, name) { return `${s3JobPrefix(jobId)}${name}`; }

export async function testS3Connection({ Bucket, region, accessKeyId, secretAccessKey, write = true }) {
  try {
    const s3 = makeS3FromConfig({ region, accessKeyId, secretAccessKey });
    // Head bucket to ensure it exists and we have permission
    await s3.send(new HeadBucketCommand({ Bucket }));
    let writeOk = false;
    if (write) {
      const key = `health/connection-test-${Date.now()}.txt`;
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: 'ok', ContentType: 'text/plain' }));
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
      writeOk = true;
    }
    return { ok: true, writeOk };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
