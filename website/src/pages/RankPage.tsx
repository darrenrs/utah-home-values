import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import { loadData, type DataBundle, type ValueStats } from "../data/loadData";
import { formatCurrency, formatNumber } from "../lib/format";
import PageTitle from "../components/PageTitle";

const MIN_SAMPLE_SIZE = 100;
const MIN_HOME_VALUE = 200_000;
const MAX_HOME_VALUE = 5_000_000;
const MIN_PERCENTILE = 1;
const MAX_PERCENTILE = 99;

type QueryMode = "homeValue" | "percentile";

type RankingRow = {
  id: string;
  name: string;
  n: number;
  rank: number;
  barLabel: string;
  barPosition: number;
  sortValue: number;
};

type PercentileEstimate = {
  percentile: number;
  bound?: "below";
};

function getHomeValue(percentiles: number[], percentile: number) {
  return percentiles[percentile - 1];
}

function estimatePercentile(
  percentiles: number[],
  homeValue: number,
): PercentileEstimate {
  if (homeValue < percentiles[0]) {
    return { percentile: MIN_PERCENTILE, bound: "below" };
  }

  for (let index = percentiles.length - 1; index >= 0; index -= 1) {
    if (homeValue >= percentiles[index]) {
      return { percentile: index + 1 };
    }
  }

  return { percentile: MAX_PERCENTILE };
}

function formatPercentileRank({ percentile, bound }: PercentileEstimate) {
  if (bound === "below") {
    return "≤1%";
  }

  return `${percentile}%`;
}

function getPercentileRankSortValue({ percentile, bound }: PercentileEstimate) {
  return bound === "below" ? 0 : percentile;
}

function makeHomeValueRow(
  id: string,
  name: string,
  stats: ValueStats,
  homeValue: number,
): RankingRow {
  const estimate = estimatePercentile(stats.percentiles, homeValue);
  const percentileRankSortValue = getPercentileRankSortValue(estimate);

  return {
    id,
    name,
    n: stats.n,
    rank: 0,
    barLabel: formatPercentileRank(estimate),
    barPosition: percentileRankSortValue,
    sortValue: percentileRankSortValue,
  };
}

function makePercentileRow(
  id: string,
  name: string,
  stats: ValueStats,
  percentile: number,
): RankingRow {
  const homeValue = getHomeValue(stats.percentiles, percentile);

  return {
    id,
    name,
    n: stats.n,
    rank: 0,
    barLabel: formatCurrency(homeValue),
    barPosition: 0,
    sortValue: homeValue,
  };
}

function normalizePercentileBars(rows: RankingRow[]) {
  const values = rows.map((row) => row.sortValue);
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);

  return rows.map((row) => ({
    ...row,
    barPosition:
      minimumValue === maximumValue
        ? 50
        : ((row.sortValue - minimumValue) / (maximumValue - minimumValue)) *
          100,
  }));
}

function DataStatus({ errorMessage }: { errorMessage?: string }) {
  return (
    <section className="rankings-shell data-status">
      {errorMessage ? (
        <>
          <h1>Unable to load rankings</h1>
          <p role="alert">{errorMessage}</p>
        </>
      ) : (
        <p role="status">Loading rankings...</p>
      )}
    </section>
  );
}

function RankingBar({ row }: { row: RankingRow }) {
  const style = {
    "--rank-position": `${row.barPosition}%`,
  } as CSSProperties;

  return (
    <div className="rank-bar-wrap" style={style}>
      <div className="rank-bar" aria-hidden="true">
        <span className="rank-bar-fill" />
        <span className="rank-bar-marker" />
      </div>
      <span className="rank-bar-label">{row.barLabel}</span>
    </div>
  );
}

