const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSensitiveWords, detectGuestbookRisk } = require('../lib/guestbookModeration');

test('parses unique sensitive words from lines and commas', () => {
  assert.deepEqual(parseSensitiveWords('广告\n诈骗，广告, SPAM'), ['广告', '诈骗', 'spam']);
});

test('flags sensitive words, multiple links, repeated characters and duplicates', () => {
  const flags = detectGuestbookRisk({
    name: '广告账号',
    message: 'aaaaaaaa https://one.example https://two.example',
    sensitiveWords: ['广告'],
    duplicate: true
  });
  assert.deepEqual(flags, ['敏感词：广告', '包含 2 个链接', '包含异常连续字符', '24 小时内重复留言']);
});

test('keeps ordinary messages unflagged', () => {
  assert.deepEqual(detectGuestbookRisk({
    name: 'Alice', message: '很喜欢你的博客', sensitiveWords: ['广告'], duplicate: false
  }), []);
});
