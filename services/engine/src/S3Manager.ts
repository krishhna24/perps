import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";



const BUCKET = process.env["S3_BUCKET"] ?? "perps-snapshots";
const REGION = process.env["AWS_REGION"] ?? "us-east-1";

let client: S3Client | null = null;
let bucketReady = false;

function isConfigured(): boolean {

  return Boolean(process.env["S3_BUCKET"] || process.env["S3_ENDPOINT"]);
}

function getClient(): S3Client | null {
  if (!isConfigured()) return null;
  if (!client) {
    client = new S3Client({
      region: REGION,
      ...(process.env["S3_ENDPOINT"]
        ? {
            endpoint: process.env["S3_ENDPOINT"],
            forcePathStyle: true,
            credentials: {
              accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "test",
              secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "test",
            },
          }
        : {}),
    });
  }
  return client;
}

async function ensureBucket(c: S3Client): Promise<void> {
  if (bucketReady) return;
  try {
    await c.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await c.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
  bucketReady = true;
}

export async function uploadSnapshot(snapshot: unknown, key: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  await ensureBucket(c);
  await c.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(snapshot),
      ContentType: "application/json",
    }),
  );
}

export async function downloadSnapshot<T>(key: string): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch {

    return null;
  }
}
