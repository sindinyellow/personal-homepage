/**
 * 估算中文 + 英文混排内容的阅读时间（约 350 字/分钟）
 */
export function calcReadingTime(body: string | undefined): number {
  const text = body ?? '';
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishWords = (text.replace(/[一-鿿]/g, ' ').match(/[a-zA-Z]+/g) || []).length;
  return Math.max(1, Math.ceil((chineseChars + englishWords) / 350));
}
