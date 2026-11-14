class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
const unauthorized = (msg) => new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg) => new AppError(403, 'FORBIDDEN', msg);
const notFound = (msg) => new AppError(404, 'NOT_FOUND', msg);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound };