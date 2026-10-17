import { DocumentTypeSchema } from '@fiscai/shared-types';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { encrypt } from '../lib/crypto';
import { HttpError, notFound, parse, taxYearParam } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { DocumentModel, User } from '../models';
import { confirmDocument } from '../services/documents';
import { LOW_CONFIDENCE } from '../services/extraction/extract';
import { enqueue } from '../services/queue';
import { deleteFile, putFile } from '../services/storage';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const ALLOWED = /\.(pdf|csv|xlsx|json|png|jpe?g|webp)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, 'Supported: PDF, CSV, XLSX, JSON, PNG, JPG'))),
});

const view = (d: any) => ({
  id: String(d._id), taxYear: d.taxYear, type: d.type, filename: d.filename, size: d.size, status: d.status, error: d.error,
  method: d.method, keepFile: d.keepFile, fileDeleted: Boolean(d.deletedAt) || !d.fileRef, createdAt: d.createdAt, updatedAt: d.updatedAt,
  fieldCount: d.extractedFields?.length ?? 0,
  lowConfidenceCount: (d.extractedFields ?? []).filter((f: any) => f.confidence < LOW_CONFIDENCE).length,
  warnings: d.redactions?.warnings ?? [],
});

documentsRouter.post('/', upload.single('file'), async (req, res) => {
  const userId = uid(req);
  if (!req.file) throw new HttpError(400, 'Attach a file');
  const body = parse(z.object({ type: DocumentTypeSchema, taxYear: z.string(), password: z.string().max(100).optional(), keepFile: z.enum(['true', 'false']).optional() }), req.body);
  const user = await User.findById(userId).lean();
  if (!user?.consentFlags?.documentProcessing) throw new HttpError(403, 'Please consent to document processing in Settings before uploading.');
  const fileRef = await putFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  const doc = await DocumentModel.create({
    userId, taxYear: taxYearParam(body.taxYear), type: body.type, filename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size,
    status: 'uploaded', fileRef, keepFile: body.keepFile ? body.keepFile === 'true' : Boolean(user.consentFlags?.keepUploadedFiles),
  });
  const jobId = await enqueue('processDocument', { documentId: String(doc._id), encPassword: body.password ? encrypt(body.password) : undefined });
  doc.jobId = jobId;
  await doc.save();
  res.status(202).json({ document: view(doc), jobId });
});

documentsRouter.get('/', async (req, res) => {
  const q: Record<string, unknown> = { userId: uid(req) };
  if (req.query.taxYear) q.taxYear = taxYearParam(req.query.taxYear);
  const docs = await DocumentModel.find(q, { pagesPreview: 0 }).sort({ createdAt: -1 }).lean();
  res.json({ documents: docs.map(view) });
});

documentsRouter.get('/:id', async (req, res) => {
  const d = await DocumentModel.findOne({ _id: req.params.id, userId: uid(req) }).lean();
  if (!d) throw notFound('Document');
  res.json({ document: view(d), extractedFields: d.extractedFields, pagesPreview: d.pagesPreview, lowConfidenceThreshold: LOW_CONFIDENCE });
});

documentsRouter.post('/:id/retry', async (req, res) => {
  const d = await DocumentModel.findOne({ _id: req.params.id, userId: uid(req) });
  if (!d) throw notFound('Document');
  if (!d.fileRef) throw new HttpError(409, 'The original file was deleted; upload it again.');
  const pw = parse(z.object({ password: z.string().max(100).optional() }), req.body ?? {}).password;
  d.status = 'uploaded';
  d.error = undefined;
  await d.save();
  await enqueue('processDocument', { documentId: String(d._id), encPassword: pw ? encrypt(pw) : undefined });
  res.status(202).json({ document: view(d) });
});

const ConfirmBody = z.object({
  fields: z.array(z.object({ path: z.string(), label: z.string(), value: z.unknown(), confidence: z.number(), sourceRef: z.string(), accepted: z.boolean().optional() })),
});

documentsRouter.post('/:id/confirm', async (req, res) => {
  const body = parse(ConfirmBody, req.body);
  res.json(await confirmDocument(uid(req), String(req.params.id), body.fields as any));
});

documentsRouter.delete('/:id', async (req, res) => {
  const d = await DocumentModel.findOne({ _id: req.params.id, userId: uid(req) });
  if (!d) throw notFound('Document');
  await deleteFile(d.fileRef as any);
  await d.deleteOne();
  res.json({ deleted: true });
});
