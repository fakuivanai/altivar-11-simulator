import documents from './manufacturer-documents.json';
import { invariant } from './invariant';

export type Manual = 'user' | 'technical';

function documentFor(manual: Manual) {
  const document = documents.find(item => item.id === manual);
  invariant(document, 'Falta la referencia del fabricante: ' + manual);
  return document;
}

/** Official documents stay with the manufacturer; page fragments are viewer hints. */
export function manualUrl(manual: Manual, pdfPage?: number): string {
  const document = documentFor(manual);
  const page = pdfPage ?? (manual === 'user' ? document.pageMapping.SpanishPdf?.[0] : 1);
  invariant(page !== undefined, 'Falta la página inicial del manual.');
  return document.sourceUrl + '#page=' + page;
}

/** Catalog pages use the English printed numbering of the cited edition. */
export function manualReference(source: { manual: Manual; page: number }) {
  const document = documentFor(source.manual);
  const page = source.page + document.pageMapping.catalogToPdfOffset;
  const printed = source.page + document.pageMapping.catalogToPrintedOffset;
  return { url: manualUrl(source.manual, page), page,
    label: (source.manual === 'user' ? 'Manual, pág. ' : 'Manual técnico, pág. ') + printed };
}
