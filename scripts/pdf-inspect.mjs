// Reading a generated PDF the way a reader sees it.
//
// The verify scripts use this to check what is actually printed: the content
// streams are decompressed, the text operators decoded (pdf-lib writes strings
// as hex, WinAnsi-encoded) and the page count and image objects reported.

import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

const winAnsi = (bytes) => {
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return Buffer.from(bytes).toString('latin1');
  }
};

export async function inspectPdf(bytes) {
  const doc = await PDFDocument.load(bytes);
  // flatten object streams so every content stream is findable by eye
  const flat = Buffer.from(await doc.save({ useObjectStreams: false }));
  const raw = flat.toString('latin1');
  const text = [];
  let i = 0;
  for (;;) {
    const start = flat.indexOf('stream', i);
    if (start < 0) break;
    const end = flat.indexOf('endstream', start);
    if (end < 0) break;
    let from = start + 6;
    if (flat[from] === 0x0d) from += 1;
    if (flat[from] === 0x0a) from += 1;
    let chunk = flat.subarray(from, end);
    try {
      chunk = zlib.inflateSync(chunk);
    } catch {
      /* not a Flate stream */
    }
    const lines = winAnsi(chunk)
      .split('\n')
      .filter((l) => /\bTj\b|\bTJ\b/.test(l));
    for (const line of lines) {
      for (const m of line.matchAll(/<([0-9A-Fa-f]*)>|\(((?:\\.|[^)\\])*)\)/g)) {
        text.push(m[1] !== undefined ? winAnsi(Buffer.from(m[1], 'hex')) : m[2].replace(/\\([()\\])/g, '$1'));
      }
    }
    i = end + 9;
  }
  return {
    pages: doc.getPageCount(),
    images: (raw.match(/\/Subtype \/Image/g) || []).length,
    jpeg: /DCTDecode/.test(raw),
    bytes: flat.length,
    text: text.join('\n')
  };
}

/** Pull the last captured download out of the page as bytes. */
export const lastBlobBytes = (page) =>
  page.evaluate(async () => {
    const blob = window.__avniBlobs?.[window.__avniBlobs.length - 1];
    if (!blob) return null;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
    }
    return { type: blob.type, size: buf.length, base64: btoa(binary) };
  });
