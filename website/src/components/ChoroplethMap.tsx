import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  loadBoundaries,
  type BoundaryFeature,
  type Boundaries,
  type DataBundle,
  type DataSection,
} from "../data/loadData";
import { formatCurrency, formatNumber } from "../lib/format";
import type { GeographyType } from "./GeographySelector";

type MapLevel = Extract<DataSection, "County" | "Place" | "ZCTA5">;
type MapView = "north" | "washington";
type ViewBox = { x: number; y: number; width: number; height: number };

// Labels match the explorer's geography levels.
const MAP_LEVELS = [
  { id: "County", label: "County", prefix: "county:" },
  { id: "Place", label: "Place / CDP", prefix: "place:" },
  { id: "ZCTA5", label: "ZIP Code", prefix: "zcta5:" },
] satisfies Array<{ id: MapLevel; label: string; prefix: string }>;

const MAP_VIEWS = [
  { id: "north", label: "Wasatch Front" },
  { id: "washington", label: "Washington County" },
] satisfies Array<{ id: MapView; label: string }>;

// Seven fixed groups of median market-adjusted value. Each group includes its
// lower bound and excludes its upper bound, so "$400–499K" is [400,000, 500,000).
const VALUE_BREAKS = [400_000, 500_000, 600_000, 700_000, 800_000, 1_000_000];
const VALUE_BIN_LABELS = [
  "Under $400K",
  "$400–499K",
  "$500–599K",
  "$600–699K",
  "$700–799K",
  "$800–999K",
  "$1M or more",
];

const WASHINGTON_COUNTY_ID = "county:washington";
const VIEWBOX_WIDTH = 800;
const EXTENT_PADDING = 0.04;
const MAX_ZOOM = 24;
const ZOOM_STEP = 1.6;
const DRAG_THRESHOLD_PX = 4;

type Extent = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

function primaryCountyId(dataBundle: DataBundle, id: string) {
  const metadata = dataBundle.geographies[id];

  if (metadata?.type === "County") {
    return id;
  }

  return metadata?.parentGeography ?? undefined;
}

function viewForGeography(dataBundle: DataBundle, id: string): MapView {
  return primaryCountyId(dataBundle, id) === WASHINGTON_COUNTY_ID
    ? "washington"
    : "north";
}

function levelForGeoType(geoType: GeographyType): MapLevel | undefined {
  switch (geoType) {
    case "county":
      return "County";
    case "place":
      return "Place";
    case "zcta5":
      return "ZCTA5";
    default:
      return undefined;
  }
}

function featureRings(feature: BoundaryFeature) {
  return feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates
    : feature.geometry.coordinates.flat();
}

function extentOf(features: BoundaryFeature[]): Extent | undefined {
  let extent: Extent | undefined;

  for (const feature of features) {
    for (const ring of featureRings(feature)) {
      for (const [lon, lat] of ring) {
        extent = extent
          ? {
              minLon: Math.min(extent.minLon, lon),
              minLat: Math.min(extent.minLat, lat),
              maxLon: Math.max(extent.maxLon, lon),
              maxLat: Math.max(extent.maxLat, lat),
            }
          : { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat };
      }
    }
  }

  return extent;
}

// Equirectangular projection scaled by cos(latitude), which is accurate
// enough at county scale and needs no mapping library.
function makeProjection(extent: Extent) {
  const lonPad = (extent.maxLon - extent.minLon) * EXTENT_PADDING;
  const latPad = (extent.maxLat - extent.minLat) * EXTENT_PADDING;
  const minLon = extent.minLon - lonPad;
  const maxLon = extent.maxLon + lonPad;
  const minLat = extent.minLat - latPad;
  const maxLat = extent.maxLat + latPad;
  const lonScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = VIEWBOX_WIDTH / ((maxLon - minLon) * lonScale);

  return {
    height: (maxLat - minLat) * scale,
    path(feature: BoundaryFeature) {
      return featureRings(feature)
        .map(
          (ring) =>
            `M${ring
              .map(
                ([lon, lat]) =>
                  `${((lon - minLon) * lonScale * scale).toFixed(1)},${((maxLat - lat) * scale).toFixed(1)}`,
              )
              .join("L")}Z`,
        )
        .join("");
    },
  };
}

function valueBin(value: number) {
  const index = VALUE_BREAKS.findIndex((limit) => value < limit);
  return (index === -1 ? VALUE_BREAKS.length : index) + 1;
}

// Keep the zoomed view inside the full map.
function clampViewBox(box: ViewBox, full: ViewBox): ViewBox {
  const width = Math.min(
    full.width,
    Math.max(full.width / MAX_ZOOM, box.width),
  );
  const height = (width / full.width) * full.height;

  return {
    width,
    height,
    x: Math.min(Math.max(box.x, full.x), full.x + full.width - width),
    y: Math.min(Math.max(box.y, full.y), full.y + full.height - height),
  };
}

