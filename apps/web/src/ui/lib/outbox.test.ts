import { describe, expect, it } from 'vitest';
import { classifyFlush } from './outbox';

// §9.8: 恒久失敗(4xx/上限超)は破棄せず failed として保持する分類の回帰ガード。
describe('classifyFlush', () => {
  it('2xx は sent(削除)', () => {
    expect(classifyFlush(200, 1)).toBe('sent');
    expect(classifyFlush(204, 3)).toBe('sent');
  });

  it('4xx は捨てずに failed(恒久=不正入力/認証切れ。authoring の真実を残す)', () => {
    expect(classifyFlush(400, 1)).toBe('failed');
    expect(classifyFlush(401, 1)).toBe('failed');
    expect(classifyFlush(403, 1)).toBe('failed');
    expect(classifyFlush(409, 1)).toBe('failed');
  });

  it('5xx は上限内なら retry(次回再送)', () => {
    expect(classifyFlush(500, 1)).toBe('retry');
    expect(classifyFlush(503, 4)).toBe('retry');
  });

  it('5xx でも MAX_ATTEMPTS(5)到達で failed に固定(無限ループ防止だが破棄はしない)', () => {
    expect(classifyFlush(500, 5)).toBe('failed');
    expect(classifyFlush(502, 6)).toBe('failed');
  });
});
