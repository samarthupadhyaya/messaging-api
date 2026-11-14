const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const messagesRouter = require('./routes/messages');
const healthRouter = require('./routes/health');
const webhooksRouter = require('./routes/webhooks');

const app = express();


app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    // Sirf zaroori fields log hongi, body/text nahi
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);
app.use(express.json({ limit: '100kb' }));


app.use(healthRouter);
app.use('/api/v1', messagesRouter);
app.use('/api/v1', webhooksRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
});
app.use(errorHandler);

module.exports = app;