function parseSensitiveWords(value) {
  return [...new Set(String(value || '')
    .split(/[\n,，]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean))];
}

function detectGuestbookRisk({ name, message, sensitiveWords = [], duplicate = false }) {
  const text = `${name || ''}\n${message || ''}`;
  const normalized = text.toLowerCase();
  const flags = [];
  const matchedWords = sensitiveWords.filter((word) => normalized.includes(word));
  const links = text.match(/(?:https?:\/\/|www\.)\S+/gi) || [];

  if (matchedWords.length) flags.push(`敏感词：${matchedWords.join('、')}`);
  if (links.length >= 2) flags.push(`包含 ${links.length} 个链接`);
  if (/(.)\1{7,}/u.test(text)) flags.push('包含异常连续字符');
  if (duplicate) flags.push('24 小时内重复留言');

  return flags;
}

module.exports = { parseSensitiveWords, detectGuestbookRisk };
