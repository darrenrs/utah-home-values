import { withBaseUrl } from "../lib/baseUrl";

const SUPPORTED_SCHEMA_VERSION = 1;

export type DataSection = "Region" | "County" | "Place" | "ZCTA5";
export type ValueMode = "market" | "assessed";

export type ValueStats = {
  n: number;
  mean: number;
  total: number;
  percentiles: number[];
};

export type GeographyMetadata = {
  type: DataSection;
  name: string;
  parentGeography: string | null;
  assessedValueYear: number | null;
};

export type GeographyCatalog = Record<string, GeographyMetadata>;
export type AttributeData = Record<DataSection, Record<string, ValueStats>>;

// Null when the Census Bureau reports the value as unavailable.
export type EstimateWithMoe = {
  estimate: number | null;
  moe90: number | null;
};

export type AcsGeographyValues = {
  medianHouseholdIncome: EstimateWithMoe;
  ownerOccupiedPercent: EstimateWithMoe;
};

export type AcsValues = {
  acsVintageYear: number;
  geographies: Record<string, AcsGeographyValues>;
};

export type MarketContext = {
  marketValueYear: number;
  latestQuarter: string;
  metros: Record<
    string,
    { name: string; series: string; changePercent: number }
  >;
  counties: Record<
    string,
    {
      assessedValueYear: number | null;
      metro: string | null;
    }
  >;
};

export type HousingStockValues = {
  n: number;
  medianYearBuilt: number;
  yearBuiltP25: number;
  yearBuiltP75: number;
  yearBuiltShares: number[];
  medianLotAcres: number;
  lotAcresP25: number;
  lotAcresP75: number;
  lotSizeShares: number[];
};

export type HousingStock = {
  yearBuiltBands: string[];
  lotSizeBands: string[];
  geographies: Record<string, HousingStockValues>;
};

export type BoundaryFeature = {
  type: "Feature";
  properties: { id: string };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
};

export type Boundaries = {
  type: "FeatureCollection";
  features: BoundaryFeature[];
};

type DataManifest = {
  schemaVersion: number;
  generatedAt: string;
  datasets: {
    geographies: string;
    huiMarketAdjustedValues: string;
    huiAssessedValues: string;
    acsValues: string;
    marketContext?: string;
    housingStock?: string;
    boundaries?: string;
  };
};

export type DataBundle = {
  geographies: GeographyCatalog;
  datasets: Record<ValueMode, AttributeData>;
  // Missing when the ACS download hasn't run or failed; Housing Context then
  // shows "Not available".
  acsValues?: AcsValues;
  // Missing when the data predates market context; features that need it hide.
  marketContext?: MarketContext;
  housingStock?: HousingStock;
  // Boundaries are large, so the map fetches them on demand.
  boundariesUrl?: string;
};

let dataPromise: Promise<DataBundle> | undefined;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Data request failed (${response.status}): ${url}`);
  }

  return (await response.json()) as T;
}

function assertSupportedManifest(
  manifest: unknown,
): asserts manifest is DataManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Invalid data manifest");
  }

  const candidate = manifest as Partial<DataManifest>;

  if (candidate.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported data schema version: ${String(candidate.schemaVersion)}`,
    );
  }

  if (
    !candidate.datasets ||
    typeof candidate.datasets.geographies !== "string" ||
    typeof candidate.datasets.huiMarketAdjustedValues !== "string" ||
    typeof candidate.datasets.huiAssessedValues !== "string" ||
    typeof candidate.datasets.acsValues !== "string"
  ) {
    throw new Error("Invalid dataset paths in data manifest");
  }
}

// Dataset file names stay the same between data updates, so each URL carries
// the manifest's generation time. A browser that cached the previous files then
// fetches the new ones, and unchanged data stays cached.
function resolveDatasetUrl(
  manifest: DataManifest,
  manifestUrl: string,
  datasetPath: string,
) {
  const url = new URL(datasetPath, new URL(manifestUrl, window.location.href));
  url.searchParams.set("v", manifest.generatedAt);
  return url.href;
}

async function fetchData(): Promise<DataBundle> {
  const manifestUrl = withBaseUrl("data/manifest.json");
  // Always revalidate the manifest; it is small and names the current data.
  const manifest = await fetchJson<unknown>(manifestUrl, { cache: "no-cache" });

  assertSupportedManifest(manifest);

  const marketContextPath = manifest.datasets.marketContext;
  const housingStockPath = manifest.datasets.housingStock;
  const [
    geographies,
    market,
    assessed,
    acsValues,
    marketContext,
    housingStock,
  ] = await Promise.all([
    fetchJson<GeographyCatalog>(
      resolveDatasetUrl(manifest, manifestUrl, manifest.datasets.geographies),
    ),
    fetchJson<AttributeData>(
      resolveDatasetUrl(
        manifest,
        manifestUrl,
        manifest.datasets.huiMarketAdjustedValues,
      ),
    ),
    fetchJson<AttributeData>(
      resolveDatasetUrl(
        manifest,
        manifestUrl,
        manifest.datasets.huiAssessedValues,
      ),
    ),
    fetchJson<AcsValues>(
      resolveDatasetUrl(manifest, manifestUrl, manifest.datasets.acsValues),
    ).catch(() => undefined),
    marketContextPath
      ? fetchJson<MarketContext>(
          resolveDatasetUrl(manifest, manifestUrl, marketContextPath),
        )
      : Promise.resolve(undefined),
    housingStockPath
      ? fetchJson<HousingStock>(
          resolveDatasetUrl(manifest, manifestUrl, housingStockPath),
        )
      : Promise.resolve(undefined),
  ]);

  return {
    geographies,
    datasets: {
      market,
      assessed,
    },
    acsValues,
    marketContext,
    housingStock,
    boundariesUrl: manifest.datasets.boundaries
      ? resolveDatasetUrl(manifest, manifestUrl, manifest.datasets.boundaries)
      : undefined,
  };
}

let boundariesPromise: Promise<Boundaries> | undefined;

export function loadBoundaries(url: string) {
  return (boundariesPromise ??= fetchJson<Boundaries>(url));
}

export function loadData() {
  return (dataPromise ??= fetchData());
}
