const knex = require('knex');
const knexfile = require('../knexfile');

module.exports = async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Tests must run with NODE_ENV=test (use npm test)');
  }
  const db = knex(knexfile.test);
  await db.migrate.latest();
  await db.destroy();
};