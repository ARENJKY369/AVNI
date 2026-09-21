// JPEG2000 reading: the JP2 container parser, the OpenJPEG/WASM decoder and
// the component -> RGBA packing.
//
// Chrome cannot decode JP2 at all and `createImageBitmap` rejects it, so AVNI
// carries OpenJPEG (same library ImageMagick/GDAL use) compiled to wasm and
// feeds it the raw codestream out of the JP2 box structure. The wasm module is
// loaded lazily — a session that never opens a `.jp2` never pays for it.
//
// Bit layout notes: OpenJPEG applies the inverse multi-component transform, so
// a 3-component codestream comes back interleaved RGB; 1 component is a
// greyscale band (which is what Sentinel-2 IMG_DATA files are).

const K = (bytes, at, len) => String.fromCharCode(...bytes.slice(at, at + len));

export const JP2_SIGNATURE = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a];

export function isJp2(bytes) {
  if (!bytes || bytes.length < 12) return false;
  return JP2_SIGNATURE.every((b, i) => bytes[i] === b);
}

export function isJ2kCodestream(bytes) {
  return !!bytes && bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0x4f && bytes[2] === 0xff && bytes[3] === 0x51;
}

/**
 * Walk the top-level boxes of a JP2 file. Returns the boxes, the `jp2h` header
 * fields we care about (size, component count, bit depth) and the codestream.
 */
export function readJp2Boxes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let offset = 0;
  let jp2h = null;
  let codestream = null;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = K(bytes, offset + 4, 4);
    const end = length === 0 ? bytes.length : offset + length;
    boxes.push({ type, offset, length: length === 0 ? bytes.length - offset : length });
    if (type === 'jp2c') codestream = bytes.subarray(offset + 8, end);
    if (type === 'jp2h') jp2h = bytes.subarray(offset + 8, end);
    if (length === 0) break;
    offset = end;
  }

  let header = null;
  if (jp2h) {
    // ihdr: height, width, components, bits per component (all uint32)
    const hv = new DataView(jp2h.buffer, jp2h.byteOffset, jp2h.byteLength);
    let o = 0;
    while (o + 8 <= jp2h.length) {
      const len = hv.getUint32(o);
      const type = K(jp2h, o + 4, 4);
      if (type === 'ihdr' && len >= 22) {
        header = {
          height: hv.getUint32(o + 8),
          width: hv.getUint32(o + 12),
          components: hv.getUint16(o + 16),
          bitsPerComponent: jp2h[o + 18] + 1,
          compression: jp2h[o + 19],
          isSigned: jp2h[o + 20] !== 0
        };
      }
      if (len === 0) break;
      o += len;
    }
  }

  return { boxes: boxes.map((b) => b.type), header, codestream, hasCodestream: !!codestream };
}

/**
 * Optional GML georeference inside a JP2 (`xml ` / `uuid` box). Sentinel-2
 * IMG_DATA files do not carry one — their georeference lives in the SAFE
 * metadata — but products from other providers do, and when it is there it is
 * authoritative.
 */
