const encoder = new TextEncoder();

/** Hex SHA-256 via Web Crypto, so it runs unchanged in Node, edge runtimes and browsers. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
