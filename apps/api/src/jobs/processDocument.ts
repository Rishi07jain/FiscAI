import type { DocumentType } from '@fiscai/shared-types';
import { Types } from 'mongoose';
import { DocumentModel } from '../models';
import { extractDocument } from '../services/extraction/extract';
import { PdfPasswordError } from '../services/extraction/pdf';
import { getFile } from '../services/storage';

import { decrypt } from '../lib/crypto';

/** `encPassword` is the PDF password encrypted with the app key; it is never stored on the document. */
export async function processDocument(documentId: string, encPassword?: string) {
  const doc = await DocumentModel.findById(new Types.ObjectId(documentId));
  if (!doc || !doc.fileRef) return;
  doc.status = 'parsing';
  doc.error = undefined;
  await doc.save();
  try {
    const buffer = await getFile(doc.fileRef);
    const out = await extractDocument(doc.type as DocumentType, { buffer, mimeType: doc.mimeType ?? '', filename: doc.filename ?? '' }, encPassword ? decrypt(encPassword) : undefined);
    doc.extractedFields = out.fields.map((f) => ({ ...f, accepted: true })) as any;
    doc.pagesPreview = out.pagesPreview as any;
    doc.method = out.method;
    doc.redactions = { ...out.redactions, warnings: out.warnings };
    doc.status = out.fields.length ? 'needs_review' : 'failed';
    if (!out.fields.length) doc.error = 'No fields could be extracted. Check the document type, or enter values manually.';
  } catch (e) {
    doc.status = 'failed';
    doc.error = e instanceof PdfPasswordError ? e.message : (e as Error).message;
  }
  await doc.save();
}
