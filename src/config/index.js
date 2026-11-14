require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  databaseUrl: env === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL,
};