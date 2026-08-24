import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { boot } = require('./lib/http-handlers');

export async function register() {
  boot();
}
