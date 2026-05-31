/**
 * ULID(時刻順ソート可能なID)。外部依存なし、Web Crypto を使用(Workers/Node20+対応)。
 * クライアント発番の冪等キーにも使う(§9.8 オフラインアウトボックス)。
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(nowMs: number): string {
  let mod: number;
  let str = '';
  let t = nowMs;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    mod = t % ENCODING_LEN;
    str = ENCODING[mod] + str;
    t = (t - mod) / ENCODING_LEN;
  }
  return str;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let str = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[bytes[i]! % ENCODING_LEN];
  }
  return str;
}

/** 26文字の ULID。nowMs を渡せばテスト可能(既定 Date.now)。 */
export function ulid(nowMs: number = Date.now()): string {
  return encodeTime(nowMs) + encodeRandom();
}
