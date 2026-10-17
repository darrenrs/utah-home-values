import type { AcsGeographyValues, ValueStats } from "../data/loadData";
import { formatCurrency } from "../lib/format";

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
  homeValueStats,
}: {
  acsValues?: AcsGeographyValues;
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
        values are high relative to local incomes. As a rough guide, ratios from
        4.0 to 5.0 indicate high affordability pressure, 5.0 to 6.0 indicate
        very high pressure, and ratios above 6.0 indicate severe price-income
        strain. Median household income and owner-occupied housing share are
        provided for additional context.
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
    </section>
  );
}

export default HousingContext;
