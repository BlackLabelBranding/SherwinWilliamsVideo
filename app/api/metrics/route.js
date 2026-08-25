import { handlers, toResponse } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  return toResponse(await handlers.handleMetrics(request));
}
