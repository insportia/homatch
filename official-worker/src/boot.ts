process.on('uncaughtException', (error) => {
  console.error('[boot] uncaughtException', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[boot] unhandledRejection', reason);
  process.exit(1);
});

console.log('[boot] loading Homatch official worker');

import('./index.js').catch((error) => {
  console.error('[boot] failed to import worker', error);
  process.exit(1);
});
