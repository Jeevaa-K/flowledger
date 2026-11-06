const { PORT } = require('./src/config');
const { createApp } = require('./src/app');
const { pool, initDB } = require('./src/db');
const { startRecurringJob } = require('./src/jobs/recurring');

const app = createApp();

initDB()
  .then(() => {
    startRecurringJob();
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 FlowLedger running at http://localhost:${PORT}\n`);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received — shutting down`);
      server.close(() => pool.end().finally(() => process.exit(0)));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((e) => {
    console.error('Failed to connect to database:', e.message);
    if (/certificate/i.test(e.message)) {
      console.error('Hint: the database TLS certificate could not be verified. Set DB_SSL_CA to the provider CA, or (last resort) DB_SSL_REJECT_UNAUTHORIZED=false.');
    }
    process.exit(1);
  });
