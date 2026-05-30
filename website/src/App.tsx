import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  registerables,
  type ChartConfiguration,
  type TooltipItem,
} from "chart.js";
import marketData from "../../data/processed/MARKET_ADJUSTED_VALUE.json";
import assessedData from "../../data/processed/TOT_VALUE.json";

ChartJS.register(...registerables);
ChartJS.defaults.font.family = "'Spline Sans Mono Variable', monospace";

type GeoType = "wasatchFront" | "county" | "place";
type ValueMode = "market" | "assessed";
type DataSection = "WasatchFront" | "County" | "Place";

type ValueStats = {
  name: string;
  n: number;
  mean: number;
  percentiles: number[];
};

type AttributeData = {
  WasatchFront: ValueStats;
  County: Record<string, ValueStats>;
  Place: Record<string, ValueStats>;
};

type GeographyOption = {
  id: string;
  label: string;
};

type PercentilePoint = {
  percentile: number;
  label: string;
  value: number;
};

const GEO_TYPES = [
  { id: "wasatchFront", label: "Wasatch Front" },
  { id: "county", label: "County" },
  { id: "place", label: "Place / CDP" },
] satisfies Array<{ id: GeoType; label: string }>;

const VALUE_MODES = [
  { id: "market", label: "Market-adjusted" },
  { id: "assessed", label: "Assessed" },
] satisfies Array<{ id: ValueMode; label: string }>;

const HIGHLIGHTS = [
  { percentile: 10, label: "10th Percentile" },
  { percentile: 25, label: "25th Percentile" },
  { percentile: 50, label: "Median" },
  { percentile: 75, label: "75th Percentile" },
  { percentile: 90, label: "90th Percentile" },
];

const DATASET = {
  market: marketData as AttributeData,
  assessed: assessedData as AttributeData,
};

