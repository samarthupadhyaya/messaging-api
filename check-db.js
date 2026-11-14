require('dotenv').config();
const knex = require('knex')(require('./knexfile').development);

knex.raw('SELECT 1 AS ok')
  .then((r) => console.log('DB connected:', r.rows))
  .catch((e) => console.error('DB error:', e.message))
  .finally(() => knex.destroy());