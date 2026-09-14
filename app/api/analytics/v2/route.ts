import { trackerAccess } from '../../../../lib/auth';
import {
  calculate,
  COHORTS,
  type Cohort,
  type Period,
} from '../../../../lib/analytics-v2/model';
import { liveDatasetFromBackend } from '../../../../lib/analytics-v2/source-backend';
import { fixture } from '../../../../lib/analytics-v2/fixture';

export async function GET(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV === 'production')
    return Response.json({ error: 'V2 is preview-only.' }, { status: 503 });
  const url = new URL(request.url);
  const cohort = url.searchParams.get('cohort') || 'all',
    period = url.searchParams.get('period') || 'all';
  const users = url.searchParams.get('view') === 'users';
  if (
    !COHORTS.includes(cohort as Cohort) ||
    !['today', '7d', '30d', 'all'].includes(period)
  )
    return Response.json({ error: 'Invalid filter' }, { status: 400 });
  const synthetic = url.searchParams.get('dataset') === 'test';
  if (
    synthetic &&
    !(
      process.env.VERCEL_ENV === 'preview' ||
      process.env.CONTROL_V2_LOCAL_TEST === 'true'
    )
  )
    return Response.json({ error: 'Test data disabled' }, { status: 403 });
  // Synthetic records are public only in explicitly isolated preview. Real investigation remains private.
  if (users && !synthetic && !(await trackerAccess(request)).canEdit)
    return Response.json({ error: 'Admin sign-in required' }, { status: 403 });
  const result = calculate(
    synthetic ? fixture() : await liveDatasetFromBackend(),
    cohort as Cohort,
    period as Period,
  );
  return Response.json(
    { ...result, users: users ? result.users : [] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
