// Validation support only. A Service 176 download endpoint is not yet known.
export function validatePdf(bytes: Uint8Array, contentType: string | null) {
  if (bytes.byteLength === 0) throw new Error('Empty document');
  if (contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') throw new Error('Unexpected PDF content type');
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Missing PDF signature');
  return { byteLength: bytes.byteLength, contentType: 'application/pdf', signature: '%PDF-' };
}
