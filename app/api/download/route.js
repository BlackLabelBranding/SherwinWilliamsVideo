import { handlers, toResponse } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  return toResponse(await handlers.handleDownload(request));
}
