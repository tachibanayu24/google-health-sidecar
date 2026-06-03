/**
 * MCP 認証ガードの純関数(§6.3)。index.ts から切り出してテスト可能化。
 * 一次=共有 secret の定数時間比較 / 二次=Anthropic outbound IP の CIDR allowlist。
 */

/** 定数時間比較(長さ差でも固定ステップ。タイミング攻撃で secret を漏らさない)。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** IPv4 が CIDR(例 160.79.104.0/21)に含まれるか。二次防御用の素朴判定(v6 は対象外=スキップ)。 */
export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!range || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string): number | null => {
    const p = s.split('.');
    if (p.length !== 4) return null;
    let n = 0;
    for (const o of p) {
      const v = Number(o);
      if (!Number.isInteger(v) || v < 0 || v > 255) return null;
      n = (n << 8) | v;
    }
    return n >>> 0;
  };
  const ipN = toInt(ip);
  const rN = toInt(range);
  if (ipN == null || rN == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) === (rN & mask);
}
