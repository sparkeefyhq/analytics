/** Versioned v2 contract. Never reuse the frozen Phase 0 v1 calculations. */
export const COHORTS = [
  'all',
  'phase-0',
  'phase-1a',
  'phase-1b',
  'phase-2',
] as const;
export type Cohort = (typeof COHORTS)[number];
export type Period = 'today' | '7d' | '30d' | 'all';
export type State =
  | 'available'
  | 'no-data'
  | 'not-connected'
  | 'not-eligible'
  | 'query-error';
export type Source =
  | 'PostHog'
  | 'Backend'
  | 'Play Console'
  | 'Manual'
  | 'Reconciled';
export type Metric = {
  value: number | null;
  numerator?: number;
  denominator?: number;
  pending?: number;
  state: State;
  source: Source;
  detail: string;
  unit?: '%' | 'USD' | 'ms' | 'seconds';
  /** Plain-language arithmetic behind an average or rate, e.g. "54 messages ÷ 7 active users". */
  basis?: string;
};
export const DAYS = [1, 3, 7, 15, 30] as const;
export type ReturnType = 'app' | 'wingman' | 'situation';
export type Capability =
  | 'activity'
  | 'app-return'
  | 'onboarding'
  | 'people'
  | 'memory'
  | 'wingman'
  | 'responses'
  | 'sessions'
  | 'foreground'
  | 'situations'
  | 'activation'
  | 'memory-reuse'
  | 'people-use'
  | 'retries'
  | 'fallbacks'
  | 'latency'
  | 'tokens'
  | 'cost'
  | 'attribution';
// Membership is explicitly reconciled, not inferred from current user properties or a reset date.
export type Member = {
  id: string;
  cohort: Exclude<Cohort, 'all'>;
  from: string;
  to?: string;
  firstOpen: string | null;
  internal: boolean;
  test: boolean;
  acquisition: 'organic' | 'referral' | 'paid' | 'founder' | 'unknown';
  intervals?: { from: string; to?: string }[];
  cohorts?: Exclude<Cohort, 'all'>[];
};
// Server-internal facts only. IDs below must be opaque; no free text is accepted or emitted.
export type Fact = {
  id: string;
  user: string;
  at: string;
  kind: string;
  internal?: boolean;
  test?: boolean;
  request?: string;
  person?: string;
  session?: string;
  situation?: string;
  people?: number;
  memories?: number;
  seconds?: number;
  latency?: number;
  input?: number;
  output?: number;
  cost?: number;
  attribution?: 'organic' | 'reminder' | 'founder' | 'unknown';
  assisted?: boolean;
};
export type Dataset = {
  mode: 'live' | 'test';
  /** Where the facts came from; stamped on every metric so tiles never claim a source they did not use. */
  source?: Source;
  state: State;
  detail: string;
  asOf: string;
  coverageFrom: string;
  members: Member[];
  facts: Fact[];
  capabilities: Capability[];
};
export type User = {
  id: string;
  cohort: Member['cohort'];
  cohorts: Member['cohort'][];
  acquisition: Member['acquisition'];
  firstOpen: string | null;
  lastActive: string | null;
  metrics: Record<string, Metric>;
  retention: Record<ReturnType, Record<string, Metric>>;
};
export type Snapshot = {
  version: 2;
  mode: Dataset['mode'];
  asOf: string;
  coverageFrom: string;
  cohort: Cohort;
  period: Period;
  state: State;
  detail: string;
  metrics: Record<string, Metric>;
  retention: Record<ReturnType, Record<string, Metric>>;
  users: User[];
  excluded: number;
};

