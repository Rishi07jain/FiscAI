export class PdfPasswordError extends Error {
  constructor(public needsPassword: boolean) { super(needsPassword ? 'This PDF is password-protected. Enter its password and retry.' : 'Incorrect PDF password.'); }
}

/** Extract text per page with pdf.js (supports password-protected Form 16 / CAS files). */
export async function pdfPages(buf: Buffer, password?: string, maxPages = 40): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), password, isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException') throw new PdfPasswordError(e.code === 1);
    throw e;
  }
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items as any[]) {
      if (typeof item.str !== 'string') continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    pages.push(text.replace(/[ \t]+/g, ' ').trim());
  }
  await doc.destroy();
  return pages;
}
