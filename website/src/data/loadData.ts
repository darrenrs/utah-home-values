import { withBaseUrl } from "../lib/baseUrl";

const SUPPORTED_SCHEMA_VERSION = 1;

export type DataSection = "Region" | "County" | "Place" | "ZCTA5";
export type ValueMode = "market" | "assessed";

export type ValueStats = {
  n: number;
  mean: number;
  percentiles: number[];
};

export type GeographyMetadata = {
  type: DataSection;
  name: string;
  parentGeography: string | null;
};

export type GeographyCatalog = Record<string, GeographyMetadata>;
export type AttributeData = Record<DataSection, Record<string, ValueStats>>;

export type EstimateWithMoe = {
  estimate: number;
  moe90: number;
};

export type AcsGeographyValues = {
  medianHouseholdIncome: EstimateWithMoe;
  ownerOccupiedPercent: EstimateWithMoe;
};

export type AcsValues = {
  acsVintageYear: number;
  geographies: Record<string, AcsGeographyValues>;
};

type DataManifest = {
  schemaVersion: number;
  generatedAt: string;
  datasets: {
    geographies: string;
    huiMarketAdjustedValues: string;
    huiAssessedValues: string;
    acsValues: string;
  };
};

export type DataBundle = {
  geographies: GeographyCatalog;
  datasets: Record<ValueMode, AttributeData>;
  acsValues: AcsValues;
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

  const [geographies, market, assessed, acsValues] = await Promise.all([
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
  ]);

  return {
    geographies,
    datasets: {
      market,
      assessed,
    },
    acsValues,
  };
}

export function loadData() {
  return (dataPromise ??= fetchData());
}