function formatCurrency(value: number | undefined, compact = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumSignificantDigits: 2,
    maximumSignificantDigits: 3,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sectionForGeoType(geoType: GeoType): DataSection {
  if (geoType === "wasatchFront") {
    return "WasatchFront";
  }

  return geoType === "county" ? "County" : "Place";
}

function getGeographyOptions(data: AttributeData, geoType: GeoType) {
  const section = sectionForGeoType(geoType);

  if (section === "WasatchFront") {
    return [{ id: "WasatchFront", label: data.WasatchFront.name }];
  }

  return Object.entries(data[section])
    .map(([id, stats]) => ({ id, label: stats.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getDefaultSelection(rows: GeographyOption[], geoType: GeoType) {
  const preferred = rows.find((row) =>
    geoType === "county"
      ? row.id === "Salt Lake"
      : row.label === "Salt Lake City city",
  );

  return preferred?.id ?? rows[0]?.id ?? "WasatchFront";
}

function getSelectedStats(
  data: AttributeData,
  geoType: GeoType,
  selectedId: string,
) {
  const section = sectionForGeoType(geoType);

  if (section === "WasatchFront") {
    return data.WasatchFront;
  }

  return data[section][selectedId];
}

function normalizePercentiles(row: ValueStats) {
  return row.percentiles.map((value, index) => {
    const percentile = index + 1;

    return {
      percentile,
      label: `P${String(percentile).padStart(2, "0")}`,
      value: Number(value),
    };
  });
}

function getPercentileValue(points: PercentilePoint[], percentile: number) {
  return points[percentile - 1]?.value;
}

function getTotalRecords(data: AttributeData) {
  return Object.values(data.County).reduce((total, row) => total + row.n, 0);
}

function geoEyebrow(geoType: GeoType) {
  if (geoType === "wasatchFront") {
    return "Region";
  }

  return geoType === "county" ? "County" : "Census Place / CDP";
}

function usePrefersDarkMode() {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDark(event.matches);
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return isDark;
}

function getRootCssValue(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();

  return value || fallback;
}

function PercentileChart({ points }: { points: PercentilePoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS<
    "line",
    Array<{ x: number; y: number }>
  > | null>(null);

  const colorSchemeSignal = usePrefersDarkMode();

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    chartRef.current?.destroy();

    const colors = {
      font: getRootCssValue(
        "--font-mono",
        "'Spline Sans Mono Variable', monospace",
      ),
      grid: getRootCssValue("--border", "#d6deea"),
      text: getRootCssValue("--muted", "#657083"),
      line: getRootCssValue("--accent-strong", "#0d5e8a"),
      point: getRootCssValue("--surface", "#ffffff"),
      highlight: getRootCssValue("--warm", "#be6b2d"),
      tooltipBackground: getRootCssValue("--surface", "#ffffff"),
      tooltipText: getRootCssValue("--text", "#151923"),
    };

    const highlightPercentiles = new Set(
      HIGHLIGHTS.map((item) => item.percentile),
    );
    const config: ChartConfiguration<
      "line",
      Array<{ x: number; y: number }>,
      number
    > = {
      type: "line",
      data: {
        datasets: [
          {
            label: "Value",
            data: points.map((point) => ({
              x: point.percentile,
              y: point.value,
            })),
            borderColor: colors.line,
            borderWidth: 1,
            pointBackgroundColor: points.map((point) =>
              highlightPercentiles.has(point.percentile)
                ? colors.highlight
                : colors.point,
            ),
            pointBorderColor: colors.line,
            pointHoverBackgroundColor: colors.highlight,
            pointHoverBorderColor: colors.line,
            pointRadius: points.map((point) =>
              highlightPercentiles.has(point.percentile) ? 3 : 2,
            ),
            pointHoverRadius: 4,
            tension: 0.22,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: "nearest",
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: colors.tooltipBackground,
            borderColor: colors.grid,
            borderWidth: 1,
            bodyColor: colors.tooltipText,
            bodyFont: {
              family: colors.font,
            },
            titleColor: colors.tooltipText,
            titleFont: {
              family: colors.font,
            },
            callbacks: {
              title: () => "",
              label: (context: TooltipItem<"line">) => {
                const percentile = Number(context.parsed.x);
                return `${percentile}%: ${formatCurrency(context.parsed.y ?? undefined)}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 100,
            grid: {
              color: colors.grid,
            },
            ticks: {
              color: colors.text,
              font: {
                family: colors.font,
              },
              callback: (value) => {
                const numericValue = Number(value);
                if (
                  Number.isInteger(numericValue) &&
                  numericValue >= 1 &&
                  numericValue <= 99
                ) {
                  return `P${numericValue}`;
                }

                return "";
              },
            },
          },
          y: {
            grid: {
              color: colors.grid,
            },
            ticks: {
              color: colors.text,
              font: {
                family: colors.font,
              },
              callback: (value) => formatCurrency(Number(value), true),
            },
          },
        },
      },
    };

    chartRef.current = new ChartJS(canvasRef.current, config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [points, colorSchemeSignal]);

  return (
    <div className="chart-card">
      <div className="chart-heading">
        <div>
          <h3>Percentile Curve</h3>
          <p>Every point from the 1st to the 99th percentile.</p>
        </div>
      </div>
      <div className="percentile-chart-frame">
        <canvas
          ref={canvasRef}
          aria-label="Line chart of home values from the 1st to 99th percentile."
          role="img"
        />
      </div>
    </div>
  );
}

function App() {
  const [geoType, setGeoType] = useState<GeoType>("wasatchFront");
  const [valueMode, setValueMode] = useState<ValueMode>("market");
  const [selectedId, setSelectedId] = useState("WasatchFront");

  const activeData = DATASET[valueMode];
  const rows = useMemo(
    () => getGeographyOptions(activeData, geoType),
    [activeData, geoType],
  );
  const selected =
    getSelectedStats(activeData, geoType, selectedId) ??
    getSelectedStats(activeData, geoType, getDefaultSelection(rows, geoType));
  const selectedLabel = selected?.name ?? "";
  const percentilePoints = useMemo(
    () => (selected ? normalizePercentiles(selected) : []),
    [selected],
  );

  const handleGeoTypeChange = (nextGeoType: GeoType) => {
    const nextRows = getGeographyOptions(activeData, nextGeoType);
    setGeoType(nextGeoType);
    setSelectedId(getDefaultSelection(nextRows, nextGeoType));
  };

  const handleValueModeChange = (nextValueMode: ValueMode) => {
    const nextData = DATASET[nextValueMode];
    const nextSection = sectionForGeoType(geoType);
    const stillExists =
      nextSection === "WasatchFront" ||
      Boolean(nextData[nextSection][selectedId]);

    setValueMode(nextValueMode);
    if (!stillExists) {
      setSelectedId(
        getDefaultSelection(getGeographyOptions(nextData, geoType), geoType),
      );
    }
  };

  return (
    <div className="page-shell">
      <header>
        <nav className="container">
          <a className="brand" href="/" aria-label="Go home">
            <span className="logo-mark" aria-hidden="true">
              <img src="/image.png" alt="" />
            </span>
            <strong>Utah Home Values</strong>
          </a>
          <div>
            <a href="#about">About</a>
            <a href="https://github.com/darrenrs/utah-home-values">GitHub</a>
          </div>
        </nav>
      </header>

      <main className="container">
        <div className="page-stack">
          <section className="hero hero-split hero-split-main-page">
            <div className="stack hero-main-copy">
              <div className="hero-main-title-row">
                <h1>Utah Home Values</h1>
                <div className="hero-image-frame hero-image-frame-mobile">
                  <img src="/image.png" alt="" className="hero-image" />
                </div>
              </div>
              <p>
                Browse and compare single-family home values of Utah's cities,
                counties, and regions.
              </p>
            </div>
            <div
              className="hero-image-frame hero-image-frame-desktop"
              aria-hidden="true"
            >
              <img src="/image.png" alt="" className="hero-image" />
            </div>
          </section>

          <section className="explorer-shell" id="explorer">
            <div className="control-bar" aria-label="Explorer controls">
              <div className="control-group">
                <span className="control-label">Geography Level</span>
                <div
                  className="segmented geo-segmented"
                  role="group"
                  aria-label="Geography type"
                >
                  {GEO_TYPES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === geoType ? "active" : ""}
                      onClick={() => handleGeoTypeChange(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="control-group">
                <span className="control-label">Select Geography</span>
                <select
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selected && (
              <article className="summary-panel">
                <div className="summary-head">
                  <div>
                    <p className="eyebrow">{geoEyebrow(geoType)}</p>
                    <h2>{selectedLabel}</h2>
                    <p className="summary-meta">
                      <strong>Count:</strong> {formatNumber(selected.n)},{" "}
                      <strong>Average:</strong> {formatCurrency(selected.mean)}
                    </p>
                  </div>
                  <div className="summary-tools">
                    <div className="control-group value-control">
                      <span className="control-label">Value</span>
                      <div
                        className="segmented"
                        role="group"
                        aria-label="Value mode"
                      >
                        {VALUE_MODES.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={item.id === valueMode ? "active" : ""}
                            onClick={() => handleValueModeChange(item.id)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="metric-grid">
                  {HIGHLIGHTS.map((item) => (
                    <article key={item.percentile} className="metric">
                      <h3>{item.label}</h3>
                      <p>
                        {formatCurrency(
                          getPercentileValue(percentilePoints, item.percentile),
                        )}
                      </p>
                    </article>
                  ))}
                </div>

                <PercentileChart points={percentilePoints} />
                <p className="explorer-note">
                  Values are rounded to the nearest $1,000.
                </p>
              </article>
            )}
          </section>

          <section className="page-section">
            <h2>Coverage</h2>
            <div className="status-grid">
              <article className="stat-card">
                <span>Counties</span>
                <strong>
                  {formatNumber(Object.keys(marketData.County).length)}
                </strong>
              </article>
              <article className="stat-card">
                <span>Places / CDPs</span>
                <strong>
                  {formatNumber(Object.keys(marketData.Place).length)}
                </strong>
              </article>
              <article className="stat-card">
                <span>Total Records</span>
                <strong>
                  {formatNumber(getTotalRecords(marketData as AttributeData))}
                </strong>
              </article>
            </div>
          </section>

          <section className="page-section" id="about">
            <h2>Data / Methodology</h2>
            <div className="method-grid">
              <article className="copy-card">
                <h3>Data Pipeline</h3>
                <p>
                  The Utah Housing Unit Inventory dataset is the initial source
                  of truth. Outlier records and non-single-family units are
                  filtered out; some townhomes and condos are kept if there is
                  evidence that they are single-unit dwellings. The original
                  assessed values are adjusted to estimated real market values
                  based on actual sales data.
                </p>
              </article>
              <article className="copy-card">
                <h3>Geography</h3>
                <p>
                  To summarize by Place / CDP, all parcels are projected onto
                  Census place shapefile coordinate system, converted to a
                  representative point, and spatially joined to the place
                  polygon that contains it. This method is superior to the CITY
                  attribute in the Housing Unit Inventory dataset because it is
                  immune to misclassification errors and adds Census-Designated
                  Places (unincorporated communities) that would not otherwise
                  appear.
                </p>
              </article>
              <article className="copy-card sources-card">
                <h3>Sources</h3>
                <p>
                  All parcel-level/value data are provided for public use by
                  Utah Open Data as part of the{" "}
                  <a href="https://gis.utah.gov/products/sgid/planning/housing-unit-inventory/">
                    Utah Housing Unit Inventory
                  </a>{" "}
                  dataset. Parcels which correspond to single- and multi-family
                  housing units are aggregated by county assessors and submitted
                  to the dataset.
                </p>
                <p>
                  Assessment/Sales Ratios are provided by the Utah State Tax
                  Commission. The reference year depends on the year that the
                  assessed value is associated with.{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2025.pdf">
                    Davis, Morgan, Salt Lake, Tooele, and Weber Counties (2024
                    data)
                  </a>
                  ,{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2024.pdf">
                    Utah County (2023 data)
                  </a>
                  ,{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2023.pdf">
                    Washington County (2022 data)
                  </a>
                  .
                </p>
                <p>
                  Place names and boundaries are provided by the U.S. Census
                  Bureau from the{" "}
                  <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html">
                    2024 Census TIGER/Line Shapefiles
                  </a>
                  .
                </p>
              </article>
            </div>
          </section>
        </div>
      </main>

      <footer className="container">
        <p>
          <a href="https://darrenskidmore.com">© 2026 Darren R. Skidmore.</a> •{" "}
          <a href="https://darrenskidmore.com/privacy#utah-home-values">
            Privacy Policy
          </a>
          <br />
          Built as a public data tool. Not intended for real estate, legal, or
          financial services.
        </p>
      </footer>
    </div>
  );
}

export default App;
