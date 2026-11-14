require('dotenv').config();

const base = {
  client: 'pg',
  migrations: { directory: './migrations' },
};

module.exports = {
  development: { ...base, connection: process.env.DATABASE_URL },
  test: { ...base, connection: process.env.TEST_DATABASE_URL },
  production: { ...base, connection: process.env.DATABASE_URL },
};