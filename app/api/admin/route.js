import { handlers, toResponse } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return toResponse(await handlers.handleAdminGet(request));
}

export async function POST(request) {
  return toResponse(await handlers.handleAdminPost(request));
}
