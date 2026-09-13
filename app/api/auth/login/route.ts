import { emailIsAllowed, normaliseEmail, passwordMatches, sessionCookie, EDITOR_EMAIL } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(request: Request) {
  if (!process.env.SPARKEEFY_LOGIN_PASSWORD) return Response.json({error:'Password login is disabled. This deployment is view-only.'},{status:403});
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? normaliseEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!emailIsAllowed(email) || !await passwordMatches(password)) {
      return Response.json({ error: 'That email or password is not recognised.' }, { status: 401 });
    }
    return Response.json(
      { email, canEdit: email === EDITOR_EMAIL },
      { headers: { 'Set-Cookie': await sessionCookie(email), 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'Unable to sign in. Please try again.' }, { status: 400 });
  }
}
