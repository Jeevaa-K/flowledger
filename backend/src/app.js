const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { isProd } = require('./config');
const {
  securityHeaders, corsMiddleware, originGuard, apiLimiter, aiLimiter
} = require('./middleware/security');

function createApp() {
  const app = express();

  // Behind Render's proxy, trust one hop so rate limiting sees real client IPs.
  if (isProd) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(originGuard);
  app.use(cookieParser());

  // 100kb global json limit; 10MB only on receipt scan route for image uploads
  const standardJson = express.json({ limit: '100kb' });
  const receiptJson = express.json({ limit: '10mb' });
  app.use((req, res, next) => {
    if (req.path === '/api/ai/scan-receipt') {
      return receiptJson(req, res, next);
    }
    standardJson(req, res, next);
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/', apiLimiter);
  app.use('/api/ai', aiLimiter);

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
  app.get('/sw.js', (req, res) => {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendPath, 'sw.js'));
  });
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(path.join(frontendPath, 'manifest.json'));
  });
  app.get('/favicon.png', (req, res) => {
    res.sendFile(path.join(frontendPath, 'favicon.png'));
  });
  app.get('/favicon.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(path.join(frontendPath, 'favicon.svg'));
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
