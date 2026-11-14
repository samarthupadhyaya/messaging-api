const pino = require('pino');
const config = require('./index');

const logger = pino({
  level: config.env === 'test' ? 'silent' : config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'body.text', 'body.to'],
});

module.exports = logger;