const app = require('./app');
const config = require('./config');
const logger = require('./config/logger');
const db = require('./db');

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'server started');
});

const shutdown = async () => {
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);