function Rankings({ dataBundle }: { dataBundle: DataBundle }) {
  const [queryMode, setQueryMode] = useState<QueryMode>("homeValue");
  const [homeValue, setHomeValue] = useState("500000");
  const [percentile, setPercentile] = useState("50");
  const valueMode = "market";
  const numericHomeValue = Number(homeValue);
  const numericPercentile = Number(percentile);
  const homeValueIsValid =
    Number.isFinite(numericHomeValue) &&
    numericHomeValue >= MIN_HOME_VALUE &&
    numericHomeValue <= MAX_HOME_VALUE;
  const percentileIsValid =
    Number.isFinite(numericPercentile) &&
    Number.isInteger(numericPercentile) &&
    numericPercentile >= MIN_PERCENTILE &&
    numericPercentile <= MAX_PERCENTILE;
  const queryIsValid =
    queryMode === "homeValue" ? homeValueIsValid : percentileIsValid;

  const rows = useMemo(() => {
    if (!queryIsValid) {
      return [];
    }

    const placeStats = dataBundle.datasets[valueMode].Place;

    const sortedRows = Object.entries(placeStats)
      .filter(([, stats]) => stats.n >= MIN_SAMPLE_SIZE)
      .map(([id, stats]) => {
        const name = dataBundle.geographies[id]?.name ?? id;

        return queryMode === "homeValue"
          ? makeHomeValueRow(id, name, stats, numericHomeValue)
          : makePercentileRow(id, name, stats, numericPercentile);
      })
      .sort(
        (a, b) =>
          (queryMode === "homeValue"
            ? a.sortValue - b.sortValue
            : b.sortValue - a.sortValue) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );

    const displayRows =
      queryMode === "percentile"
        ? normalizePercentileBars(sortedRows)
        : sortedRows;
    let currentRank = 0;

    return displayRows.map((row, index) => {
      if (index === 0 || row.sortValue !== displayRows[index - 1].sortValue) {
        currentRank = index + 1;
      }

      return { ...row, rank: currentRank };
    });
  }, [
    dataBundle,
    numericHomeValue,
    numericPercentile,
    queryIsValid,
    queryMode,
    valueMode,
  ]);

  const barHeading =
    queryMode === "homeValue"
      ? `Percentile rank of ${formatCurrency(numericHomeValue)}`
      : `P${numericPercentile < 10 ? "0" : ""}${numericPercentile} home value`;

  return (
    <>
      <PageTitle title="City Rankings | Utah Home Value Explorer" />
      <section className="rankings-shell">
        <div className="rankings-intro">
          <p className="eyebrow">Utah Home Values</p>
          <h1>City Rankings</h1>
          <p>Compare cities and communities by percentile ranks.</p>
        </div>

        <article className="ranking-controls" aria-label="Ranking controls">
          <div className="ranking-control-grid">
            <div className="control-group">
              <span className="control-label">Rank By</span>
              <div className="segmented" role="group" aria-label="Ranking mode">
                <button
                  type="button"
                  className={queryMode === "homeValue" ? "active" : ""}
                  aria-pressed={queryMode === "homeValue"}
                  onClick={() => setQueryMode("homeValue")}
                >
                  Home Value
                </button>
                <button
                  type="button"
                  className={queryMode === "percentile" ? "active" : ""}
                  aria-pressed={queryMode === "percentile"}
                  onClick={() => setQueryMode("percentile")}
                >
                  Percentile
                </button>
              </div>
            </div>

            {queryMode === "homeValue" ? (
              <label className="control-group">
                <span className="control-label">Home Value</span>
                <span className="rank-input-wrap">
                  <span aria-hidden="true">$</span>
                  <input
                    className="rank-query-input"
                    type="number"
                    inputMode="numeric"
                    min={MIN_HOME_VALUE}
                    max={MAX_HOME_VALUE}
                    step="10000"
                    value={homeValue}
                    aria-describedby="rank-query-help"
                    onChange={(event) => setHomeValue(event.target.value)}
                  />
                </span>
              </label>
            ) : (
              <label className="control-group">
                <span className="control-label">Percentile</span>
                <span className="rank-input-wrap">
                  <input
                    className="rank-query-input"
                    type="number"
                    inputMode="decimal"
                    min={MIN_PERCENTILE}
                    max={MAX_PERCENTILE}
                    step="1"
                    value={percentile}
                    aria-describedby="rank-query-help"
                    onChange={(event) => setPercentile(event.target.value)}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            )}
          </div>

          <p
            id="rank-query-help"
            className={
              queryIsValid ? "ranking-help" : "ranking-help ranking-error"
            }
          >
            {queryMode === "homeValue"
              ? homeValueIsValid
                ? "Ranks places by the percentile rank of a home at a given value."
                : `Enter a home value from ${formatCurrency(MIN_HOME_VALUE)} to ${formatCurrency(MAX_HOME_VALUE)}.`
              : percentileIsValid
                ? "Ranks places by the home value at a given percentile."
                : "Enter an integer percentile from 1 to 99."}{" "}
            Only market-adjusted values are supported as these are cross-county
            comparisons.
          </p>
        </article>

        {queryIsValid && (
          <article className="ranking-table-panel">
            <div className="ranking-table-heading">
              <h2>Place Rankings</h2>
              <p className="ranking-filter">n ≥ {MIN_SAMPLE_SIZE}</p>
            </div>

            <div className="ranking-table-scroll">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Place Name</th>
                    <th scope="col">n</th>
                    <th scope="col">{barHeading}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="ranking-rank">{row.rank}</td>
                      <th scope="row">
                        <Link
                          className="ranking-place-link"
                          to={{ pathname: "/", hash: `#${row.id}` }}
                        >
                          {row.name}
                        </Link>
                      </th>
                      <td className="ranking-count">{formatNumber(row.n)}</td>
                      <td>
                        <RankingBar row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="explorer-note">
              Values are rounded to the nearest $1,000. Rankings use the
              published 1st through 99th percentile values.
            </p>
          </article>
        )}
      </section>
    </>
  );
}

function RankPage() {
  const [dataBundle, setDataBundle] = useState<DataBundle>();
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    loadData()
      .then((data) => {
        if (!cancelled) {
          setDataBundle(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "Unknown data error",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-shell">
      <SiteHeader />

      <main className="container">
        {dataBundle ? (
          <Rankings dataBundle={dataBundle} />
        ) : (
          <DataStatus errorMessage={errorMessage} />
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

export default RankPage;
