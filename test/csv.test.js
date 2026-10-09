const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeCsv } = require('../lib/csv');

test('escapeCsv quotes cells and doubles embedded quotes', () => {
  assert.equal(escapeCsv('plain/path'), '"plain/path"');
  assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsv(null), '""');
  assert.equal(escapeCsv(1289), '"1289"');
});

test('escapeCsv neutralizes spreadsheet formula injection prefixes', () => {
  assert.equal(escapeCsv("=cmd|'/C calc'!A1"), "\"'=cmd|'/C calc'!A1\"");
  assert.equal(escapeCsv('+SUM(1,1)'), '"\'+SUM(1,1)"');
  assert.equal(escapeCsv('-2+3'), '"\'-2+3"');
  assert.equal(escapeCsv('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(escapeCsv('\t=cmd|calc'), '"\'\t=cmd|calc"');
  assert.equal(escapeCsv('\r=cmd|calc'), '"\'\r=cmd|calc"');
});

test('escapeCsv leaves mid-string operators untouched', () => {
  assert.equal(escapeCsv('/path?a=1&b=2'), '"/path?a=1&b=2"');
  assert.equal(escapeCsv('C:\\temp\\2-3'), '"C:\\temp\\2-3"');
});