export const missing = (
  detail: string,
  source: Source = 'PostHog',
  state: State = 'not-connected',
): Metric => ({ value: null, state, source, detail });
export const measured = (
  value: number,
  detail: string,
  source: Source = 'PostHog',
): Metric => ({ value, state: 'available', source, detail });
export function ratio(
  numerator: number,
  denominator: number,
  detail: string,
  pending = 0,
): Metric {
  return {
    value: denominator ? (numerator / denominator) * 100 : null,
    numerator,
    denominator,
    pending,
    state: denominator ? 'available' : pending ? 'not-eligible' : 'no-data',
    source: 'PostHog',
    detail,
    unit: '%',
  };
}
export const DAY = 86400000;
export function periodStart(period: Period, now: number) {
  // Fixed reporting timezone Asia/Kolkata. Retention uses elapsed UTC hours, not calendar days.
  return period === 'all'
    ? -Infinity
    : period === 'today'
      ? Math.floor((now + 19800000) / DAY) * DAY - 19800000
      : now - (period === '7d' ? 7 : 30) * DAY;
}

export function calculate(
  data: Dataset,
  cohort: Cohort,
  period: Period,
): Snapshot {
  const now = Date.parse(data.asOf),
    since = periodStart(period, now);
  const selectedMembers = data.members.filter(
    (m) =>
      !m.internal &&
      !m.test &&
      (cohort === 'all' || m.cohort === cohort) &&
      Date.parse(m.from) <= now,
  );
  // All counts a stable person once, retaining the union of allowed membership intervals.
  const grouped = new Map<string, Member>();
  for (const m of selectedMembers.sort((a, b) =>
    a.from.localeCompare(b.from),
  )) {
    const previous = grouped.get(m.id);
    if (!previous)
      grouped.set(m.id, {
        ...m,
        intervals: [{ from: m.from, to: m.to }],
        cohorts: [m.cohort],
      });
    else {
      previous.intervals!.push({ from: m.from, to: m.to });
      if (!previous.cohorts!.includes(m.cohort))
        previous.cohorts!.push(m.cohort);
      if (
        m.firstOpen &&
        (!previous.firstOpen || m.firstOpen < previous.firstOpen)
      )
        previous.firstOpen = m.firstOpen;
    }
  }
  const members = [...grouped.values()];
  const observed = members.filter(
    (m) => m.firstOpen && Date.parse(m.firstOpen) <= now,
  );
  const has = (cap: Capability) => data.capabilities.includes(cap);
  const unavailable = (cap: Capability) =>
    missing(
      data.state !== 'available'
        ? data.detail
        : `Awaiting verified ${cap} instrumentation.`,
      'PostHog',
      data.state !== 'available' ? data.state : 'not-connected',
    );
  const facts = new Map<string, Fact[]>();
  for (const m of members) {
    const dedup = new Map<string, Fact>();
    for (const f of data.facts)
      if (
        !f.internal &&
        !f.test &&
        f.user === m.id &&
        Date.parse(f.at) <= now &&
        m.intervals!.some(
          (interval) =>
            Date.parse(f.at) >= Date.parse(interval.from) &&
            (!interval.to || Date.parse(f.at) < Date.parse(interval.to)),
        )
      ) {
        // Retries do not multiply user messages. Completion/failure are reconciled separately below.
        const key =
          ['message', 'complete', 'failed'].includes(f.kind) && f.request
            ? `${f.kind}:${f.request}`
            : f.id;
        const previous = dedup.get(key);
        if (!previous || f.at < previous.at) dedup.set(key, f);
      }
    facts.set(m.id, [...dedup.values()]);
  }
  const selected = (m: Member, start = since) =>
    (facts.get(m.id) ?? []).filter((f) => Date.parse(f.at) >= start);
  const all = members.flatMap((m) => selected(m));
  const count = (cap: Capability, value: number, detail: string): Metric =>
    data.state !== 'available' || !has(cap)
      ? unavailable(cap)
      : members.length
        ? measured(value, detail)
        : missing('No members in this cohort.', 'Reconciled', 'no-data');
  const usersWith = (
    cap: Capability,
    pred: (f: Fact) => boolean,
    detail: string,
  ) => count(cap, members.filter((m) => selected(m).some(pred)).length, detail);
  const firstMilestone = (cap: Capability, kind: string) =>
    count(
      cap,
      members.filter((m) => {
        const first = (facts.get(m.id) ?? [])
          .filter((f) => f.kind === kind)
          .map((f) => Date.parse(f.at))
          .sort((a, b) => a - b)[0];
        return (
          first !== undefined &&
          first >= since &&
          m.firstOpen !== null &&
          Date.parse(m.firstOpen) >= Date.parse(data.coverageFrom)
        );
      }).length,
      `Users whose first observed ${kind} in this cohort occurred in the selected period. Requires coverage from first open.`,
    );
  const milestone = (kind: string, field: 'people' | 'memories', n: number) =>
    usersWith(
      field === 'people' ? 'people' : 'memory',
      (f) => f.kind === kind && (f[field] ?? -1) >= n,
      `Unique users with a recorded ${field} count of at least ${n} in the selected period. Not a conversion funnel.`,
    );
  const activeKinds = new Set([
    'app',
    'first_open',
    'onboarding',
    'person',
    'memory',
    'wingman',
    'message',
    'calendar',
    'situation',
  ]);
  const active = members.filter((m) =>
    selected(m).some((f) => activeKinds.has(f.kind)),
  );
  const retained = (
    type: ReturnType,
    day: number,
    population = observed,
  ): Metric => {
    const cap: Capability =
      type === 'app'
        ? 'app-return'
        : type === 'wingman'
          ? 'wingman'
          : 'situations';
    if (data.state !== 'available' || !has(cap)) return unavailable(cap);
    let eligible = 0,
      returned = 0,
      pending = 0,
      open = 0;
    for (const m of population) {
      if (!m.firstOpen) continue;
      const start = Date.parse(m.firstOpen) + day * DAY,
        end = start + DAY;
      // A closed historical cohort never acquires post-close observations.
      if (
        !m.intervals!.some(
          (interval) =>
            start >= Date.parse(interval.from) &&
            (!interval.to || end <= Date.parse(interval.to)),
        )
      )
        continue;
      // Live progress: a window counts as soon as it has started. Returns
      // observed so far inside it count immediately; a window that has not
      // started yet is pending. Closed windows are filtered by the period on
      // their end date; open windows are always current.
      if (start > now) {
        pending++;
        continue;
      }
      if (end <= now && end < since) continue; // anchor is never reset.
      if (Date.parse(m.firstOpen) < Date.parse(data.coverageFrom)) continue;
      eligible++;
      if (end > now) open++;
      if (
        (facts.get(m.id) ?? []).some(
          (f) =>
            Date.parse(f.at) >= start &&
            Date.parse(f.at) < end &&
            (type === 'app'
              ? activeKinds.has(f.kind)
              : type === 'wingman'
                ? f.kind === 'message'
                : f.kind === 'situation'),
        )
      )
        returned++;
    }
    return ratio(
      returned,
      eligible,
      `D${day}: [${day * 24}, ${(day + 1) * 24}) hours after each user's first open. Live progress: ${open} of ${eligible} windows are still open and may still convert; ${pending} users have not reached this window yet.`,
      pending,
    );
  };
  const retentionFor = (population = observed) =>
    Object.fromEntries(
      (['app', 'wingman', 'situation'] as const).map((type) => [
        type,
        Object.fromEntries(
          DAYS.map((day) => [`d${day}`, retained(type, day, population)]),
        ),
      ]),
    ) as Snapshot['retention'];
  const average = (
    cap: Capability,
    values: number[],
    detail: string,
    unitLabel?: string,
  ): Metric => {
    if (data.state !== 'available' || !has(cap)) return unavailable(cap);
    if (!values.length) return missing('No observed users.', 'PostHog', 'no-data');
    const total = values.reduce((a, b) => a + b, 0);
    const metric = count(cap, total / values.length, detail);
    return unitLabel
      ? { ...metric, basis: `${total} ${unitLabel} ÷ ${values.length} active users` }
      : metric;
  };
  const volume = (
    cap: Capability,
    kind: string,
    start: number,
    population = members.filter((m) =>
      selected(m, Math.max(since, start)).some((f) => activeKinds.has(f.kind)),
    ),
  ) =>
    average(
      cap,
      population.map(
        (m) =>
          selected(m, Math.max(since, start)).filter((f) => f.kind === kind)
            .length,
      ),
      'Total Wingman messages sent in this window divided by the number of users who did anything in the app in the same window. A user who only opened the app still counts in the denominator. The named window is intersected with the global time filter — e.g. with Time = 7D, the 30D tile also covers 7 days.',
      'messages',
    );
  const second = (m: Member, organic = false) => {
    const situations = (facts.get(m.id) ?? [])
      .filter((f) => f.kind === 'situation' && f.situation)
      .sort((a, b) => a.at.localeCompare(b.at));
    const seen = new Set<string>();
    for (const f of situations) {
      if (seen.has(f.situation!)) continue;
      seen.add(f.situation!);
      if (seen.size === 2)
        return (
          Date.parse(f.at) >= since &&
          (!organic || (f.attribution === 'organic' && f.assisted === false))
        );
    }
    return false;
  };
  const metrics: Record<string, Metric> = {
    active: count(
      'activity',
      active.length,
      'Unique users who did anything in the app in the selected period: signed up, finished onboarding, added a person, memory or event, opened Wingman, or sent a message. A signup with no further activity still counts. Background AI events are excluded.',
    ),
    activated:
      has('activation') && data.state === 'available'
        ? ratio(
            members.filter(
              (m) =>
                selected(m).some((f) => f.kind === 'onboarding') &&
                selected(m).some((f) => f.kind === 'activated'),
            ).length,
            members.filter((m) =>
              selected(m).some((f) => f.kind === 'onboarding'),
            ).length,
            'Verified meaningful activation among users who onboarded in this period; requires reconciled qualification, not just five messages.',
          )
        : unavailable('activation'),
    downloads: missing(
      'Play Console store-level downloads are not individual first opens. No store connector configured.',
      'Play Console',
    ),
    first_opens: usersWith(
      'activity',
      (f) => f.kind === 'first_open',
      'Unique first app opens in the selected period.',
    ),
    onboarded: usersWith(
      'onboarding',
      (f) => f.kind === 'onboarding',
      'Unique users completing onboarding in the selected period.',
    ),
    wingman_opened: usersWith(
      'wingman',
      (f) => f.kind === 'wingman',
      'Unique users opening Wingman in the selected period.',
    ),
    first_message: firstMilestone('wingman', 'message'),
    first_answer: firstMilestone('responses', 'complete'),
    five_messages: count(
      'wingman',
      members.filter(
        (m) => selected(m).filter((f) => f.kind === 'message').length >= 5,
      ).length,
      'Users sending at least five distinct requests in the selected period.',
    ),
    second_situation: count(
      'situations',
      members.filter((m) => second(m)).length,
      'Users whose second distinct, verified genuine situation occurred in the selected period. A message is not a situation.',
    ),
    organic_second:
      has('situations') && has('attribution')
        ? count(
            'situations',
            members.filter((m) => second(m, true)).length,
            'Second verified situation, independently initiated and positively attributed organic. Unknown attribution is excluded, not assumed organic.',
          )
        : unavailable('attribution'),
    messages_day: volume('wingman', 'message', periodStart('today', now)),
    messages_7d: volume('wingman', 'message', now - 7 * DAY),
    messages_30d: volume('wingman', 'message', now - 30 * DAY),
    sessions: average(
      'sessions',
      active.map(
        (m) =>
          new Set(
            selected(m)
              .filter((f) => f.kind === 'message' || f.kind === 'wingman')
              .map((f) => f.session)
              .filter(Boolean),
          ).size,
      ),
      'Total distinct Wingman chats opened divided by the number of active users in the selected period. A user who only opened the app still counts in the denominator. Never approximated as calendar days.',
      'chats',
    ),
    messaged: usersWith(
      'wingman',
      (f) => f.kind === 'message',
      'Users who sent at least one message to Wingman in the selected period.',
    ),
    memories_added: count(
      'memory',
      all.filter((f) => f.kind === 'memory').length,
      'Memories saved in the selected period, counted from the memories table (one per saved memory).',
    ),
    memory_users: usersWith(
      'memory',
      (f) => f.kind === 'memory',
      'Users who saved at least one memory in the selected period.',
    ),
    people_added: count(
      'people',
      all.filter((f) => f.kind === 'person').length,
      'People saved in the selected period, counted from the people table (one per saved person).',
    ),
    people_used: count(
      'people-use',
      new Set(
        all
          .filter((f) => f.kind === 'message' && f.person)
          .map((f) => `${f.user}:${f.person}`),
      ).size,
      'Distinct user/person pairs actually used with Wingman in this period.',
    ),
    people_used_2: count(
      'people-use',
      members.filter(
        (m) =>
          new Set(
            selected(m)
              .filter((f) => f.kind === 'message')
              .map((f) => f.person)
              .filter(Boolean),
          ).size >= 2,
      ).length,
      'Users who used Wingman with two or more distinct saved people in this period.',
    ),
    memory_reused: usersWith(
      'memory-reuse',
      (f) => f.kind === 'memory_reused',
      'Users with a verified later request using previously saved memory context; memory creation is not reuse.',
    ),
  };
  for (const n of [1, 2, 3, 5])
    metrics[`people_${n}`] = milestone('person', 'people', n);
  for (const n of [1, 3, 5, 20])
    metrics[`memory_${n}`] = milestone('memory', 'memories', n);
  const peak = (m: Member, field: 'people' | 'memories') =>
    Math.max(0, ...(facts.get(m.id) ?? []).map((f) => f[field] ?? 0));
  metrics.people_average = average(
    'people',
    active.map((m) => peak(m, 'people')),
    'Total people added (highest count each user reached) divided by active users in the selected period; not current inventory after deletion.',
    'people',
  );
  metrics.memory_average = average(
    'memory',
    active.map((m) => peak(m, 'memories')),
    'Total memories added (highest count each user reached) divided by active users in the selected period; not current inventory after deletion.',
    'memories',
  );
  const mem = active.map((m) => peak(m, 'memories')).sort((a, b) => a - b);
  metrics.memory_median =
    data.state !== 'available' || !has('memory')
      ? unavailable('memory')
      : mem.length
        ? count(
            'memory',
            (mem[Math.floor((mem.length - 1) / 2)] +
              mem[Math.floor(mem.length / 2)]) /
              2,
            'Median observed peak memory count among active users in the selected period.',
          )
        : missing('No observed users.', 'PostHog', 'no-data');
  // Final outcome of a request: a completion supersedes failed attempts for that same request.
  const requests = all.filter((f) => f.kind === 'message');
  const completed = all.filter((f) => f.kind === 'complete');
  const completedIds = new Set(
    completed.map((f) => `${f.user}:${f.request ?? f.id}`),
  );
  const failed = all.filter(
    (f) =>
      f.kind === 'failed' &&
      !completedIds.has(`${f.user}:${f.request ?? f.id}`),
  );
  metrics.complete = count(
    'responses',
    completed.length,
    'Wingman answers that completed successfully, counted from the AI call log (one per AI request, retries deduplicated). This is a different source from "User messages sent", which counts stored chat messages — the two are not expected to match exactly.',
  );
  metrics.failed = count(
    'responses',
    failed.length,
    'AI requests that failed and were never completed in this period. Pending requests are not failures.',
  );
  metrics.success =
    has('responses') && data.state === 'available'
      ? {
          ...ratio(
            completed.length,
            completed.length + failed.length,
            'Completed answers divided by all resolved AI requests (completed + failed). In-flight requests excluded; a late success reconciles an earlier failure.',
          ),
          basis: `${completed.length} completed ÷ ${completed.length + failed.length} resolved`,
        }
      : unavailable('responses');
  for (const [key, cap, kind] of [
    ['retries', 'retries', 'retry'],
    ['fallbacks', 'fallbacks', 'fallback'],
  ] as const)
    metrics[key] = count(
      cap,
      all.filter((f) => f.kind === kind).length,
      `Recorded ${key} events in the selected period.`,
    );
  const latencies = completed
    .map((f) => f.latency)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
  for (const [key, q] of [
    ['latency_median', 0.5],
    ['latency_p95', 0.95],
  ] as const)
    metrics[key] = !has('latency')
      ? unavailable('latency')
      : latencies.length
        ? {
            ...count(
              'latency',
              latencies[Math.max(0, Math.ceil(q * latencies.length) - 1)],
              'Nearest-rank latency over complete responses in milliseconds.',
            ),
            unit: 'ms',
          }
        : missing('No latency observations.', 'Backend', 'no-data');
  metrics.requests = count(
    'wingman',
    requests.length,
    'Messages real users actually sent to Wingman in the selected period, counted from stored chat messages (one per message, retries never counted). Reliability tiles count AI log rows instead, so they can differ.',
  );
  const usage = all.filter((f) => f.kind === 'usage');
  for (const [key, field] of [
    ['input_tokens', 'input'],
    ['output_tokens', 'output'],
    ['cost', 'cost'],
  ] as const) {
    const cap = field === 'cost' ? 'cost' : 'tokens';
    metrics[key] =
      !has(cap) || data.state !== 'available'
        ? unavailable(cap)
        : !usage.length || usage.some((f) => f[field] === undefined)
          ? missing(
              'No complete billing coverage; totals withheld.',
              'Backend',
              'no-data',
            )
          : {
              ...count(
                cap,
                usage.reduce((sum, f) => sum + (f[field] ?? 0), 0),
                'Sum over all billable usage records, including retries/failures; verified complete coverage required.',
              ),
              source: 'Backend',
              ...(field === 'cost' ? { unit: 'USD' as const } : {}),
            };
  }
  metrics.total_tokens =
    metrics.input_tokens.state === 'available' &&
    metrics.output_tokens.state === 'available'
      ? measured(
          metrics.input_tokens.value! + metrics.output_tokens.value!,
          'Input plus output tokens.',
          'Backend',
        )
      : missing(
          'Awaiting complete token telemetry.',
          'Backend',
          metrics.input_tokens.state !== 'available'
            ? metrics.input_tokens.state
            : metrics.output_tokens.state,
        );
  for (const [key, denom] of [
    ['cost_request', 'requests'],
    ['cost_active', 'active'],
    ['cost_activation', 'activated'],
    ['cost_repeater', 'organic_second'],
  ]) {
    const d =
      denom === 'activated' ? metrics[denom].numerator : metrics[denom].value;
    metrics[key] =
      metrics.cost.state === 'available' &&
      metrics[denom].state === 'available' &&
      d
        ? {
            ...measured(
              metrics.cost.value! / d,
              `Measured AI cost / ${denom.replaceAll('_', ' ')} in the same selected period.`,
              'Backend',
            ),
            unit: 'USD',
          }
        : missing(
            'Awaiting measured cost and a non-zero, verified denominator.',
            'Backend',
            metrics.cost.state !== 'available'
              ? metrics.cost.state
              : metrics[denom].state !== 'available'
                ? metrics[denom].state
                : 'no-data',
          );
  }
  const users: User[] = observed.map((m) => {
    const uf = selected(m);
    const um: Record<string, Metric> = {
      onboarding: count(
        'onboarding',
        (facts.get(m.id) ?? []).some((f) => f.kind === 'onboarding') ? 1 : 0,
        'Onboarding status as of the latest source snapshot, within cohort boundaries.',
      ),
      people: count(
        'people',
        peak(m, 'people'),
        'Observed peak people count in selected period.',
      ),
      memories: count(
        'memory',
        peak(m, 'memories'),
        'Observed peak memory count in selected period.',
      ),
      people_used: count(
        'people-use',
        new Set(
          uf
            .filter((f) => f.kind === 'message')
            .map((f) => f.person)
            .filter(Boolean),
        ).size,
        'Distinct people used with Wingman.',
      ),
      second_situation: count(
        'situations',
        second(m) ? 1 : 0,
        'Second verified situation in selected period.',
      ),
      independent: count(
        'attribution',
        uf.filter((f) => f.kind === 'message' && f.assisted === false).length,
        'Messages explicitly marked independent. Unknowns are not independent.',
      ),
      assisted: count(
        'attribution',
        uf.filter((f) => f.kind === 'message' && f.assisted === true).length,
        'Messages explicitly marked assisted.',
      ),
      messages: count(
        'wingman',
        uf.filter((f) => f.kind === 'message').length,
        'Messages this user sent to Wingman in the selected period.',
      ),
      sessions: count(
        'sessions',
        new Set(
          uf
            .filter((f) => f.kind === 'message' || f.kind === 'wingman')
            .map((f) => f.session)
            .filter(Boolean),
        ).size,
        'Distinct Wingman chats this user opened in the selected period.',
      ),
      cost: (() => {
        const usage = uf.filter((f) => f.kind === 'usage');
        return !has('cost') || data.state !== 'available'
          ? unavailable('cost')
          : usage.some((f) => f.cost === undefined)
            ? missing('No complete billing coverage for this user.', 'Backend', 'no-data')
            : {
                ...count(
                  'cost',
                  usage.reduce((sum, f) => sum + (f.cost ?? 0), 0),
                  'What the AI provider charged for every call made for this user in the selected period, retries included.',
                ),
                unit: 'USD',
              };
      })(),
    };
    for (const p of ['today', '7d', '30d'] as const) {
      const fs = selected(m, Math.max(since, periodStart(p, now)));
      um[`messages_${p}`] = count(
        'wingman',
        fs.filter((f) => f.kind === 'message').length,
        `${p} intersected with global time filter.`,
      );
      um[`sessions_${p}`] = count(
        'sessions',
        new Set(
          fs
            .filter((f) => f.kind === 'message' || f.kind === 'wingman')
            .map((f) => f.session)
            .filter(Boolean),
        ).size,
        'Distinct Wingman session IDs.',
      );
      um[`time_${p}`] = {
        ...count(
          'foreground',
          fs
            .filter((f) => f.kind === 'foreground')
            .reduce((sum, f) => sum + (f.seconds ?? 0), 0),
          'Sum of deduplicated foreground duration events; background time excluded.',
        ),
        unit: 'seconds',
      };
      um[`days_${p}`] = count(
        'activity',
        new Set(
          fs
            .filter((f) => activeKinds.has(f.kind))
            .map((f) => Math.floor((Date.parse(f.at) + 19800000) / DAY)),
        ).size,
        'Distinct active calendar days in Asia/Kolkata.',
      );
    }
    for (const a of ['organic', 'reminder', 'founder', 'unknown'])
      um[`return_${a}`] = count(
        'attribution',
        uf.filter(
          (f) =>
            f.kind === 'message' &&
            Date.parse(f.at) >= Date.parse(m.firstOpen!) + DAY &&
            (f.attribution ?? 'unknown') === a,
        ).length,
        `Return requests after the first 24 hours, attributed ${a}. This is attribution, not causal proof.`,
      );
    return {
      id: m.id,
      cohort: m.cohort,
      cohorts: m.cohorts!,
      acquisition: m.acquisition,
      firstOpen: m.firstOpen,
      lastActive:
        (facts.get(m.id) ?? [])
          .filter((f) => activeKinds.has(f.kind))
          .map((f) => f.at)
          .sort()
          .at(-1) ?? null,
      metrics: um,
      retention: retentionFor([m]),
    };
  });
  // The calculation helpers default to the original PostHog source label;
  // restamp with the dataset's real source (Backend Postgres for live data)
  // so no tile claims PostHog when PostHog was never queried.
  const restamp = (record: Record<string, Metric>) => {
    if (!data.source) return record;
    for (const key of Object.keys(record))
      if (record[key].source === 'PostHog') record[key] = { ...record[key], source: data.source };
    return record;
  };
  const restampRetention = (r: Snapshot['retention']) => {
    for (const type of Object.keys(r) as ReturnType[]) restamp(r[type]);
    return r;
  };
  for (const u of users) {
    restamp(u.metrics);
    restampRetention(u.retention);
  }
  return {
    version: 2,
    mode: data.mode,
    asOf: data.asOf,
    coverageFrom: data.coverageFrom,
    cohort,
    period,
    state: data.state,
    detail: data.detail,
    metrics: restamp(metrics),
    retention: restampRetention(retentionFor()),
    users,
    excluded: data.members.filter((m) => m.internal || m.test).length,
  };
}
