const { unauthorized } = require('./errors');

module.exports = (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId || typeof tenantId !== 'string' || tenantId.length > 64) {
    return next(unauthorized('Missing or invalid x-tenant-id header'));
  }
  req.tenantId = tenantId.trim();
  next();
};