function zoomViewBox(
  box: ViewBox,
  full: ViewBox,
  factor: number,
  focus: { x: number; y: number },
) {
  return clampViewBox(
    {
      width: box.width / factor,
      height: box.height / factor,
      x: focus.x - (focus.x - box.x) / factor,
      y: focus.y - (focus.y - box.y) / factor,
    },
    full,
  );
}

function ChoroplethMap({
  dataBundle,
  selectedId,
  geoType,
}: {
  dataBundle: DataBundle;
  selectedId: string;
  geoType: GeographyType;
}) {
  const [boundaries, setBoundaries] = useState<Boundaries>();
  const [loadError, setLoadError] = useState(false);
  const [level, setLevel] = useState<MapLevel>(
    levelForGeoType(geoType) ?? "Place",
  );
  const [view, setView] = useState<MapView>(() =>
    viewForGeography(dataBundle, selectedId),
  );
  const [hoveredId, setHoveredId] = useState<string>();
  const [isOpen, setIsOpen] = useState(
    () => window.matchMedia("(min-width: 900px)").matches,
  );
  const [viewBox, setViewBox] = useState<ViewBox>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startBox: ViewBox;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!dataBundle.boundariesUrl || !isOpen) {
      return;
    }

    let cancelled = false;
    loadBoundaries(dataBundle.boundariesUrl)
      .then((data) => {
        if (!cancelled) {
          setBoundaries(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataBundle.boundariesUrl, isOpen]);

  // Follow the explorer's geography level, except for the region level.
  useEffect(() => {
    const nextLevel = levelForGeoType(geoType);
    if (nextLevel) {
      setLevel(nextLevel);
    }
  }, [geoType]);

  // Follow the explorer to the part of the state its selection is in.
  useEffect(() => {
    if (!selectedId.startsWith("region:")) {
      setView(viewForGeography(dataBundle, selectedId));
    }
  }, [dataBundle, selectedId]);

  const market = dataBundle.datasets.market;
  const map = useMemo(() => {
    if (!boundaries) {
      return undefined;
    }

    const inView = (feature: BoundaryFeature) =>
      viewForGeography(dataBundle, feature.properties.id) === view;
    const prefix = MAP_LEVELS.find((item) => item.id === level)!.prefix;
    const features = boundaries.features.filter(
      (feature) =>
        feature.properties.id.startsWith(prefix) &&
        market[level][feature.properties.id] &&
        inView(feature),
    );
    // County outlines give places and ZIP codes their bearings.
    const background =
      level === "County"
        ? []
        : boundaries.features.filter(
            (feature) =>
              feature.properties.id.startsWith("county:") && inView(feature),
          );
    const extent = extentOf([...features, ...background]);

    if (!extent) {
      return undefined;
    }

    const projection = makeProjection(extent);

    return {
      full: { x: 0, y: 0, width: VIEWBOX_WIDTH, height: projection.height },
      background: background.map((feature) => ({
        id: feature.properties.id,
        d: projection.path(feature),
      })),
      shapes: features.map((feature) => ({
        id: feature.properties.id,
        d: projection.path(feature),
        bin: valueBin(market[level][feature.properties.id].percentiles[49]),
      })),
    };
  }, [boundaries, dataBundle, level, market, view]);

  // Reset the zoom whenever the drawn map changes.
  useEffect(() => {
    setViewBox(map?.full);
  }, [map]);

  // Converts a screen position to map coordinates. The SVG keeps its aspect
  // ratio and centers the map, so one scale applies to both axes.
  const svgPoint = (clientX: number, clientY: number, box: ViewBox) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = Math.max(box.width / rect.width, box.height / rect.height);
    const offsetX = (rect.width * scale - box.width) / 2;
    const offsetY = (rect.height * scale - box.height) / 2;

    return {
      x: box.x + (clientX - rect.left) * scale - offsetX,
      y: box.y + (clientY - rect.top) * scale - offsetY,
      scale,
    };
  };

  const zoomBy = (factor: number, focus?: { x: number; y: number }) => {
    if (!map || !viewBox) {
      return;
    }

    setViewBox(
      zoomViewBox(
        viewBox,
        map.full,
        factor,
        focus ?? {
          x: viewBox.x + viewBox.width / 2,
          y: viewBox.y + viewBox.height / 2,
        },
      ),
    );
  };

  // Plain scrolling keeps scrolling the page; Ctrl/Cmd + scroll (and trackpad
  // pinch, which browsers report as Ctrl + wheel) zooms the map. React wheel
  // handlers are passive, so a native listener is needed to stop the browser
  // from zooming the whole page instead.
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const hasViewBox = viewBox !== undefined;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !map) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      const box = viewBoxRef.current;
      if (!box || !(event.ctrlKey || event.metaKey)) {
        return;
      }

      event.preventDefault();
      setViewBox(
        zoomViewBox(
          box,
          map.full,
          Math.exp(-event.deltaY * 0.01),
          svgPoint(event.clientX, event.clientY, box),
        ),
      );
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
    // svgPoint only reads the ref, so it doesn't need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hasViewBox]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!viewBox || event.button !== 0) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startBox: viewBox,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !map || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }

    if (!drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const { scale } = svgPoint(event.clientX, event.clientY, drag.startBox);
    setViewBox(
      clampViewBox(
        {
          ...drag.startBox,
          x: drag.startBox.x - dx * scale,
          y: drag.startBox.y - dy * scale,
        },
        map.full,
      ),
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.moved) {
      // A drag ends with a click on whatever shape is under the pointer.
      suppressClickRef.current = true;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;
  };

  const handleSelect = (id: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    window.location.hash = `#${id}`;
  };

  const hovered = hoveredId ?? selectedId;
  const hoveredStats = market[level][hovered];
  const hoveredMetadata = dataBundle.geographies[hovered];
  const hoveredCounty =
    hoveredMetadata?.type !== "County" && hoveredMetadata?.parentGeography
      ? dataBundle.geographies[hoveredMetadata.parentGeography]?.name
      : undefined;
  const isZoomed = Boolean(
    map && viewBox && viewBox.width < map.full.width - 0.5,
  );
  const levelLabel = MAP_LEVELS.find((item) => item.id === level)!.label;
  const selectedShape = map?.shapes.find((shape) => shape.id === selectedId);

  if (!dataBundle.boundariesUrl) {
    return null;
  }

  return (
    <article className="map-panel">
      <div className="map-heading">
        <div>
          <h2>Map</h2>
          <p className="subheader-description">
            Median market-adjusted home value. Click an area to explore it. Drag
            to pan; zoom with the buttons or Ctrl/⌘ + scroll.
          </p>
        </div>
        <button
          type="button"
          className="map-toggle"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? "Hide map" : "Show map"}
        </button>
      </div>

      {isOpen && (
        <>
          <div className="map-controls">
            <div
              className="segmented map-segmented map-level-segmented"
              role="group"
              aria-label="Map geography level"
            >
              {MAP_LEVELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={level === item.id ? "active" : ""}
                  aria-pressed={level === item.id}
                  onClick={() => setLevel(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              className="segmented map-segmented"
              role="group"
              aria-label="Map region"
            >
              {MAP_VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={view === item.id ? "active" : ""}
                  aria-pressed={view === item.id}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {loadError ? (
            <p className="context-unavailable">The map could not be loaded.</p>
          ) : !map || !viewBox ? (
            <p className="context-unavailable" role="status">
              Loading map...
            </p>
          ) : (
            <div className="map-frame">
              <svg
                ref={svgRef}
                className="map-svg"
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                role="img"
                aria-label={`Map of median market-adjusted home values by ${levelLabel}.`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onMouseLeave={() => setHoveredId(undefined)}
              >
                {map.background.map((shape) => (
                  <path key={shape.id} className="map-background" d={shape.d} />
                ))}
                {map.shapes.map((shape) => (
                  <path
                    key={shape.id}
                    className={`map-area${shape.id === hoveredId ? " is-hovered" : ""}`}
                    style={{ fill: `var(--seq-${shape.bin})` }}
                    d={shape.d}
                    onMouseEnter={() => setHoveredId(shape.id)}
                    onClick={() => handleSelect(shape.id)}
                  >
                    <title>{dataBundle.geographies[shape.id]?.name}</title>
                  </path>
                ))}
                {/* Drawn last so neighboring areas can't cover its outline. */}
                {selectedShape && (
                  <path className="map-selected-outline" d={selectedShape.d} />
                )}
              </svg>

              <div className="map-zoom" role="group" aria-label="Map zoom">
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => zoomBy(ZOOM_STEP)}
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={!isZoomed}
                  onClick={() => zoomBy(1 / ZOOM_STEP)}
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="Reset zoom"
                  disabled={!isZoomed}
                  onClick={() => setViewBox(map.full)}
                >
                  ⟲
                </button>
              </div>

              {hoveredStats && hoveredMetadata && (
                <div className="map-readout" aria-live="polite">
                  <strong>{hoveredMetadata.name}</strong>
                  {hoveredCounty && <span>{hoveredCounty}</span>}
                  <span className="map-readout-value">
                    {formatCurrency(hoveredStats.percentiles[49])}
                  </span>
                  <span>{formatNumber(hoveredStats.n)} homes</span>
                </div>
              )}
            </div>
          )}

          {map && (
            <ul className="map-legend" aria-label="Median value groups">
              {VALUE_BIN_LABELS.map((label, index) => (
                <li key={label}>
                  <span
                    className="map-legend-swatch"
                    style={{ background: `var(--seq-${index + 1})` }}
                    aria-hidden="true"
                  />
                  {label}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

export default ChoroplethMap;
