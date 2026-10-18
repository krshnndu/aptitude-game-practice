// Skill breakdown dimensions for the per-game report (pure). A dimension turns a list of attempts
// into one number: { key, label, fmt: 'pct'|'sec'|'num', better: 'high'|'low', target, value(attempts, tagsOf) }.

import { median, mean } from './analytics.js';
import { tagRate } from './learn-util.js';

export const accuracyDim = {
  key: 'accuracy', label: 'Accuracy (solved / attempted)', fmt: 'pct', better: 'high', target: 0.85,
  value: (as) => (as.length ? as.filter((a) => a.outcome === 'solved').length / as.length : null),
};

export const efficiencyDim = (label = 'Median efficiency') => ({
  key: 'efficiency', label, fmt: 'pct', better: 'high', target: 0.9,
  value: (as) => (as.length ? median(as.map((a) => a.metrics?.efficiency ?? 0)) : null),
});

export const firstMoveDim = (label, targetMs) => ({
  key: 'first', label, fmt: 'sec', better: 'low', target: targetMs,
  value: (as) => median(as.map((a) => a.metrics?.firstMoveMs).filter(Number.isFinite)),
});

export const timeDim = (label, targetMs, time = (a) => a.metrics?.totalMs) => ({
  key: 'time', label, fmt: 'sec', better: 'low', target: targetMs,
  value: (as) => median(as.filter((a) => a.outcome === 'solved').map(time).filter(Number.isFinite)),
});

export const tagDim = (key, label, ids, target = 0.1) => ({
  key, label, fmt: 'pct', better: 'low', target,
  value: (as, tagsOf) => tagRate(as, tagsOf, ids),
});

export const metricMeanDim = (key, label, pick, target, fmt = 'num', better = 'low') => ({
  key, label, fmt, better, target,
  value: (as) => (as.length ? mean(as.map(pick)) : null),
});

export const hintsDim = metricMeanDim('hints', 'Hints per attempt', (a) => a.hintsUsed ?? 0, 0.1);
