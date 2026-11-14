const { unauthorized } = require('./errors');

// ASSUMPTION: x-tenant-id header = authenticated tenant.
// Real system mein ye JWT / API key se aata.
module.exports = (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId || typeof tenantId !== 'string' || tenantId.length > 64) {
    return next(unauthorized('Missing or invalid x-tenant-id header'));
  }
  req.tenantId = tenantId.trim();
  next();
};