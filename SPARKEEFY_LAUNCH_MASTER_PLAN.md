# Sparkeefy Android V3 — Launch Master Plan

## What this launch is for

This is **not** a broad marketing launch. Android V3 exists to answer one question: **do people naturally come back to Wingman when a real relationship situation appears?**

The first objective is evidence of product pull, not downloads. Do not run broad paid marketing or high-reach teaser campaigns before the product earns the next cohort. Android-only is acceptable during validation because this is a learning release, not the public brand moment.

## North-star definitions

- **Eligible user:** completed onboarding and had enough opportunity to use the product.
- **Activated user:** completed onboarding and had one meaningful Wingman session (a real situation, not a test prompt).
- **Meaningful retained user:** returns and starts another meaningful Wingman session in the stated window.
- **Second-situation rate:** activated users who return with a separate real situation, not merely continue the first chat.
- **Organic repeat session:** a repeat session not caused by a founder reminder or a proactive product notification.
- **First-answer usefulness:** users rating the first useful response positively, or confirming it helped in an interview.

Track every metric by cohort, date of install, acquisition source, Android device/version, and notification/control group when applicable. Do not blend cohorts to make retention look healthier.

## Operating principles

1. **Earn each next cohort.** No phase advances because a calendar says so.
2. **Measure organic pull before notifications.** Notifications can improve a good loop; they must not conceal a weak one.
3. **One learning loop at a time.** Keep features and acquisition channels controlled enough to know what changed.
4. **Founder conversations are product work.** Weekends are for user calls, evidence review and sharp follow-up changes—not random feature expansion.
5. **Protect trust.** Relationship guidance, memory and notifications require privacy, clarity and restraint. Any critical trust/safety issue blocks progression.

## Phase 0 — Power-user release candidate

**Cohort:** 10–15 people  
**Duration:** 3–5 days  
**Purpose:** prove the complete Android journey works before asking strangers to trust it.

### Product in scope

- Wingman V3
- analytics verified end-to-end
- essential transactional notifications only
- Spark Meter hidden
- no proactive relationship nudges

### Go / no-go metrics

| Metric | Gate |
|---|---:|
| Onboarding completion | ≥80% |
| Activation | ≥70% |
| D1 meaningful retention | ≥40% |
| Returned on another day | ≥40% |
| First-answer usefulness | ≥75% |
| Successful AI responses | ≥98% |
| Crash-free sessions | ≥99% |
| Context-leakage incidents | 0 |

### Required accomplishments

- Full Android journey tested end-to-end
- All release-blocking bugs fixed
- No critical privacy, trust or safety failure

### Founder operating rhythm

- Personally watch onboarding and first Wingman session for every user where possible.
- Ask: “What was happening right before you opened it?” and “What did you do after its answer?”
- Fix only the top repeated friction; do not add Spark Meter or notification automation yet.

## Phase 1 — Organic Wingman baseline

**Cohort:** 30 users  
**Duration:** 7 days  
**Purpose:** establish whether Wingman has natural repeat value without proactive nudges.

### Product in scope

- Wingman V3
- person-specific memory
- no proactive notifications
- Spark Meter hidden

### Go / no-go metrics

| Metric | Gate |
|---|---:|
| Onboarding completion | ≥80% |
| Activation | ≥70% |
| D1 meaningful retention | ≥40% |
| D7 exact meaningful retention | ≥20% |
| W1 meaningful retention | ≥45% |
| Second-situation rate | ≥30% |
| First-answer usefulness | ≥75% |
| Memory correctness | ≥90% |

### Required accomplishments

- 8+ user interviews completed
- No founder reminders counted as organic returns
- No critical trust, privacy or safety failure

### Decision

- **Pass:** build the notification MVP; Wingman has a credible baseline.
- **Miss activation:** fix onboarding, positioning and first-session value before adding anything.
- **Miss repeat use:** diagnose the moment after the answer. Is the advice generic, wrong, difficult to act on, or simply not needed again?

## Phase 2 — Notification MVP

**Cohort:** 70 users  
**Duration:** 14 days  
**Purpose:** learn whether contextual follow-ups create additional meaningful usage without becoming spam.

### Product in scope

- Wingman V3 and memory
- consent-based contextual follow-ups
- notification holdout/control group
- deep links into the relevant situation
- Spark Meter hidden

### Initial notification design

Notifications must be specific, earned and useful. Examples of situations:

- User discussed sending a message: offer a short check-in after the time they chose.
- User mentioned a date/event: follow up after it, only with explicit consent or a clear expectation.
- User created an action: prompt them to reflect or take the next step.
- User has not returned after a high-intent situation: one respectful re-entry prompt, never a guilt trip.

Do not show private relationship context on the lock screen. Let users control frequency, pause categories, and turn off nudges easily.

### Go / no-go metrics

