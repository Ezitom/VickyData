const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReferenceCode, isExpired } = require('../utils/fundingRequestUtils');

test('generateReferenceCode returns a DR- prefixed code', () => {
  const code = generateReferenceCode();
  assert.match(code, /^DR-[A-Z0-9]{5,8}$/);
});

test('isExpired flags requests older than 48 hours', () => {
  const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  assert.equal(isExpired(oldDate), true);
});

test('isExpired keeps fresh requests active', () => {
  const freshDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(isExpired(freshDate), false);
});
