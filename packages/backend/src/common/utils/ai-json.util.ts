import { BadGatewayException } from '@nestjs/common';

export function parseAiJson<T>(output: string, label = 'AI'): T {
  const text = (output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const candidates = [text];
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 尝试下一个候选片段
    }
  }
  throw new BadGatewayException(`${label} 返回内容不是有效 JSON，请重试`);
}
