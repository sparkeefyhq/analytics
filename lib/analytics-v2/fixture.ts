import { DAY, type Dataset, type Fact } from './model';

/** Explicit synthetic QA data. Not imported by the browser and never served in production. */
export function fixture(now = Date.now()): Dataset {
  const iso = (n: number) => new Date(n).toISOString();
  const data: Dataset = {
    mode: 'test',
    state: 'available',
    detail: 'Synthetic preview data · not Phase 0 results',
    asOf: iso(now),
    coverageFrom: iso(now - 90 * DAY),
    members: [],
    facts: [],
    capabilities: [
      'activity',
      'app-return',
      'onboarding',
      'people',
      'memory',
      'wingman',
      'responses',
      'sessions',
      'foreground',
      'situations',
      'activation',
      'memory-reuse',
      'people-use',
      'retries',
      'fallbacks',
      'latency',
      'tokens',
      'cost',
      'attribution',
    ],
  };
  const ages = [45, 34, 20, 10, 5, 2.5, 0.5];
  for (let i = 0; i < ages.length; i++) {
    const id = `participant-${String(i + 1).padStart(3, '0')}`,
      first = now - ages[i] * DAY;
    data.members.push({
      id,
      cohort: i < 4 ? 'phase-0' : i < 6 ? 'phase-1a' : 'phase-1b',
      from: iso(first),
      firstOpen: iso(first),
      internal: false,
      test: false,
      acquisition: i % 2 ? 'referral' : 'organic',
    });
    let sequence = 0;
    const add = (offset: number, kind: string, extra: Partial<Fact> = {}) => {
      if (first + offset * DAY <= now)
        data.facts.push({
          id: `${id}-${sequence++}`,
          user: id,
          at: iso(first + offset * DAY),
          kind,
          ...extra,
        });
    };
    add(0, 'first_open');
    add(0.01, 'onboarding');
    add(0.03, 'person', { people: [5, 3, 2, 1, 5, 2, 1][i] });
    add(0.04, 'memory', { memories: [20, 5, 3, 1, 5, 1, 0][i] });
    if (i % 2 === 0) add(0.05, 'activated');
    for (const day of [0, 1, 3, 7, 15, 30]) {
      if (day && i % 3 === 1) continue;
      add(day + 0.1, 'app');
      add(day + 0.1, 'wingman', { session: `s-${i}-${day}` });
      add(day + 0.2, 'foreground', { seconds: 180 + i * 17 });
      for (let msg = 0; msg < (i % 2 ? 2 : 6); msg++) {
        const request = `r-${i}-${day}-${msg}`;
        add(day + 0.11 + msg * 0.001, 'message', {
          request,
          session: `s-${i}-${day}`,
          person: `person-${msg % 2}`,
          assisted: i === 2,
          attribution: i === 2 ? 'founder' : 'organic',
        });
        add(
          day + 0.112 + msg * 0.001,
          msg === 1 && i === 3 ? 'failed' : 'complete',
          {
            request,
            latency: 600 + msg * 100,
            input: 100,
            output: 50,
            cost: 0.002,
          },
        );
        add(day + 0.112 + msg * 0.001, 'usage', {
          request,
          input: 100,
          output: 50,
          cost: 0.002,
        });
      }
      add(day + 0.12, 'situation', {
        situation: `situation-${i}-${day}`,
        assisted: false,
        attribution: i === 2 ? 'founder' : 'organic',
      });
      if (day > 0) add(day + 0.13, 'memory_reused');
    }
    // Recent product activity makes today/7D/30D filters visibly different.
    add(ages[i] - 0.1, 'app');
    add(ages[i] - 0.09, 'wingman', { session: `recent-${i}` });
    add(ages[i] - 0.08, 'message', {
      request: `recent-r-${i}`,
      session: `recent-${i}`,
      person: 'person-0',
      attribution: 'organic',
      assisted: false,
    });
    add(ages[i] - 0.079, 'complete', {
      request: `recent-r-${i}`,
      latency: 1200,
      input: 200,
      output: 80,
      cost: 0.004,
    });
    add(ages[i] - 0.079, 'usage', {
      request: `recent-r-${i}`,
      input: 200,
      output: 80,
      cost: 0.004,
    });
  }
  // Explicitly excluded internal/test records exercise the same production exclusion path.
  data.members.push(
    { ...data.members[0], id: 'excluded-internal', internal: true },
    { ...data.members[0], id: 'excluded-test', test: true },
  );
  data.facts.push({
    id: 'excluded-message',
    user: 'excluded-internal',
    at: iso(now - 1000),
    kind: 'message',
    request: 'excluded',
  });
  return data;
}
