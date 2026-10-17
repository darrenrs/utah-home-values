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
  MarketContext,
  ValueMode,
  ValueStats,
} from "../data/loadData";
import { isApiConfigured, withApiBaseUrl } from "../lib/apiUrl";
import { formatCurrency, formatNumber } from "../lib/format";
import GeographySelector, {
  type GeographyOption,
  type GeographyType,
} from "./GeographySelector";
import HomeValueLookup from "./HomeValueLookup";
import HousingContext from "./HousingContext";

ChartJS.register(...registerables);
ChartJS.defaults.font.family = "'Spline Sans Mono Variable', monospace";

type PercentilePoint = {
  percentile: number;
  label: string;
  value: number;
};

type ChartSeries = {
  label: string;
  points: PercentilePoint[];
  kind: "primary" | "parent" | "compare";
};

type CustomAreaSummary = {
  assessed: ValueStats;
  marketAdjusted: ValueStats;
  assessedValueYear: number | null;
};

const GEO_TYPES = [
  { id: "wasatchFront", label: "Wasatch Front" },
  { id: "county", label: "County" },
  { id: "place", label: "Place / CDP" },
  { id: "zcta5", label: "ZIP Code" },
] satisfies Array<{ id: GeographyType; label: string }>;

const VALUE_MODES = [{ id: "market" }, { id: "assessed" }] satisfies Array<{
  id: ValueMode;
}>;

const HIGHLIGHTS = [
  { percentile: 10, label: "10th Percentile" },
  { percentile: 25, label: "25th Percentile" },
  { percentile: 50, label: "Median" },
  { percentile: 75, label: "75th Percentile" },
  { percentile: 90, label: "90th Percentile" },
];

const WASATCH_FRONT_ID = "region:wasatch-front";

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

function customAreaStatsForMode(
  summary: CustomAreaSummary,
  valueMode: ValueMode,
) {
  return valueMode === "market" ? summary.marketAdjusted : summary.assessed;
}

function assessedValueYearLabel(year: number | null | undefined) {
  return typeof year === "number" ? String(year) : "mixed years";
}

function valueModeLabel(
  valueMode: ValueMode,
  assessedValueYear: number | null,
  marketValueYear: number | null,
) {
  if (valueMode === "assessed") {
    return `Assessed (${assessedValueYearLabel(assessedValueYear)})`;
  }

  return marketValueYear
    ? `Market-adjusted (${marketValueYear})`
    : "Market-adjusted";
}

// The county a geography belongs to: the county itself, or a place's or ZIP
// code's primary county. Regions span several counties.
function primaryCountyId(geographies: GeographyCatalog, id: string) {
  const metadata = geographies[id];

  if (metadata?.type === "County") {
    return id;
  }

  const parent = metadata?.parentGeography;
  return parent && geographies[parent]?.type === "County" ? parent : undefined;
}

function PriceTrendNote({
  marketContext,
  countyId,
}: {
  marketContext: MarketContext;
  countyId: string;
}) {
  const metroId = marketContext.counties[countyId]?.metro;
  const metro = metroId ? marketContext.metros[metroId] : undefined;

  if (!metro) {
    return null;
  }

  const change = metro.changePercent;
  const movement =
    change > 0
      ? `risen ${change.toFixed(1)}%`
      : change < 0
        ? `fallen ${Math.abs(change).toFixed(1)}%`
        : "been flat";

  return (
    <p className="data-note">
      Values reflect {marketContext.marketValueYear} average prices. Since then,
      FHFA's house price index for the {metro.name} metro area has {movement}{" "}
      (through {marketContext.latestQuarter}).
    </p>
  );
}

function isValueStats(value: unknown): value is ValueStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ValueStats>;
  return (
    typeof candidate.n === "number" &&
    typeof candidate.mean === "number" &&
    typeof candidate.total === "number" &&
    Array.isArray(candidate.percentiles)
  );
}

