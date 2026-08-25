import { handlers, toResponse } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return toResponse(await handlers.handleHls(request));
}
