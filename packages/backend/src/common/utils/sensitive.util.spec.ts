import { sensitiveUtil } from './sensitive.util';

describe('SensitiveUtil', () => {
  it('loads and expands the real word library to 80000+ detection patterns', () => {
    expect(sensitiveUtil.size).toBeGreaterThan(80000);
  });

  it('detects a common asterisk obfuscation', () => {
    expect(sensitiveUtil.check('习*近平').hit).toBe(true);
  });

  it('detects sensitive word hit', () => {
    const r = sensitiveUtil.check('这段文字包含习近平的内容');
    expect(r.hit).toBe(true);
    expect(r.words.length).toBeGreaterThan(0);
  });

  it('check returns words array when hit', () => {
    const r = sensitiveUtil.check('习近平');
    if (r.hit) {
      expect(Array.isArray(r.words)).toBe(true);
      expect(r.words.length).toBeGreaterThan(0);
    }
  });

  it('check result has hit and words fields', () => {
    const r = sensitiveUtil.check('毛泽东');
    expect(r).toHaveProperty('hit');
    expect(r).toHaveProperty('words');
    expect(Array.isArray(r.words)).toBe(true);
  });

  it('does not flag an ambiguous word inside an approved business phrase', () => {
    expect(sensitiveUtil.check('门窗方案独立编写用于产品验收').hit).toBe(false);
    expect(sensitiveUtil.check('完成处理后记录检测结果').hit).toBe(false);
    expect(sensitiveUtil.check('台湾独立').hit).toBe(true);
    expect(sensitiveUtil.check('参与赌博诈骗活动').hit).toBe(true);
  });
});
