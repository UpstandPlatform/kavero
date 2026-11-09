/**
 * IP address classification for SSRF guards (server fetches and headless Chrome).
 * Pure byte parsing, so IPv6 forms that embed an IPv4 address (mapped, NAT64,
 * 6to4) are judged by the address they actually reach. Unparseable input counts
 * as private (fail closed).
 */

function parseV4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function parseV6(s: string): number[] | null {
  let v = s.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // Trailing dotted IPv4 (::ffff:10.0.0.1) → two hex groups.
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    const b = parseV4(dotted[2]!);
    if (!b) return null;
    v = `${dotted[1]}${((b[0]! << 8) | b[1]!).toString(16)}:${((b[2]! << 8) | b[3]!).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

/** [network bytes, prefix length] */
const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16], // link-local incl. cloud metadata 169.254.169.254
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast
];

function inPrefix(bytes: number[], net: number[], bits: number): boolean {
  for (let i = 0; i < net.length && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((bytes[i]! & mask) !== (net[i]! & mask)) return false;
  }
  return true;
}

const v4Private = (b: number[]) => V4_BLOCKED.some(([net, bits]) => inPrefix(b, net, bits));

/** The IPv4 address an IPv6 address really reaches (mapped, SIIT, NAT64, 6to4), if any. */
function embeddedV4(b: number[]): number[] | null {
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return b.slice(12); // ::ffff:a.b.c.d
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && zero(10, 12)) return b.slice(12); // ::ffff:0:a.b.c.d
  if (inPrefix(b, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) return b.slice(12); // NAT64 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return b.slice(2, 6); // 6to4 2002::/16
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return v4Private(v4);
  const b = parseV6(ip);
  if (!b) return true;
  const inner = embeddedV4(b);
  if (inner) return v4Private(inner);
  // Only global unicast (2000::/3) is public; that also excludes ::, ::1, ::/96,
  // 64:ff9b:1::/48, 100::/64, fc00::/7, fe80::/10, fec0::/10 and ff00::/8.
  if ((b[0]! & 0xe0) !== 0x20) return true;
  return (
    inPrefix(b, [0x20, 0x01, 0x00, 0x00], 23) || // IETF protocol assignments incl. Teredo
    inPrefix(b, [0x20, 0x01, 0x0d, 0xb8], 32) || // documentation
    inPrefix(b, [0x3f, 0xff, 0x00, 0x00], 20) // documentation
  );
}

export function isLoopbackAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return v4[0] === 127;
  const b = parseV6(ip);
  if (!b) return false;
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;
  const inner = embeddedV4(b);
  // Mapped forms only (::ffff:127.0.0.1); NAT64 and 6to4 leave the machine.
  return !!inner && inner[0] === 127 && b[0] === 0 && b[1] === 0;
}
