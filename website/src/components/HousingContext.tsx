import type { AcsGeographyValues, ValueStats } from "../data/loadData";
import { formatCurrency } from "../lib/format";
import { estimatePercentile } from "../lib/percentiles";

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatRatio(value: number) {
  return `${value.toFixed(1)}x`;
}

function confidenceInterval(
  estimate: number,
  moe90: number,
  formatter: (value: number) => string,
  bounds?: { min?: number; max?: number },
) {
  const lower = Math.max(bounds?.min ?? -Infinity, estimate - moe90);
  const upper = Math.min(bounds?.max ?? Infinity, estimate + moe90);

  return `90% CI: ${formatter(lower)}-${formatter(upper)}`;
}

// Share of homes valued at or below a threshold, read off the percentile curve.
function shareAtOrBelow(percentiles: number[], threshold: number) {
  const position = estimatePercentile(percentiles, threshold);

  if (position.bound === "below") {
    return "<1%";
  }

  if (position.bound === "above") {
    return ">99%";
  }

  return `${Math.round(position.percentile)}%`;
}

function affordabilityDescription(value: number) {
  if (value <= 3.0) {
    return "Affordable";
  } else if (value <= 4.0) {
    return "Moderately unaffordable";
  } else if (value <= 5.0) {
    return "Seriously unaffordable";
  } else {
    return "Severely unaffordable";
  }
}

function HousingContext({
  acsValues,
  acsVintageYear,
  homeValueStats,
}: {
  acsValues?: AcsGeographyValues;
  acsVintageYear?: number;
  homeValueStats: ValueStats;
}) {
  const medianHomeValue = homeValueStats.percentiles[49];
  const income = acsValues?.medianHouseholdIncome.estimate ?? null;
  const incomeMoe = acsValues?.medianHouseholdIncome.moe90 ?? null;
  const ownerShare = acsValues?.ownerOccupiedPercent.estimate ?? null;
  const ownerShareMoe = acsValues?.ownerOccupiedPercent.moe90 ?? null;
  const hasIncome =
    typeof income === "number" &&
    income > 0 &&
    typeof medianHomeValue === "number";

  if (!hasIncome && ownerShare === null) {
    return (
      <section className="metric-section">
        <h3 className="metric-section-title">Housing Context</h3>
        <p className="context-unavailable">
          Housing context is not available for this geography.
        </p>
      </section>
    );
  }

  const ratio = hasIncome ? medianHomeValue / income : null;
  const ratioBounds =
    hasIncome && incomeMoe !== null && income - incomeMoe > 0
      ? {
          lower: medianHomeValue / (income + incomeMoe),
          upper: medianHomeValue / (income - incomeMoe),
        }
      : null;

  return (
    <section className="metric-section">
      <h3 className="metric-section-title">Housing Context</h3>
      <p className="subheader-description">
        The median home value / median household income ratio is a simple
        measure of local affordability pressure. A higher ratio means home
        values are high relative to local incomes. Median household income and
        owner-occupied housing share are provided for additional context.
      </p>
      <div className="context-grid">
        <article className="context-card">
          <h4>Median Household Income</h4>
          <p className="context-value">
            {hasIncome ? formatCurrency(income) : "Not available"}
          </p>
          {hasIncome && incomeMoe !== null && (
            <p className="context-ci">
              {confidenceInterval(income, incomeMoe, formatCurrency, {
                min: 0,
              })}
            </p>
          )}
        </article>

        <article className="context-card">
          <h4>Median Home Value / Income</h4>
          <p className="context-value">
            {ratio !== null ? formatRatio(ratio) : "Not available"}
          </p>
          {ratio !== null && (
            <p className="context-ci">
              {affordabilityDescription(ratio)}
              {ratioBounds && (
                <>
                  <br />
                  90% CI: {formatRatio(ratioBounds.lower)}-
                  {formatRatio(ratioBounds.upper)}
                </>
              )}
            </p>
          )}
        </article>

        <article className="context-card">
          <h4>Homes Within 3× Median HHI</h4>
          <p className="context-value">
            {hasIncome
              ? shareAtOrBelow(homeValueStats.percentiles, 3 * income)
              : "Not available"}
          </p>
          {hasIncome && (
            <p className="context-ci">
              homes valued at ≤{formatCurrency(3 * income)}
            </p>
          )}
        </article>

        <article className="context-card">
          <h4>Owner-Occupied Housing Share</h4>
          <p className="context-value">
            {ownerShare !== null ? formatPercent(ownerShare) : "Not available"}
          </p>
          {ownerShare !== null && ownerShareMoe !== null && (
            <p className="context-ci">
              {confidenceInterval(ownerShare, ownerShareMoe, formatPercent, {
                min: 0,
                max: 100,
              })}
            </p>
          )}
        </article>
      </div>
      <p className="data-note">
        Labels follow the Demographia scale: 3.0 or below is affordable, 3.1 to
        4.0 moderately unaffordable, 4.1 to 5.0 seriously unaffordable, and
        above 5.0 severely unaffordable. Incomes are{" "}
        {acsVintageYear ? `${acsVintageYear - 4}–${acsVintageYear} ` : ""}
        American Community Survey 5-year estimates, so ratios run slightly high.
      </p>
    </section>
  );
}

export default HousingContext;
