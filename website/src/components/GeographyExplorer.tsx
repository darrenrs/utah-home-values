import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  registerables,
  type ChartConfiguration,
  type TooltipItem,
} from "chart.js";
import type {
  AttributeData,
  DataBundle,
  DataSection,
  GeographyCatalog,
  ValueMode,
  ValueStats,
} from "../data/loadData";
import GeographySelector, {
  type GeographyOption,
  type GeographyType,
} from "./GeographySelector";
import HousingContext from "./HousingContext";

ChartJS.register(...registerables);
ChartJS.defaults.font.family = "'Spline Sans Mono Variable', monospace";

type PercentilePoint = {
  percentile: number;
  label: string;
  value: number;
};

const GEO_TYPES = [
  { id: "wasatchFront", label: "Wasatch Front" },
  { id: "county", label: "County" },
  { id: "place", label: "Place / CDP" },
  { id: "zcta5", label: "ZIP Code" },
] satisfies Array<{ id: GeographyType; label: string }>;

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

const WASATCH_FRONT_ID = "region:wasatch-front";

function formatCurrency(value: number | undefined) {
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

function sectionForGeoType(geoType: GeographyType): DataSection {
  switch (geoType) {
    case "wasatchFront":
      return "Region";
    case "county":
      return "County";
    case "place":
      return "Place";
    case "zcta5":
      return "ZCTA5";
  }
}

function geoTypeForSection(section: DataSection): GeographyType {
  switch (section) {
    case "Region":
      return "wasatchFront";
    case "County":
      return "county";
    case "Place":
      return "place";
    case "ZCTA5":
      return "zcta5";
  }
}

function getHashGeographyId(geographies: GeographyCatalog) {
  const encodedId = window.location.hash.slice(1);

  if (!encodedId) {
    return undefined;
  }

  try {
    const id = decodeURIComponent(encodedId);
    return geographies[id] ? id : undefined;
  } catch {
    return undefined;
  }
}

function updateHash(id: string) {
  const hash = `#${id}`;

  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

function getGeographyOptions(
  data: AttributeData,
  geographies: GeographyCatalog,
  geoType: GeographyType,
) {
  const section = sectionForGeoType(geoType);

  return Object.keys(data[section])
    .map((id) => {
      const metadata = geographies[id];

      if (!metadata) {
        throw new Error(`Missing geography metadata for ${id}`);
      }

      return {
        ...metadata,
        id,
        label: metadata.name,
        parentCountyName:
          metadata.parentGeography &&
          geographies[metadata.parentGeography]?.type === "County"
            ? geographies[metadata.parentGeography].name
            : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getDefaultSelection(rows: GeographyOption[], geoType: GeographyType) {
  const preferred = rows.find((row) =>
    geoType === "county"
      ? row.id === "county:salt-lake"
      : row.label === "Salt Lake City",
  );

  return preferred?.id ?? rows[0]?.id ?? WASATCH_FRONT_ID;
}

function getSelectedStats(
  data: AttributeData,
  geoType: GeographyType,
  selectedId: string,
) {
  const section = sectionForGeoType(geoType);

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

function getParentComparison(
  selectedValue: number | undefined,
  parentValue: number | undefined,
  parentName: string | undefined,
) {
  if (
    typeof selectedValue !== "number" ||
    typeof parentValue !== "number" ||
    !Number.isFinite(selectedValue) ||
    !Number.isFinite(parentValue) ||
    parentValue === 0 ||
    !parentName
  ) {
    return undefined;
  }

  const difference = Math.round(
    ((selectedValue - parentValue) / parentValue) * 100,
  );
  const signedDifference =
    difference >= 0 ? `+${difference}` : String(difference);

  return `${signedDifference}% from ${parentName}`;
}

function geoEyebrow(geoType: GeographyType) {
  switch (geoType) {
    case "wasatchFront":
      return "Region";
    case "county":
      return "County";
    case "place":
      return "Place";
    case "zcta5":
      return "ZIP Code";
    default:
      return "Unknown";
  }
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
              callback: (value) => formatCurrency(Number(value)),
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

function SampleSizeNotice({ level }: { level: "warning" | "error" }) {
  return (
    <div className={`information-card information-card--${level}`}>
      <span className="information-card-icon" aria-hidden="true">
        {level === "warning" ? (
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 2L22 20H2L12 2Z" fill="currentColor" />
            <path
              d="M12 5.4L19.2 17.8H4.8L12 5.4Z"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M12 9.2V13.1"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="12" cy="15.7" r="0.85" fill="#ffffff" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M8 2H16L22 8V16L16 22H8L2 16V8L8 2Z" fill="currentColor" />
            <path
              d="M8.9 4.1H15.1L19.9 8.9V15.1L15.1 19.9H8.9L4.1 15.1V8.9L8.9 4.1Z"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M12 8V13.2"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="12" cy="16.2" r="1.05" fill="#ffffff" />
          </svg>
        )}
      </span>
      <span className="information-card-text">
        {level === "warning"
          ? "Insufficient sample size to display full percentile chart."
          : "Insufficient sample size to display data."}
      </span>
    </div>
  );
}

function GeographyExplorer({ dataBundle }: { dataBundle: DataBundle }) {
  const { acsValues, datasets, geographies } = dataBundle;
  const hashGeographyId = getHashGeographyId(geographies);
  const [geoType, setGeoType] = useState<GeographyType>(() =>
    hashGeographyId
      ? geoTypeForSection(geographies[hashGeographyId].type)
      : "wasatchFront",
  );
  const [valueMode, setValueMode] = useState<ValueMode>("market");
  const [selectedId, setSelectedId] = useState(
    hashGeographyId ?? WASATCH_FRONT_ID,
  );

  const activeData = datasets[valueMode];
  const rows = useMemo(
    () => getGeographyOptions(activeData, geographies, geoType),
    [activeData, geographies, geoType],
  );
  const activeSelectedId = getSelectedStats(activeData, geoType, selectedId)
    ? selectedId
    : getDefaultSelection(rows, geoType);
  const selected = getSelectedStats(activeData, geoType, activeSelectedId);
  const selectedMetadata = geographies[activeSelectedId];
  const selectedLabel = selectedMetadata?.name ?? "";
  const parentMetadata = selectedMetadata?.parentGeography
    ? geographies[selectedMetadata.parentGeography]
    : undefined;
  const parentStats =
    selectedMetadata?.parentGeography && parentMetadata
      ? activeData[parentMetadata.type][selectedMetadata.parentGeography]
      : undefined;
  const parentPercentilePoints = useMemo(
    () => (parentStats ? normalizePercentiles(parentStats) : []),
    [parentStats],
  );
  const sampleSizeLevel =
    selected && selected.n < 20
      ? "error"
      : selected && selected.n < 100
        ? "warning"
        : null;
  const percentilePoints = useMemo(
    () => (selected ? normalizePercentiles(selected) : []),
    [selected],
  );

  useEffect(() => {
    const syncFromHash = () => {
      const nextSelectedId = getHashGeographyId(geographies);

      if (nextSelectedId) {
        setGeoType(geoTypeForSection(geographies[nextSelectedId].type));
        setSelectedId(nextSelectedId);
      } else {
        setGeoType("wasatchFront");
        setSelectedId(WASATCH_FRONT_ID);
      }
    };

    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [geographies]);

  const handleSelectionChange = (nextSelectedId: string) => {
    setSelectedId(nextSelectedId);
    updateHash(nextSelectedId);
  };

  const handleGeoTypeChange = (nextGeoType: GeographyType) => {
    const nextRows = getGeographyOptions(activeData, geographies, nextGeoType);
    const nextSelectedId = getDefaultSelection(nextRows, nextGeoType);

    setGeoType(nextGeoType);
    handleSelectionChange(nextSelectedId);
  };

  const handleValueModeChange = (nextValueMode: ValueMode) => {
    const nextData = datasets[nextValueMode];
    const nextSection = sectionForGeoType(geoType);
    const stillExists = Boolean(nextData[nextSection][selectedId]);

    setValueMode(nextValueMode);
    if (!stillExists) {
      handleSelectionChange(
        getDefaultSelection(
          getGeographyOptions(nextData, geographies, geoType),
          geoType,
        ),
      );
    }
  };

  return (
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

        <div className="control-group">
          <span className="control-label">Select Geography</span>
          <GeographySelector
            geoType={geoType}
            options={rows}
            selectedId={activeSelectedId}
            onChange={handleSelectionChange}
          />
        </div>
      </div>

      {selected && (
        <article className="summary-panel">
          <div className="summary-head">
            <div>
              <p className="eyebrow">{geoEyebrow(geoType)}</p>
              <h2>{selectedLabel}</h2>
              {sampleSizeLevel !== "error" && (
                <p className="summary-meta">
                  <strong>Count:</strong> {formatNumber(selected.n)},{" "}
                  <strong>Average:</strong> {formatCurrency(selected.mean)}
                </p>
              )}
            </div>
            <div className="summary-tools">
              <div className="control-group value-control">
                <span className="control-label">Value</span>
                <div className="segmented" role="group" aria-label="Value mode">
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

          {sampleSizeLevel && <SampleSizeNotice level={sampleSizeLevel} />}

          {sampleSizeLevel !== "error" && (
            <>
              <section className="metric-section">
                <h3 className="metric-section-title">Home Value Percentiles</h3>
                <div className="metric-grid">
                  {HIGHLIGHTS.map((item) => {
                    const value = getPercentileValue(
                      percentilePoints,
                      item.percentile,
                    );
                    const parentComparison = getParentComparison(
                      value,
                      getPercentileValue(
                        parentPercentilePoints,
                        item.percentile,
                      ),
                      parentMetadata?.name,
                    );

                    return (
                      <article key={item.percentile} className="metric">
                        <h3>{item.label}</h3>
                        <p className="metric-value">{formatCurrency(value)}</p>
                        {parentComparison && (
                          <p className="metric-comparison">
                            {parentComparison}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <HousingContext
                acsValues={acsValues.geographies[activeSelectedId]}
                homeValueStats={selected}
              />

              {sampleSizeLevel !== "warning" && (
                <PercentileChart points={percentilePoints} />
              )}
              <p className="explorer-note">
                Values are rounded to the nearest $1,000.
              </p>
            </>
          )}
        </article>
      )}
    </section>
  );
}

export default GeographyExplorer;
