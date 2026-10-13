import { startPublisher } from './runtime.mjs';
// No portal adapter is enabled until its independent permission and operation tests pass.
try {
  const worker = await startPublisher();
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void worker.close().then(() => process.exit(0));
    });
} catch {
  console.error('PUBLISHER_STARTUP_FAILED');
  process.exitCode = 1;
}
