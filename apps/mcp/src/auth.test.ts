import { describe, expect, it } from 'vitest';
import { ipv4InCidr, timingSafeEqual } from './auth';

describe('timingSafeEqual', () => {
  it('一致で true', () => {
    expect(timingSafeEqual('s3cret-abc', 's3cret-abc')).toBe(true);
  });
  it('不一致(同長)で false', () => {
    expect(timingSafeEqual('s3cret-abc', 's3cret-abX')).toBe(false);
  });
  it('長さ違いで false', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
  it('空文字同士は true だが、ガードは呼び出し側(expected 空なら拒否)', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
  it('マルチバイト(UTF-8)も比較できる', () => {
    expect(timingSafeEqual('秘密', '秘密')).toBe(true);
    expect(timingSafeEqual('秘密', '秘宝')).toBe(false);
  });
});

describe('ipv4InCidr(Anthropic outbound allowlist 用)', () => {
  it('レンジ内は true(160.79.104.0/21)', () => {
    expect(ipv4InCidr('160.79.104.5', '160.79.104.0/21')).toBe(true);
    expect(ipv4InCidr('160.79.111.255', '160.79.104.0/21')).toBe(true); // /21 上端
  });
  it('レンジ外は false', () => {
    expect(ipv4InCidr('160.79.112.0', '160.79.104.0/21')).toBe(false);
    expect(ipv4InCidr('8.8.8.8', '160.79.104.0/21')).toBe(false);
  });
  it('/32 は単一IP一致', () => {
    expect(ipv4InCidr('1.2.3.4', '1.2.3.4/32')).toBe(true);
    expect(ipv4InCidr('1.2.3.5', '1.2.3.4/32')).toBe(false);
  });
  it('/0 は全一致', () => {
    expect(ipv4InCidr('203.0.113.9', '0.0.0.0/0')).toBe(true);
  });
  it('不正入力(非IPv4・bits範囲外)は false', () => {
    expect(ipv4InCidr('not-an-ip', '160.79.104.0/21')).toBe(false);
    expect(ipv4InCidr('160.79.104.5', '160.79.104.0/33')).toBe(false);
    expect(ipv4InCidr('1.2.3.256', '1.2.3.0/24')).toBe(false); // オクテット>255
  });
});