| Metric | Gate |
|---|---:|
| Activation | ≥70% |
| D1 meaningful retention | ≥40% |
| D7 exact meaningful retention | ≥20% |
| Control W1 retention | ≥40% |
| Overall W1 retention | ≥45% |
| W2 meaningful retention | ≥35% |
| Second-situation rate | ≥35% |
| 3+ active days in 14 days | ≥25% |
| Notification → meaningful session | ≥30% |
| Retention lift vs control | ≥8 percentage points |
| Notification disable rate | ≤5% |
| Negative notification feedback | ≤5% |

### Required accomplishments

- Eligible users randomly split between control and notification groups
- Every notification deep-links to a relevant screen
- No sensitive lock-screen disclosure

### Decision

- **Pass:** notifications are a useful multiplier, not a replacement for Wingman.
- **Miss lift:** reduce frequency, improve trigger quality and test copy. Do not add more notification volume.
- **High disable/negative feedback:** pause the offending trigger and interview users immediately.

## Phase 3 — Spark Meter beta

**Cohort:** 150 users  
**Duration:** 21 days  
**Purpose:** test whether Spark Meter makes the relationship feel like an ongoing, valuable loop rather than a one-off tool.

### Product in scope

- Spark Meter beta for 50–75 eligible users only
- weekly Spark Plan
- proven notification patterns
- matched holdout group

### Product rules

- Show Spark Meter only where there is sufficient user-provided context.
- Present it as a helpful reflection and action layer, never as a scientific relationship score.
- Avoid high-confidence claims or harmful prescriptive advice.
- Pair every state with a clear, small next action.

### Go / no-go metrics

| Metric | Gate |
|---|---:|
| Activation | ≥70% |
| D1 meaningful retention | ≥40% |
| D7 exact meaningful retention | ≥20% |
| W1 meaningful retention | ≥45% |
| W2 meaningful retention | ≥35% |
| W3 meaningful retention | ≥30% |
| Second-situation rate | ≥35% |
| 3+ active days in 14 days | ≥30% |
| Spark Meter view rate | ≥60% |
| State comprehension | ≥85% |
| Perceived accuracy/usefulness | ≥70% |
| Weekly plan creation | ≥50% |
| Recommended action started | ≥40% |
| Recommended action completed | ≥25% |
| Spark → Wingman session | ≥30% |
| Retention lift vs holdout | ≥8 percentage points |
| Negative Spark Meter feedback | ≤5% |

### Required accomplishments

- Spark Meter only appears with adequate context
- No fake certainty or pseudo-scientific scoring
- Zero harmful high-confidence relationship claims

## Phase 4 — Complete Sparkeefy loop

**Cohort:** 250 users  
**Duration:** 30 days  
**Purpose:** validate the integrated loop: Wingman + memory + Spark Meter + weekly plan + thoughtful follow-up.

### Go / no-go metrics

| Metric | Gate |
|---|---:|
| Onboarding completion | ≥80% |
| Activation | ≥70% |
| D1 meaningful retention | ≥40% |
| D7 exact meaningful retention | ≥20% |
| W1 meaningful retention | ≥45% |
| W2 meaningful retention | ≥35% |
| W4 meaningful retention | ≥28% |
| Second-situation rate | ≥40% |
| 3+ active days in 14 days | ≥30% |
| Problem-to-Wingman rate | ≥50% |
| Organic share of repeat sessions | ≥60% |
| Memory differentiation | ≥60% |
| “Very disappointed if removed” | ≥40% |
| Crash-free sessions | ≥99.5% |
| Successful Wingman responses | ≥99% |
| Critical context/privacy incidents | 0 |

### Required accomplishments

- 40+ qualified PMF survey responses
- Retention reviewed by acquisition source
- No critical trust, privacy or safety failure

## Phase 5 — Android soft launch

**Cohort:** 1,000 Android users  
**Duration:** 4–6 weeks  
**Purpose:** see whether pull survives beyond founder-connected and hand-picked testers.

### Product and distribution scope

- complete loop
- controlled communities and campus/creator networks
- every acquisition channel tagged
- no broad paid acquisition until W4 data matures

### Go / no-go metrics

| Metric | Gate |
|---|---:|
| Onboarding completion | ≥75% |
| Activation | ≥65% |
| D1 meaningful retention | ≥35% |
| D7 exact meaningful retention | ≥18% |
| W1 meaningful retention | ≥40% |
| W2 meaningful retention | ≥30% |
| W4 meaningful retention | ≥25% |
| Second-situation rate | ≥35% |
| Problem-to-Wingman rate | ≥40% |
| Organic share of repeat sessions | ≥60% |
| Referral/invite intent | ≥15% |

### Required accomplishments

- Success holds in at least two channels
- No material cohort-to-cohort retention decline
- Paid acquisition remains paused until W4 is mature

