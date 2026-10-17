import { useId, useState } from "react";
import type { ValueStats } from "../data/loadData";
import { formatCurrency } from "../lib/format";
import { estimatePercentile, formatPercentileRank } from "../lib/percentiles";

const MIN_LOOKUP_VALUE = 10_000;
const MAX_LOOKUP_VALUE = 50_000_000;

// Where a home value falls in the selected area, interpolated between the
// published percentiles. Uses whichever values the explorer is showing, so in
// Assessed mode it accepts an assessed value for that year.
function HomeValueLookup({
  areaName,
  stats,
  valueLabel,
}: {
  areaName: string;
  stats: ValueStats;
  valueLabel: string;
}) {
  const inputId = useId();
  const outputId = useId();
  const [text, setText] = useState("");
  const value = Number(text.replace(/[$,\s]/g, ""));
  const hasText = text.trim() !== "";
  const isValid =
    hasText &&
    Number.isFinite(value) &&
    value >= MIN_LOOKUP_VALUE &&
    value <= MAX_LOOKUP_VALUE;
  // The % sign is drawn as a fixed suffix, like the Rankings percentile input.
  const rank = isValid
    ? formatPercentileRank(
        estimatePercentile(stats.percentiles, value),
      ).replace(/%$/, "")
    : "";

  return (
    <article className="lookup-panel">
      <div className="lookup-heading">
        <h2>Where Does a Home Value Fall?</h2>
        <p className="subheader-description">
          Enter a home value to see where it falls among{" "}
          {valueLabel.toLowerCase()} values in {areaName}.
        </p>
      </div>

      <div className="lookup-fields">
        <div className="control-group lookup-field">
          <label className="control-label" htmlFor={inputId}>
            Home Value
          </label>
          <span className="lookup-input lookup-money">
            <span aria-hidden="true">$</span>
            <input
              id={inputId}
              inputMode="numeric"
              placeholder="500,000"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </span>
        </div>

        <div className="control-group lookup-field">
          <label className="control-label" htmlFor={outputId}>
            Percentile Rank
          </label>
          <output
            id={outputId}
            className="lookup-input lookup-output"
            htmlFor={inputId}
            aria-live="polite"
          >
            <span>{rank || "—"}</span>
            <span className="lookup-suffix">%</span>
          </output>
        </div>
      </div>

      {hasText && !isValid && (
        <p className="ranking-help ranking-error">
          Enter a value from {formatCurrency(MIN_LOOKUP_VALUE)} to{" "}
          {formatCurrency(MAX_LOOKUP_VALUE)}.
        </p>
      )}
    </article>
  );
}

export default HomeValueLookup;
