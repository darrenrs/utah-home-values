export const MIN_PERCENTILE = 1;
export const MAX_PERCENTILE = 99;

export type PercentileEstimate = {
  percentile: number;
  bound?: "below" | "above";
};

// Where a value falls in a 1st-99th percentile array. Interpolates linearly
// between published percentiles, so places rarely tie on whole percentiles.
// Values outside that range get a position just below 1 or above 99 so they
// still sort without ties.
export function estimatePercentile(
  percentiles: number[],
  value: number,
): PercentileEstimate {
  if (value < percentiles[0]) {
    return { percentile: value / percentiles[0], bound: "below" };
  }

  const lastIndex = percentiles.length - 1;
  if (value >= percentiles[lastIndex]) {
    return {
      percentile: MAX_PERCENTILE + (1 - percentiles[lastIndex] / value),
      bound: "above",
    };
  }

  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const lower = percentiles[index];
    const upper = percentiles[index + 1];

    if (value >= lower) {
      const fraction = upper > lower ? (value - lower) / (upper - lower) : 0;
      return { percentile: index + 1 + fraction };
    }
  }

  return { percentile: MIN_PERCENTILE };
}

// The whole-number percentile shown for an estimate: 0 for "<1%" and 100 for
// "≥99%". Interpolation is typically within half a percentile point of the
// exact rank, so one decimal would overstate the precision.
export function displayedPercentile({ percentile, bound }: PercentileEstimate) {
  if (bound === "below") {
    return 0;
  }

  if (bound === "above") {
    return 100;
  }

  return Math.min(
    MAX_PERCENTILE,
    Math.max(MIN_PERCENTILE, Math.round(percentile)),
  );
}

export function formatPercentileRank(estimate: PercentileEstimate) {
  const shown = displayedPercentile(estimate);

  if (shown === 0) {
    return "<1%";
  }

  if (shown === 100) {
    return "≥99%";
  }

  return `${shown}%`;
}
