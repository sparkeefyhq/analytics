import { handle } from './handler';

/** Vercel Node function (Web Request/Response). vercel.json routes /api/* here. */
export const GET = (request: Request) => handle(request);
export const POST = (request: Request) => handle(request);
