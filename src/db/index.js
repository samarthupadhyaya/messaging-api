const knex = require('knex');
const knexfile = require('../../knexfile');
const config = require('../config');

const db = knex(knexfile[config.env] || knexfile.development);

module.exports = db;