import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SAMPLE_WORDS = [
  '最', '第一', '国家级', '世界级', '顶级', '极品', '万能', '包治百病',
  '绝对', '百分之百', '零风险', '稳赚', '暴利', '立刻赚钱',
  '违禁', '诈骗', '赌博', '色情', '毒品',
  '最低价', '史上最低', '永久免费', '无敌', '销量第一',
];
const SHORT_BLOCKLIST = new Set(SAMPLE_WORDS.filter((word) => Array.from(word).length === 2));

// The upstream word library contains ambiguous short entries such as “独立”.
// Keep common manufacturing/content phrases usable while still matching the
// sensitive term in every other context (for example “台湾独立”).
const SAFE_CONTEXTS = ['独立编写', '独立设计', '独立开发', '独立站'];

const WORDS_FILE = join(__dirname, '..', '..', '..', 'prisma', 'data', 'sensitive-words.txt');

export class SensitiveUtil {
  private trie: Record<string, unknown> = {};
  private loaded = false;
  private wordCount = 0;

  load(words?: string[]) {
    if (this.loaded) return;
    const source: string[] = words || this.loadFromFile();
    for (const word of source) {
      // Short entries in third-party lists (for example “团”, “完成” or “处理”)
      // are too ambiguous for substring blocking. Two-character terms are
      // retained only when they are in the curated high-risk/ad-law list.
      const length = Array.from(word).length;
      if (!word || length < 2 || (length === 2 && !SHORT_BLOCKLIST.has(word))) continue;
      // 同时覆盖常见的星号规避写法，内置 5.1 万基础词扩展为 10 万+ 检测模式。
      const variants = word.length >= 2 ? [word, `${word[0]}*${word.slice(1)}`] : [word];
      for (const variant of variants) {
        let node = this.trie;
        for (const ch of variant) {
          node[ch] = (node[ch] as Record<string, unknown>) || {};
          node = node[ch] as Record<string, unknown>;
        }
        if (!node['$']) {
          node['$'] = true;
          this.wordCount++;
        }
      }
    }
    this.loaded = true;
  }

  private loadFromFile(): string[] {
    try {
      if (existsSync(WORDS_FILE)) {
        const content = readFileSync(WORDS_FILE, 'utf-8');
        const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
        return lines;
      }
    } catch (error) {
      throw new Error(`敏感词库读取失败：${(error as Error).message}`);
    }
    throw new Error(`敏感词库不存在：${WORDS_FILE}`);
  }

  get size() {
    this.load();
    return this.wordCount;
  }

  check(text: string): { hit: boolean; words: string[] } {
    this.load();
    const found = new Set<string>();
    for (let i = 0; i < text.length; i++) {
      let node = this.trie;
      let j = i;
      let lastMatch = '';
      while (node[text[j]] !== undefined) {
        node = node[text[j]] as Record<string, unknown>;
        j++;
        if (node['$']) {
          lastMatch = text.slice(i, j);
        }
      }
      if (lastMatch) {
        const matchEnd = i + lastMatch.length;
        const insideSafeContext = SAFE_CONTEXTS.some((phrase) => {
          let start = text.indexOf(phrase);
          while (start >= 0) {
            if (i >= start && matchEnd <= start + phrase.length) return true;
            start = text.indexOf(phrase, start + 1);
          }
          return false;
        });
        if (!insideSafeContext) found.add(lastMatch);
      }
    }
    return { hit: found.size > 0, words: Array.from(found) };
  }
}

export const sensitiveUtil = new SensitiveUtil();
