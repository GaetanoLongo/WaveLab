/**
 * Share links: the whole project travels in the address (`#share=…`), so nothing is uploaded and no
 * server is needed. The text of the project file is minified and deflate-compressed when the browser
 * can (CompressionStream), then written as URL-safe base64. The first character tells which:
 * `d` = deflate-raw, `r` = raw UTF-8.
 */

/** Longest payload accepted when opening a link (a decompression-bomb guard). */
export const MAX_SHARE_BYTES = 8 * 1024 * 1024;
/** Above this many characters a link may be cut off by chat apps and e-mail clients. */
export const LONG_LINK_CHARS = 8000;

const toB64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64Url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pipe(bytes: Uint8Array, stream: { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }, limit: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('The link expands to more than the allowed size.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) (out.set(c, o), (o += c.length));
  return out;
}

const hasCompression = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Project file text → link payload. */
export async function encodeShare(fileText: string): Promise<string> {
  const minified = JSON.stringify(JSON.parse(fileText));
  const bytes = new TextEncoder().encode(minified);
  if (hasCompression()) {
    try {
      const packed = await pipe(bytes, new CompressionStream('deflate-raw'), MAX_SHARE_BYTES);
      return 'd' + toB64Url(packed);
    } catch {
      /* fall through to the raw form */
    }
  }
  return 'r' + toB64Url(bytes);
}

/** Link payload → project file text (to be validated by parseProjectFile). */
export async function decodeShare(payload: string): Promise<string> {
  if (payload.length < 2 || payload.length > MAX_SHARE_BYTES * 1.4) throw new Error('This link does not contain a project.');
  const kind = payload[0];
  let bytes: Uint8Array;
  try {
    bytes = fromB64Url(payload.slice(1));
  } catch {
    throw new Error('This link is damaged (it is not valid base64).');
  }
  if (kind === 'r') return new TextDecoder().decode(bytes);
  if (kind === 'd') {
    if (!hasCompression()) throw new Error('This browser cannot open compressed links.');
    return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_SHARE_BYTES));
  }
  throw new Error('This link was made by an unknown version of WaveLab.');
}

/** Address of the app with the project in the fragment. */
export function shareUrl(payload: string, base = `${location.origin}${location.pathname}`): string {
  return `${base}#share=${payload}`;
}

/** The payload of a `#share=…` fragment, or null. */
export function payloadFromHash(hash: string): string | null {
  const m = /^#share=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1]! : null;
}
