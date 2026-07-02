const crypto = require('crypto');

const generateReferenceCode = (prefix = 'DR') => {
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${randomPart}`;
};

const isExpired = (createdAt, expiryHours = 48) => {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const expiryAt = new Date(created.getTime() + expiryHours * 60 * 60 * 1000);
  return new Date() > expiryAt;
};

module.exports = {
  generateReferenceCode,
  isExpired
};
