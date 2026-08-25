export async function register() {
  // Never let startup side-effects take down serverless invocations on Vercel.
  if (process.env.NEXT_RUNTIME === 'edge') return;

  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const { boot } = require('./lib/http-handlers');
    boot();
  } catch (error) {
    console.warn('Boot skipped:', error?.message || error);
  }
}
