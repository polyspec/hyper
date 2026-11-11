// The hyper JSON media type compares without regard to case and parameters (HY-15, RFC 9110 section 8.3.1).
export function isHyperJson(contentType: string | null): boolean {
  if (contentType === null) return false;
  const semicolon = contentType.indexOf(';');
  const essence = (semicolon < 0 ? contentType : contentType.slice(0, semicolon)).replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
  return essence === 'application/vnd.hyper+json';
}
