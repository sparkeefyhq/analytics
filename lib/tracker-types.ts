export type PhaseStatus = "active" | "locked" | "complete";
export type Comparator = "gte" | "lte" | "eq";

export type TrackerMetric = {
  id: string;
  phaseId: string;
  position: number;
  category: string;
  name: string;
  target: number;
  actual: number | null;
  unit: string;
  comparator: Comparator;
  valueType?: "number" | "fraction" | "percent";
  targetDenominator?: number | null;
  actualDenominator?: number | null;
  minimumDenominator?: number | null;
  definition?: string;
};

export type ReleaseGate = {
  id: string;
  phaseId: string;
  position: number;
  name: string;
  actual: number;
};

export type CohortParticipant = {
  id: string;
  phaseId: string;
  participantId: string;
  status: string;
  ageBand: string;
  relationshipState: string;
  recruitmentSource: string;
  closeFriendOrTeammate: boolean;
  situationCategory: string;
  onboardingCompleted: boolean;
  meaningfulActivation: boolean;
  independentlyActivated: boolean;
  firstAnswerUseful: "yes" | "no" | "not-rated";
  genuineRequestCount: number;
  usefulnessResponseCount: number;
  reminderTestCount: number;
  reminderTested: boolean;
  reminderDeliveryResult: string;
  reminderDestinationResult: string;
  returnSource: string;
  founderExplainedProduct: boolean;
  founderHelpedOnboarding: boolean;
  founderSuggestedSituation: boolean;
  founderHelpedRequest: boolean;
  founderSolvedProblem: boolean;
  founderPromptedReturn: boolean;
  trustConcern: boolean;
  productIssue: boolean;
  evidenceNote: string;
  notionReferenceUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type TrackerCheck = {
  id: string;
  phaseId: string;
  position: number;
  label: string;
  completed: boolean;
};

export type TrackerPhase = {
  id: string;
  position: number;
  name: string;
  objective: string;
  userMin: number;
  userMax: number;
  durationMin: number;
  durationMax: number;
  durationUnit: string;
  actualUsers: number;
  elapsedDays: number;
  status: PhaseStatus;
  features: string[];
  notes: string;
  updatedAt: string;
  metrics: TrackerMetric[];
  checks: TrackerCheck[];
};

export type TrackerData = { phases: TrackerPhase[] };

export function metricPassed(metric: TrackerMetric) {
  if (metric.actual === null || Number.isNaN(metric.actual)) return false;
  if (metric.valueType === "percent") {
    if (!metric.actualDenominator || metric.actualDenominator <= 0)
      return false;
    if (
      metric.minimumDenominator &&
      metric.actualDenominator < metric.minimumDenominator
    )
      return false;
    return (metric.actual / metric.actualDenominator) * 100 >= metric.target;
  }
  if (metric.valueType === "fraction") {
    if (!metric.actualDenominator || metric.actualDenominator <= 0)
      return false;
    if (
      metric.minimumDenominator &&
      metric.actualDenominator < metric.minimumDenominator
    )
      return false;
    if (
      metric.targetDenominator &&
      metric.actualDenominator < metric.targetDenominator
    )
      return false;
    return metric.actual >= metric.target;
  }
  if (metric.comparator === "lte") return metric.actual <= metric.target;
  if (metric.comparator === "eq") return metric.actual === metric.target;
  return metric.actual >= metric.target;
}

export function phaseProgress(phase: TrackerPhase) {
  const total = phase.metrics.length + phase.checks.length;
  const passed =
    phase.metrics.filter(metricPassed).length +
    phase.checks.filter((item) => item.completed).length;
  return {
    passed,
    total,
    percent: total ? Math.round((passed / total) * 100) : 0,
  };
}

export function phaseReady(phase: TrackerPhase) {
  return (
    phase.metrics.length > 0 &&
    phase.metrics.every(metricPassed) &&
    phase.checks.every((item) => item.completed)
  );
}
