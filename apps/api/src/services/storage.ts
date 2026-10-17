import mongoose, { Types } from 'mongoose';

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'uploads' });

/** Raw uploads live in GridFS so the API and a separate worker can both read them. */
export async function putFile(buf: Buffer, filename: string, contentType: string): Promise<Types.ObjectId> {
  return new Promise((resolve, reject) => {
    const s = bucket().openUploadStream(filename, { metadata: { contentType } });
    s.on('error', reject);
    s.on('finish', () => resolve(s.id as Types.ObjectId));
    s.end(buf);
  });
}

export async function getFile(id: Types.ObjectId): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    bucket().openDownloadStream(id).on('data', (c: Buffer) => chunks.push(c)).on('error', reject).on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function deleteFile(id?: Types.ObjectId | null) {
  if (!id) return;
  await bucket().delete(id).catch(() => undefined);
}
