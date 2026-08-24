import { createRequire } from 'module';
import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const handlers = require('../../lib/http-handlers');

export function toResponse(result) {
  if (result.body != null && !result.json) {
    return new NextResponse(result.body, {
      status: result.status || 200,
      headers: result.headers || {}
    });
  }
  return NextResponse.json(result.json, { status: result.status || 200 });
}

export { handlers };