## Who to recruit and how

### First 10–15

Pick people with an active relationship, dating or communication situation in the next week and the willingness to be candid. A polished demographic sample is less important than fast, truthful feedback.

### 30-user organic baseline

Use trusted campus/community introductions and friend-of-friend referrals. Recruit for situation fit, not vanity reach. Give each person a simple onboarding instruction and do not chase them to return.

### 70-user notification experiment

Keep the same kind of audience but assign holdout/control consistently. Do not mix in influencers, paid traffic or large campaigns while testing notifications.

### 150–250 beta

Expand through:

- college and young-professional communities with clear dating/communication relevance
- micro-creators who can recruit a small, well-tagged cohort
- relationship and social-confidence communities where the user can choose to try the product
- referrals from genuinely retained users

Every invite must capture a source label. A channel that brings large installs but weak activation is not a growth channel yet.

## Limited-resource channel order

1. Direct founder recruitment and user interviews
2. Warm community leads / campus ambassadors with small, attributable batches
3. Small creator/community pilots with unique links or codes
4. Referral loop from retained users
5. Organic content only after language and product moments are proven
6. Broad poster/QR campaigns only once Android positioning is clear and there is a realistic iOS answer or audience targeting prevents wasted iPhone traffic
7. Paid acquisition only after W4 and channel cohorts are healthy

## Poster / QR-code guidance

Pain-led creative can work, but it should be used as a **measured channel experiment**, not a large brand rollout. Start with 2–3 variants, unique QR codes, a clear Android-only landing message and source tags. If a poster cannot tell iPhone users what to do next, do not scale it. The right early question is not “did people scan?” but “did scanners activate and retain?”

## The weekly learning loop

### Daily (15–20 minutes)

- Check installs, onboarding completion, activation, successful response rate, crashes and safety flags.
- Read every severe negative feedback item.
- Log the top friction with a reproducible example.

### Mid-week (45 minutes)

- Review cohorts by source and product version.
- Identify one bottleneck: onboarding, first answer, memory, return trigger, trust or reliability.
- Select one or two changes only.

### Weekends (founder-led calls)

Speak to a mix of retained, churned and never-activated users. Use this conversation sequence:

1. Tell me what happened when you considered opening Sparkeefy.
2. What did you expect Wingman to do?
3. What did it get right, wrong or miss?
4. What did you do after its answer?
5. When did you next have a similar problem, and what did you use instead?
6. What would make this genuinely hard to lose?

Do not lead users into saying they like the product. Capture quotes, context, product version, source and a specific next hypothesis.

### Weekly decision review

- Update the Launch Control tracker with actuals and evidence.
- Compare each gate against its target.
- Decide: advance, repeat with one focused improvement, or pause/repair a trust issue.
- Write the single biggest learning and the next week’s bet.

## Instrumentation required before the first cohort

Track at minimum:

- invite/source, install, onboarding step completion, onboarding complete
- first Wingman open, first user message, first useful answer, response error, safety event
- meaningful Wingman session, return session, second situation, active day
- memory shown/saved/corrected, Spark Meter view, plan created, action started/completed
- notification eligibility, notification sent/opened, deep-link session, opt-out/disable, negative feedback
- app version, Android version/device, crash-free sessions
- survey answers and interview status

Create a simple “meaningful session” event definition before data arrives; otherwise retention will be impossible to interpret.

## Non-negotiable decision rules

- Do not advance a phase when a critical privacy, trust or safety incident remains unresolved.
- Do not claim product-market fit from download count, D1 alone or positive friend feedback.
- Do not turn on aggressive notifications to rescue weak organic return.
- Do not launch Spark Meter broadly before it shows clear comprehension and usefulness in a controlled beta.
- Do not scale posters, paid channels or broad brand marketing until retention holds across cohorts and a second acquisition channel.
- Do not market as if iOS is available. Keep Android-only messaging explicit during this phase.

## Master prompt for ChatGPT / strategic review

> You are the operating brain for Sparkeefy, an Android-first relationship support product. Wingman helps users think through real interpersonal situations; future product layers include person-specific memory, contextual follow-ups, Spark Meter and a weekly plan. We are in an evidence-seeking launch, not a broad brand launch. Use the full strategy and phase gates above as the source of truth. Do not invent data, benchmarks or product capabilities. For each decision, distinguish fact, assumption, metric, risk and next experiment. Prioritise trust, privacy, meaningful repeat use and qualitative user evidence over downloads. When I provide weekly cohort data, tell me: (1) whether the phase has passed, (2) what the bottleneck is, (3) the smallest high-confidence product or distribution experiment to run next, (4) which users I should interview, and (5) what must not be changed yet. Challenge vanity metrics and avoid recommending broad marketing until the retention gates are actually met.

