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
      adjustmentFactor: number;
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
  acsValues: AcsValues;
  // Missing when the data predates market context; features that need it hide.
  marketContext?: MarketContext;
  housingStock?: HousingStock;
  // Boundaries are large, so the map fetches them on demand.
  boundariesUrl?: string;
};

let dataPromise: Promise<DataBundle> | undefined;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

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

function resolveDatasetUrl(manifestUrl: string, datasetPath: string) {
  return new URL(datasetPath, new URL(manifestUrl, window.location.href)).href;
}

async function fetchData(): Promise<DataBundle> {
  const manifestUrl = withBaseUrl("data/manifest.json");
  const manifest = await fetchJson<unknown>(manifestUrl);

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
      resolveDatasetUrl(manifestUrl, manifest.datasets.geographies),
    ),
    fetchJson<AttributeData>(
      resolveDatasetUrl(manifestUrl, manifest.datasets.huiMarketAdjustedValues),
    ),
    fetchJson<AttributeData>(
      resolveDatasetUrl(manifestUrl, manifest.datasets.huiAssessedValues),
    ),
    fetchJson<AcsValues>(
      resolveDatasetUrl(manifestUrl, manifest.datasets.acsValues),
    ),
    marketContextPath
      ? fetchJson<MarketContext>(
          resolveDatasetUrl(manifestUrl, marketContextPath),
        )
      : Promise.resolve(undefined),
    housingStockPath
      ? fetchJson<HousingStock>(
          resolveDatasetUrl(manifestUrl, housingStockPath),
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
      ? resolveDatasetUrl(manifestUrl, manifest.datasets.boundaries)
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
