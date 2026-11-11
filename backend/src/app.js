const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { isProd } = require('./config');
const {
  securityHeaders, corsMiddleware, originGuard, apiLimiter
} = require('./middleware/security');

function createApp() {
  const app = express();

  // Behind Render's proxy, trust one hop so rate limiting sees real client IPs.
  if (isProd) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(originGuard);
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' })); // receipt images arrive as base64

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/', apiLimiter);

  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/transactions'));
  app.use('/api', require('./routes/budgets'));
  app.use('/api', require('./routes/goals'));
  app.use('/api', require('./routes/accounts'));
  app.use('/api', require('./routes/tags'));
  app.use('/api', require('./routes/recurring'));
  app.use('/api', require('./routes/aiChat'));
  app.use('/api', require('./routes/aiTools'));
  app.use('/api', require('./routes/groups'));
  app.use('/api', require('./routes/reports'));
  app.use('/api', require('./routes/currencies'));

  // Unknown API paths must answer JSON, not the SPA's index.html.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  const frontendPath = path.join(__dirname, '..', '..', 'frontend');
  app.get('/favicon.png', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="24" fill="#6366f1"/><text y="130" font-size="80" font-family="Arial" font-weight="bold" text-anchor="middle" x="96" fill="white">FL</text></svg>`);
  });
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
