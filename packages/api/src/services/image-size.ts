/**
 * Width/height of PNG, JPEG, GIF and WebP images from their headers (no
 * decoding, no native dependency). Returns null for unknown formats.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength;
  // PNG: IHDR right after the signature.
  if (n >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(12) === 0x49484452) {
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  // GIF
  if (n >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
  }
  // WebP (RIFF....WEBP)
  if (n >= 30 && v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) {
    const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (chunk === "VP8 ") return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const b = v.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width: w, height: h };
    }
  }
  // JPEG: walk segments to a start-of-frame marker.
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = v.getUint16(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
