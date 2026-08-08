// Generates icon-192.png and icon-512.png from scratch using only Node built-ins
// Matches the existing icon.svg design: dark rounded square + white chat bubble + 3 dots
'use strict';
const zlib = require('zlib');
const fs = require('fs');

// ── CRC32 ──────────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG encoder ────────────────────────────────────────────────────────────
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(combined) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, getRGBA) {
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getRGBA(x, y);
      const o = y * rowBytes + 1 + x * 4;
      raw[o] = r; raw[o+1] = g; raw[o+2] = b; raw[o+3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Icon pixel function ────────────────────────────────────────────────────
// SVG viewBox 0 0 512 512 — scale all coords to target size
function iconPixel(size) {
  const S = size / 512;
  const cx = size / 2, cy = size / 2;
  const bgR = 112 * S;       // rounded corner radius of background rect

  // Chat bubble bounds (from SVG path M136 154 h240 c34,34 v116 c34,-34 h-106 l-70,56 v-56 h-28 c-34,-34 v-116)
  const bL = 136*S, bT = 154*S, bR = 376*S, bB = 304*S;
  const br = 34*S; // bubble corner radius

  // Dots
  const dotsX = [202*S, 256*S, 310*S];
  const dotY = 246*S, dotR = 18*S;

  // Tail of bubble: triangle roughly from (234*S, 304*S) to (164*S, 360*S) back to (234*S, 304*S)
  const tailX1 = 164*S, tailY1 = 360*S;
  const tailX2 = 234*S, tailY2 = 304*S;

  return (px, py) => {
    // Rounded background
    const ddx = Math.max(0, Math.abs(px - cx) - (cx - bgR));
    const ddy = Math.max(0, Math.abs(py - cy) - (cy - bgR));
    if (ddx*ddx + ddy*ddy > bgR*bgR) return [0,0,0,0]; // transparent outside

    // Bubble body (rounded rect approximation)
    const inBubbleRect = px >= bL && px <= bR && py >= bT && py <= bB;
    // simple corner rounding for bubble
    let inBubble = false;
    if (inBubbleRect) {
      const cl = bL + br, cr = bR - br, ct = bT + br, cb = bB - br;
      const inCorner =
        (px < cl && py < ct) ? ((px-cl)**2+(py-ct)**2 > br*br) :
        (px > cr && py < ct) ? ((px-cr)**2+(py-ct)**2 > br*br) :
        (px < cl && py > cb) ? ((px-cl)**2+(py-cb)**2 > br*br) :
        (px > cr && py > cb) ? ((px-cr)**2+(py-cb)**2 > br*br) : false;
      inBubble = !inCorner;
    }

    // Bubble tail (simple triangle test)
    // tail from (164*S, 360*S) up-right to (234*S, 304*S) then right to (234*S, 360*S)
    if (!inBubble && px >= tailX1 && px <= tailX2 && py >= tailY2 && py <= tailY1) {
      // slope of left edge of tail
      const slopeX = tailX2 - tailX1;
      const slopeY = tailY2 - tailY1; // negative
      const cross = (px - tailX1) * slopeY - (py - tailY1) * slopeX;
      if (cross <= 0) inBubble = true;
    }

    if (inBubble) {
      // Check dots
      for (const dx of dotsX) {
        if ((px-dx)**2 + (py-dotY)**2 <= dotR*dotR) return [17,17,17,255];
      }
      return [255,255,255,255]; // white bubble
    }

    return [17,17,17,255]; // dark background
  };
}

// ── Generate ───────────────────────────────────────────────────────────────
for (const size of [192, 512]) {
  const pixel = iconPixel(size);
  const png = encodePNG(size, size, pixel);
  const out = `icon-${size}.png`;
  fs.writeFileSync(out, png);
  console.log(`✓ ${out}  (${(png.length/1024).toFixed(1)} KB)`);
}