function isCustomAreaSummary(value: unknown): value is CustomAreaSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CustomAreaSummary>;
  return (
    isValueStats(candidate.assessed) &&
    isValueStats(candidate.marketAdjusted) &&
    (candidate.assessedValueYear === null ||
      typeof candidate.assessedValueYear === "number")
  );
}

function apiErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;

    if (typeof detail === "string") {
      return detail;
    }
  }

  return `Unable to analyze area (${status})`;
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

  return `${signedDifference}% vs ${parentName}`;
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

function PercentileChart({ series }: { series: ChartSeries[] }) {
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
      line: getRootCssValue("--accent", "#60a5fa"),
      point: getRootCssValue("--surface", "#ffffff"),
      highlight: getRootCssValue("--text", "#151923"),
      compare: getRootCssValue("--text", "#151923"),
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
        datasets: series.map((item) => {
          const data = item.points.map((point) => ({
            x: point.percentile,
            y: point.value,
          }));

          if (item.kind === "primary") {
            return {
              label: item.label,
              data,
              borderColor: colors.line,
              backgroundColor: colors.line,
              borderWidth: 1.5,
              pointBackgroundColor: item.points.map((point) =>
                highlightPercentiles.has(point.percentile)
                  ? colors.highlight
                  : colors.point,
              ),
              pointBorderColor: colors.line,
              pointHoverBackgroundColor: colors.highlight,
              pointHoverBorderColor: colors.line,
              pointRadius: item.points.map((point) =>
                highlightPercentiles.has(point.percentile) ? 3 : 2,
              ),
              pointHoverRadius: 4,
              cubicInterpolationMode: "monotone" as const,
            };
          }

          const color = item.kind === "parent" ? colors.text : colors.compare;
          return {
            label: item.label,
            data,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 1.25,
            borderDash: item.kind === "parent" ? [5, 4] : [],
            pointRadius: 0,
            pointHoverRadius: 3,
            cubicInterpolationMode: "monotone" as const,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: "index",
        },
        plugins: {
          legend: {
            display: series.length > 1,
            align: "start",
            labels: {
              padding: 4,
              color: colors.text,
              boxHeight: 2,
              boxWidth: 18,
              font: {
                family: colors.font,
              },
            },
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
              title: (items) =>
                items.length ? `P${Number(items[0].parsed.x)}` : "",
              label: (context: TooltipItem<"line">) =>
                `${context.dataset.label}: ${formatCurrency(context.parsed.y ?? undefined)}`,
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

    // Chart.js has no legend margin option; grow the legend box so the labels
    // sit closer to the title and further from the plot.
    config.plugins = [
      {
        id: "legendBottomMargin",
        beforeInit(chart) {
          const legend = chart.legend;
          if (!legend) {
            return;
          }

          const fit = legend.fit.bind(legend);
          legend.fit = () => {
            fit();
            legend.height += 12;
          };
        },
      },
    ];

    chartRef.current = new ChartJS(canvasRef.current, config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [series, colorSchemeSignal]);

  return (
    <div className="chart-card">
      <div className="chart-heading">
        <div>
          <h4>Percentile Curve</h4>
          <p className="subheader-description">
            See the value distribution from the 1st to 99th percentiles.
          </p>
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
  const { acsValues, datasets, geographies, marketContext } = dataBundle;
  const marketValueYear = marketContext?.marketValueYear ?? null;
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
  const [isCustomAreaAvailable, setIsCustomAreaAvailable] = useState(false);
  const [isCustomAreaOpen, setIsCustomAreaOpen] = useState(false);
  const [customAreaText, setCustomAreaText] = useState("");
  const [customAreaError, setCustomAreaError] = useState<string>();
  const [isAnalyzingCustomArea, setIsAnalyzingCustomArea] = useState(false);
  const [customAreaSummary, setCustomAreaSummary] =
    useState<CustomAreaSummary>();
  const [compareId, setCompareId] = useState<string>();

  const activeData = datasets[valueMode];
  const rows = useMemo(
    () => getGeographyOptions(activeData, geographies, geoType),
    [activeData, geographies, geoType],
  );
  const activeSelectedId = getSelectedStats(activeData, geoType, selectedId)
    ? selectedId
    : getDefaultSelection(rows, geoType);
  const standardSelected = getSelectedStats(
    activeData,
    geoType,
    activeSelectedId,
  );
  const selected = customAreaSummary
    ? customAreaStatsForMode(customAreaSummary, valueMode)
    : standardSelected;
  const selectedMetadata = geographies[activeSelectedId];
  const selectedLabel = customAreaSummary
    ? "Custom Area"
    : (selectedMetadata?.name ?? "");
  const assessedValueYear = customAreaSummary
    ? customAreaSummary.assessedValueYear
    : (selectedMetadata?.assessedValueYear ?? null);
  const assessedValueModeAvailable = assessedValueYear !== null;
  const parentMetadata =
    !customAreaSummary && selectedMetadata?.parentGeography
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
  // Assessed values are only comparable within one county: each county has its
  // own assessment year and assessment/sales ratio. Areas that fail the 90%
  // single-year check have no assessed year, so they can't be compared either.
  const isAssessedComparable = (id: string) =>
    assessedValueYear !== null &&
    geographies[id]?.assessedValueYear === assessedValueYear &&
    primaryCountyId(geographies, id) !== undefined &&
    primaryCountyId(geographies, id) ===
      primaryCountyId(geographies, activeSelectedId) &&
    id !== primaryCountyId(geographies, id);
  const isComparableArea = (id: string) =>
    valueMode === "market" || isAssessedComparable(id);
  const activeCompareId =
    !customAreaSummary && compareId && isComparableArea(compareId)
      ? compareId
      : undefined;
  const compareStats = activeCompareId
    ? activeData[sectionForGeoType(geoType)][activeCompareId]
    : undefined;
  const compareName = activeCompareId
    ? geographies[activeCompareId]?.name
    : undefined;
  const comparePercentilePoints = useMemo(
    () => (compareStats ? normalizePercentiles(compareStats) : []),
    [compareStats],
  );
  const compareOptions = rows.filter(
    (row) => row.id !== activeSelectedId && isComparableArea(row.id),
  );
  const contextCounty = customAreaSummary
    ? undefined
    : primaryCountyId(geographies, activeSelectedId);
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
  const chartSeries = useMemo(() => {
    const series: ChartSeries[] = [
      { label: selectedLabel, points: percentilePoints, kind: "primary" },
    ];

    if (compareName && comparePercentilePoints.length) {
      series.push({
        label: compareName,
        points: comparePercentilePoints,
        kind: "compare",
      });
    } else if (parentMetadata && parentPercentilePoints.length) {
      series.push({
        label: parentMetadata.name,
        points: parentPercentilePoints,
        kind: "parent",
      });
    }

    return series;
  }, [
    selectedLabel,
    percentilePoints,
    compareName,
    comparePercentilePoints,
    parentMetadata,
    parentPercentilePoints,
  ]);

  useEffect(() => {
    if (!isApiConfigured) {
      return undefined;
    }

    let cancelled = false;

    fetch(withApiBaseUrl("/health"))
      .then((response) => {
        if (!cancelled && response.ok) {
          setIsCustomAreaAvailable(true);
        }
      })
      .catch(() => {
        // Custom areas are optional, so a missing API should not affect the explorer.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (valueMode === "assessed" && !assessedValueModeAvailable) {
      setValueMode("market");
    }
  }, [assessedValueModeAvailable, valueMode]);

  useEffect(() => {
    const syncFromHash = () => {
      const nextSelectedId = getHashGeographyId(geographies);

      setCompareId(undefined);

      if (nextSelectedId) {
        setCustomAreaSummary(undefined);
        setGeoType(geoTypeForSection(geographies[nextSelectedId].type));
        setSelectedId(nextSelectedId);
      } else {
        setCustomAreaSummary(undefined);
        setGeoType("wasatchFront");
        setSelectedId(WASATCH_FRONT_ID);
      }
    };

    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [geographies]);

  const handleSelectionChange = (nextSelectedId: string) => {
    setCustomAreaSummary(undefined);
    setCompareId(undefined);
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
    if (nextValueMode === "assessed" && !assessedValueModeAvailable) {
      return;
    }

    if (customAreaSummary) {
      setValueMode(nextValueMode);
      return;
    }

    if (
      nextValueMode === "assessed" &&
      compareId &&
      !isAssessedComparable(compareId)
    ) {
      setCompareId(undefined);
    }

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

  const handleAnalyzeCustomArea = async () => {
    setCustomAreaError(undefined);
    setIsAnalyzingCustomArea(true);

    try {
      let polygon: unknown;

      try {
        polygon = JSON.parse(customAreaText);
      } catch {
        setCustomAreaError("Enter a valid GeoJSON Polygon.");
        return;
      }

      const response = await fetch(withApiBaseUrl("/polygon"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(polygon),
      });
      const payload: unknown = await response.json().catch(() => undefined);

      if (!response.ok) {
        setCustomAreaError(apiErrorMessage(payload, response.status));
        return;
      }

      if (!isCustomAreaSummary(payload)) {
        setCustomAreaError("The custom area API returned an invalid response.");
        return;
      }

      setCustomAreaSummary(payload);
    } catch {
      setCustomAreaError("Unable to reach the custom area API.");
    } finally {
      setIsAnalyzingCustomArea(false);
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

        {isCustomAreaAvailable && (
          <div className="custom-area-control">
            <button
              type="button"
              className="custom-area-toggle"
              aria-controls="custom-area-selection"
              aria-expanded={isCustomAreaOpen}
              onClick={() => setIsCustomAreaOpen((isOpen) => !isOpen)}
            >
              <span>
                {isCustomAreaOpen
                  ? "Hide custom area selection"
                  : "Custom area (advanced)"}
              </span>
              <span className="custom-area-toggle-arrow" aria-hidden="true" />
            </button>
            <div
              className={`custom-area-disclosure${isCustomAreaOpen ? " is-open" : ""}`}
              id="custom-area-selection"
              aria-hidden={!isCustomAreaOpen}
            >
              <div className="custom-area-disclosure-inner">
                <div className="custom-area-panel">
                  <h2>Custom Area</h2>
                  <p className="subheader-description">
                    You can add a geography here. A simple tool to generate the
                    code needed to make this work is{" "}
                    <a href="https://geojson.io/">geojson.io</a>.
                  </p>
                  <textarea
                    className="custom-area-textarea"
                    placeholder="Paste a GeoJSON Polygon here"
                    value={customAreaText}
                    onChange={(event) => setCustomAreaText(event.target.value)}
                  />
                  <div className="custom-area-actions">
                    <button
                      type="button"
                      className="custom-area-submit"
                      disabled={isAnalyzingCustomArea}
                      onClick={handleAnalyzeCustomArea}
                    >
                      {isAnalyzingCustomArea
                        ? "Analyzing Area..."
                        : "Analyze Area"}
                    </button>
                    {customAreaError && (
                      <p className="custom-area-error" role="alert">
                        {customAreaError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <article className="summary-panel">
          <div className="summary-head">
            <div>
              <p className="eyebrow">
                {customAreaSummary ? "Custom Area" : geoEyebrow(geoType)}
              </p>
              <h2>{selectedLabel}</h2>
              {sampleSizeLevel !== "error" && (
                <p className="summary-meta">
                  <strong>Count:</strong> {formatNumber(selected.n)},{" "}
                  <strong>Mean:</strong> {formatCurrency(selected.mean)},{" "}
                  <strong>Cumulative:</strong> {formatCurrency(selected.total)}
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
                      disabled={
                        item.id === "assessed" && !assessedValueModeAvailable
                      }
                      onClick={() => handleValueModeChange(item.id)}
                    >
                      {valueModeLabel(
                        item.id,
                        assessedValueYear,
                        marketValueYear,
                      )}
                    </button>
                  ))}
                </div>
                <p className="value-control-note">
                  Assessed values use each county's own assessment year, so they
                  can't be compared across counties.
                </p>
              </div>
            </div>
          </div>

          {!customAreaSummary && compareOptions.length > 0 && (
            <div className="compare-control">
              <span className="control-label">Compare with</span>
              <div className="compare-control-row">
                <GeographySelector
                  geoType={geoType}
                  options={compareOptions}
                  selectedId={activeCompareId ?? ""}
                  onChange={setCompareId}
                  ariaLabel="Compare with another geography"
                />
                {activeCompareId && (
                  <button
                    type="button"
                    className="compare-clear"
                    onClick={() => setCompareId(undefined)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {sampleSizeLevel && <SampleSizeNotice level={sampleSizeLevel} />}

          {sampleSizeLevel !== "error" && (
            <>
              <div
                className={`summary-body${sampleSizeLevel !== "warning" ? " has-chart" : ""}`}
              >
                <div className="summary-main">
                  <section className="metric-section">
                    <h3 className="metric-section-title">
                      Home Value Percentiles
                    </h3>
                    <p className="subheader-description">
                      Percentiles show where home values fall within the
                      selected area. For example, a 10th percentile home value
                      of{" "}
                      {formatCurrency(getPercentileValue(percentilePoints, 10))}{" "}
                      means about 10% of homes are valued at or below{" "}
                      {formatCurrency(getPercentileValue(percentilePoints, 10))}
                      . The median is the 50th percentile, or the middle value
                      in the distribution.
                    </p>
                    <div className="metric-grid">
                      {HIGHLIGHTS.map((item) => {
                        const value = getPercentileValue(
                          percentilePoints,
                          item.percentile,
                        );
                        const parentComparison = compareStats
                          ? getParentComparison(
                              value,
                              getPercentileValue(
                                comparePercentilePoints,
                                item.percentile,
                              ),
                              compareName,
                            )
                          : valueMode === "market" ||
                              parentMetadata?.type === "County"
                            ? getParentComparison(
                                value,
                                getPercentileValue(
                                  parentPercentilePoints,
                                  item.percentile,
                                ),
                                parentMetadata?.name,
                              )
                            : undefined;

                        return (
                          <article
                            key={item.percentile}
                            className={`metric${item.percentile === 50 ? " metric--median" : ""}`}
                          >
                            <h4>{item.label}</h4>
                            <p className="metric-value">
                              {formatCurrency(value)}
                            </p>
                            {parentComparison && (
                              <p className="metric-comparison">
                                {parentComparison}
                              </p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                    {marketContext &&
                      contextCounty &&
                      valueMode === "market" && (
                        <PriceTrendNote
                          marketContext={marketContext}
                          countyId={contextCounty}
                        />
                      )}
                  </section>

                  {!customAreaSummary &&
                    activeSelectedId !== WASATCH_FRONT_ID && (
                      <HousingContext
                        acsValues={acsValues.geographies[activeSelectedId]}
                        homeValueStats={
                          datasets.market[sectionForGeoType(geoType)][
                            activeSelectedId
                          ]
                        }
                      />
                    )}
                </div>

                {sampleSizeLevel !== "warning" && (
                  <div className="summary-side">
                    <PercentileChart series={chartSeries} />
                  </div>
                )}
              </div>
              <p className="explorer-note">
                Values are rounded to the nearest $1,000.
                {
                  " To see where a specific home value falls, use the lookup below."
                }
              </p>
            </>
          )}
        </article>
      )}

      {selected && sampleSizeLevel !== "error" && (
        <HomeValueLookup
          valueLabel={valueModeLabel(
            valueMode,
            assessedValueYear,
            marketValueYear,
          )}
          areaName={customAreaSummary ? "this custom area" : selectedLabel}
          stats={selected}
        />
      )}
    </section>
  );
}

export default GeographyExplorer;
