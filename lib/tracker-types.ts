export type PhaseStatus = 'active' | 'locked' | 'complete';
export type Comparator = 'gte' | 'lte' | 'eq';

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
  if (metric.comparator === 'lte') return metric.actual <= metric.target;
  if (metric.comparator === 'eq') return metric.actual === metric.target;
  return metric.actual >= metric.target;
}

export function phaseProgress(phase: TrackerPhase) {
  const total = phase.metrics.length + phase.checks.length;
  const passed = phase.metrics.filter(metricPassed).length + phase.checks.filter((item) => item.completed).length;
  return { passed, total, percent: total ? Math.round((passed / total) * 100) : 0 };
}

export function phaseReady(phase: TrackerPhase) {
  return phase.metrics.length > 0 && phase.metrics.every(metricPassed) && phase.checks.every((item) => item.completed);
}
