import type { BackgroundGradient } from "./slide-background";
import { bytesToBase64 } from "./base64";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./slide-html-render";

function parseHex(color: string): [number, number, number] {
  let clean = color.trim().replace("#", "");
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerpColor(a: string, b: string, t: number): [number, number, number] {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return [
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  ];
}

function sampleGradient(gradient: BackgroundGradient, x: number, y: number): [number, number, number] {
  const stops = [...gradient.stops].sort((a, b) => a.pos - b.pos);
  if (stops.length === 0) return [255, 255, 255];
  if (stops.length === 1) return parseHex(stops[0].color);

  if (gradient.type === "radial") {
    const cx = SLIDE_WIDTH / 2;
    const cy = 0;
    const maxR = Math.hypot(SLIDE_WIDTH / 2, SLIDE_HEIGHT);
    const t = Math.min(1, Math.hypot(x - cx, y - cy) / maxR);
    return sampleStops(stops, t * 100);
  }

  const angleDeg = gradient.angle ?? 135;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfW = SLIDE_WIDTH / 2;
  const halfH = SLIDE_HEIGHT / 2;
  const nx = (x - halfW) / halfW;
  const ny = (y - halfH) / halfH;
  const projected = nx * cos + ny * sin;
  const t = (projected + 1) / 2;
  return sampleStops(stops, t * 100);
}

function sampleStops(
  stops: BackgroundGradient["stops"],
  pos: number,
): [number, number, number] {
  if (pos <= stops[0].pos) return parseHex(stops[0].color);
  const last = stops[stops.length - 1];
  if (pos >= last.pos) return parseHex(last.color);

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (pos >= a.pos && pos <= b.pos) {
      const span = b.pos - a.pos || 1;
      const t = (pos - a.pos) / span;
      return lerpColor(a.color, b.color, t);
    }
  }
  return parseHex(last.color);
}

/** Encode RGBA buffer as PNG data URI (works in Node/vitest without Electron). */
function rgbaToPngDataUri(
  width: number,
  height: number,
  rgba: Uint8Array,
): string {
  const rowSize = width * 4 + 1;
  const raw = new Uint8Array(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * rowSize + 1);
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  const crc32 = (data: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const adler32 = (data: Uint8Array): number => {
    let a = 1;
    let b = 0;
    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  };

  const deflateStored = (data: Uint8Array): Uint8Array => {
    const blocks: number[] = [0x78, 0x01];
    const chunkSize = 65535;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const remaining = data.length - offset;
      const len = Math.min(chunkSize, remaining);
      const isFinal = offset + len >= data.length ? 1 : 0;
      blocks.push(isFinal);
      blocks.push(len & 0xff, (len >> 8) & 0xff);
      blocks.push((~len) & 0xff, ((~len) >> 8) & 0xff);
      for (let i = 0; i < len; i++) blocks.push(data[offset + i]);
    }
    const adler = adler32(data);
    blocks.push((adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff);
    return new Uint8Array(blocks);
  };

  const writeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = new TextEncoder().encode(type);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const combined = new Uint8Array(4 + 4 + data.length);
    combined.set(len);
    combined.set(typeBytes, 4);
    combined.set(data, 8);
    const crc = crc32(combined.subarray(4));
    const crcBytes = new Uint8Array(4);
    new DataView(crcBytes.buffer).setUint32(0, crc);
    const out = new Uint8Array(combined.length + 4);
    out.set(combined);
    out.set(crcBytes, combined.length);
    return out;
  };

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateStored(raw);
  const parts = [
    signature,
    writeChunk("IHDR", ihdr),
    writeChunk("IDAT", compressed),
    writeChunk("IEND", new Uint8Array(0)),
  ];
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }

  const base64 = bytesToBase64(png);
  return `data:image/png;base64,${base64}`;
}

/**
 * Rasterize a structured background gradient to PNG data URI (1280×720).
 * Pure Node implementation — no Electron dependency.
 */
export function renderGradientToPng(gradient: BackgroundGradient): string {
  const width = SLIDE_WIDTH;
  const height = SLIDE_HEIGHT;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = sampleGradient(gradient, x, y);
      const idx = (y * width + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  return rgbaToPngDataUri(width, height, rgba);
}