export function readJp2GmlBounds(bytes) {
  const sig = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const env = sig.match(/<gml:Envelope[^>]*>([\s\S]*?)<\/gml:Envelope>/i);
  if (env) {
    const lower = env[1].match(/<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/i);
    const upper = env[1].match(/<gml:upperCorner>([^<]+)<\/gml:upperCorner>/i);
    if (lower && upper) {
      const [lat1, lon1] = lower[1].trim().split(/\s+/).map(Number);
      const [lat2, lon2] = upper[1].trim().split(/\s+/).map(Number);
      if ([lat1, lon1, lat2, lon2].every(Number.isFinite)) {
        return [
          [lat1, lon1],
          [lat1, lon2],
          [lat2, lon2],
          [lat2, lon1]
        ];
      }
    }
  }
  const pos = sig.match(/<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/i);
  if (pos) {
    const nums = pos[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
    if (ring.length >= 4) return ring;
  }
  return null;
}

let decoderPromise = null;

const nodeish = () => typeof process !== 'undefined' && !!process.versions?.node;

async function loadNodeDecoder() {
  const spec = '@cornerstonejs/codec-openjpeg';
  const mod = await import(/* @vite-ignore */ spec);
  const factory = mod.default?.default || mod.default;
  const instance = await factory({ print: () => {} });
  return instance.J2KDecoder;
}

async function loadBrowserDecoder() {
  const [{ default: factory }, wasm] = await Promise.all([
    import('@cornerstonejs/codec-openjpeg/decodewasmjs'),
    import('@cornerstonejs/codec-openjpeg/decodewasm?url')
  ]);
  const instance = await factory({
    locateFile: () => wasm.default,
    print: () => {}
  });
  return instance.J2KDecoder;
}

/**
 * The decode-only wasm build is ~260 kB and is fetched on first use. In the
 * browser the bundler hands us the asset URL; under Node (scripts, tests) the
 * package finds its own wasm on disk. A jsdom test environment looks like a
 * browser but cannot fetch a bundler path, so a failed browser load falls back
 * to the on-disk package rather than reporting "corrupt file".
 */
export function loadJp2Decoder() {
  if (decoderPromise) return decoderPromise;
  decoderPromise = (async () => {
    if (nodeish() && typeof window === 'undefined') return loadNodeDecoder();
    try {
      return await loadBrowserDecoder();
    } catch (err) {
      if (nodeish()) return loadNodeDecoder();
      throw err;
    }
  })();
  decoderPromise.catch(() => {
    decoderPromise = null;
  });
  return decoderPromise;
}

/** Raw OpenJPEG decode: returns the interleaved component buffer OpenJPEG produced. */
export async function decodeJp2Raw(bytes, { decomposeLevel = 0 } = {}) {
  const container = isJp2(bytes) ? readJp2Boxes(bytes) : null;
  const codestream = container?.codestream || (isJ2kCodestream(bytes) ? bytes : null);
  if (!codestream) throw new Error('not a JPEG2000 codestream');

  const J2KDecoder = await loadJp2Decoder();
  const decoder = new J2KDecoder();
  const encoded = decoder.getEncodedBuffer(codestream.length);
  encoded.set(codestream);
  if (decomposeLevel > 0) decoder.decodeSubResolution(decomposeLevel);
  else decoder.decode();
  const frame = decoder.getFrameInfo();
  const data = decoder.getDecodedBuffer();
  return {
    width: frame.width,
    height: frame.height,
    components: frame.componentCount,
    bitsPerSample: frame.bitsPerSample,
    isSigned: frame.isSigned,
    isReversible: decoder.getIsReversible(),
    data
  };
}

/**
 * 2nd-98th percentile stretch, so a 16-bit band that only uses 8 % of its range
 * still produces a readable preview. Deterministic: no randomness, no
 * dataset-specific constants.
 *
 * It reads its samples through the same accessor the mapping is applied to.
 * The histogram used to be built from a raw typed-array view while the mapping
 * ran on signed samples shifted by +32768, so a signed codestream was stretched
 * against a histogram of different numbers.
 */
const stretchFrom = (valueAt, count, max) => {
  const hist = new Uint32Array(256);
  for (let i = 0; i < count; i += 1) hist[Math.min(255, Math.round((valueAt(i) / max) * 255))] += 1;
  const target = count * 0.02;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i];
    if (acc >= target) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i];
    if (acc >= count - target) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) return (v) => Math.round((v / max) * 255);
  return (v) => Math.round(((Math.min(255, Math.round((v / max) * 255)) - lo) / (hi - lo)) * 255);
};

/**
 * Pack a decoded frame into RGBA bytes for canvas/ImageData use.
 * 1 component -> grey, 3 -> RGB, 4 -> RGBA; >8 bit gets a percentile stretch.
 */
export function frameToRgba(frame) {
  const { width, height, components, bitsPerSample, isSigned, data } = frame;
  const px = width * height;
  const out = new Uint8ClampedArray(px * 4);
  const sixteen = bitsPerSample > 8;
  const max = sixteen ? 65535 : 255;

  const signed16 = sixteen && isSigned;
  // two's complement -> biased unsigned: flip the sign bit, do not add 32768
  // (adding overflows the top half: 0x8000 came out as 65536 and the darkest
  // sample mapped to white)
  const sample = (i) => {
    const v = data[i];
    return signed16 ? v ^ 0x8000 : v;
  };

  if (components <= 2) {
    // 1 component is grey, 2 is grey + alpha. The second plane used to fall
    // through to the RGB path, which rendered a grey/alpha pair as (grey, alpha,
    // 0) — a red-green frame with a black blue channel.
    const stride = components;
    const map = sixteen ? stretchFrom((i) => sample(i * stride), px, max) : (v) => v;
    for (let i = 0; i < px; i += 1) {
      const v = map(sixteen ? sample(i * stride) : data[i * stride]);
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] =
        components === 2 ? (sixteen ? sample(i * stride + 1) >> 8 : data[i * stride + 1]) : 255;
    }
    return out;
  }

  const planes = components;
  const source = sixteen ? new Uint16Array(data.buffer, data.byteOffset, px * planes) : data;
  const channels = planeFill(planes);
  const maps = [];
  if (sixteen) {
    for (let c = 0; c < channels; c += 1) {
      maps.push(stretchFrom((i) => sample(i * planes + c), px, max));
    }
  }
  for (let i = 0; i < px; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const raw = sixteen ? sample(i * planes + c) : source[i * planes + c];
      out[i * 4 + c] = sixteen ? maps[c](raw) : raw;
    }
    out[i * 4 + 3] =
      planes > 3 ? (sixteen ? sample(i * planes + 3) >> 8 : source[i * planes + 3]) : 255;
  }
  return out;
}

const planeFill = (planes) => Math.min(3, planes);

/** Convenience: bytes in, {width, height, rgba} out. */
export async function decodeJp2ToRgba(bytes, opts) {
  const frame = await decodeJp2Raw(bytes, opts);
  return { width: frame.width, height: frame.height, rgba: frameToRgba(frame), frame };
}
