import geopandas as gpd
import json
import math
import pandas as pd
import pyogrio
import re
import tempfile
import yaml
from datetime import datetime, timezone
from pathlib import Path
from shapely.errors import GEOSException
from shapely.geometry import Polygon, shape
from shapely.validation import explain_validity

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CONFIG_DIR = PROJECT_ROOT / "config"
RAW_DATA_DIR = PROJECT_ROOT / "data" / "raw"
SHAPEFILES_DIR = RAW_DATA_DIR / "shapefiles"
WEBSITE_DIR = PROJECT_ROOT / "website"
PROCESSED_DATA_DIR = WEBSITE_DIR / "public" / "data"

GDB_PATH = RAW_DATA_DIR / "HousingUnitInventory.gdb"
GDB_LAYER_NAME = "HousingUnitInventory"
COUNTY_QUALITY_PATH = CONFIG_DIR / "counties.yml"
SHAPEFILE_PLACE_ZIP_PATH = SHAPEFILES_DIR / "tl_2024_49_place.zip"
SHAPEFILE_ZCTA5_ZIP_PATH = SHAPEFILES_DIR / "tl_2024_us_zcta520.zip"

WASATCH_FRONT_ID = "region:wasatch-front"
SCHEMA_VERSION = 1
DATASET_FILENAMES = {
    "geographies": "geographies.json",
    "huiMarketAdjustedValues": "hui_market_adjusted_values.json",
    "huiAssessedValues": "hui_assessed_values.json",
    "acsValues": "acs_values.json",
}

MAX_POLYGON_VERTICES = 10_000
MAX_POLYGON_REPAIR_AREA_DELTA_RATIO = 0.01


def slugify(value: str):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def geography_id(namespace: str, source_id: str):
    normalized_id = slugify(str(source_id)) if namespace == "county" else str(source_id)
    return f"{namespace}:{normalized_id}"


def join_shapefile(
    hui_valid: gpd.GeoDataFrame,
    path: Path,
    column_mappings: dict[str, str],
    id_col: str,
):
    group_cols = list(column_mappings.values())
    shapes = gpd.read_file(
        f"zip://{path}",
        columns=[*column_mappings.keys(), "geometry"],
    )
    shapes = shapes.rename(columns=column_mappings)

    assert shapes.crs is not None, f"{path.name} has no CRS set"

    hui_points = hui_valid.to_crs(shapes.crs).copy()
    hui_points["geometry"] = hui_points.geometry.representative_point()

    joined = gpd.sjoin(
        hui_points,
        shapes,
        how="left",
        predicate="within",
    ).drop(columns=["index_right"], errors="ignore")

    matched = joined[joined[id_col].notna()]

    # Places and ZIP codes may cross county lines. Use the county containing the
    # largest number of matched home records as their comparison parent.
    primary_counties = (
        matched.groupby([id_col, "COUNTY"])
        .size()
        .reset_index(name="n")
        .sort_values([id_col, "n", "COUNTY"], ascending=[True, False, True])
        .drop_duplicates(id_col)
        .set_index(id_col)["COUNTY"]
    )

    raw_stats = summarize_grouped_values(matched, group_cols, "TOT_VALUE")
    adjusted_stats = summarize_grouped_values(matched, group_cols, "MARKET_ADJUSTED_VALUE")

    for stats in (raw_stats, adjusted_stats):
        stats["PRIMARY_COUNTY"] = stats[id_col].map(primary_counties)

    return raw_stats, adjusted_stats


def load_county_quality():
    with open(COUNTY_QUALITY_PATH, "r") as f:
        return yaml.safe_load(f)


def get_wasatch_front_counties(county_quality):
    return {
        county
        for county, quality in county_quality.items()
        if quality.get("is_valid") and quality.get("is_wasatch_front")
    }


def filter_valid_housing_units(hui_raw: gpd.GeoDataFrame, county_quality):
    hui_raw = hui_raw.copy()
    hui_raw["IS_OUG_CLEAN"] = pd.to_numeric(hui_raw["IS_OUG"], errors="coerce").fillna(0)
    hui_candidate = hui_raw[
        # Owner-unit-like residential records: single-family homes, townhomes, and condos
        hui_raw["SUBTYPE"].isin(["single_family", "townhome", "condo"])
        # Not an owned-unit grouping. Null is treated as non-OUG.
        & (hui_raw["IS_OUG_CLEAN"].fillna(0) != 1)
        # One dwelling unit represented by the record
        & (hui_raw["UNIT_COUNT"] == 1)
        # Plausible assessed value range
        & (hui_raw["TOT_VALUE"] >= 10_000)
        & (hui_raw["TOT_VALUE"] <= 20_000_000)
        # Plausible building square footage range
        & (hui_raw["TOT_BD_FT2"] >= 100)
        & (hui_raw["TOT_BD_FT2"] <= 30_000)
        # Plausible acreage
        & (hui_raw["ACRES"] > 0)
        & (hui_raw["ACRES"] <= 100)
    ].copy()

    quality_df = (
        pd.DataFrame.from_dict(county_quality, orient="index")
        .reset_index()
        .rename(columns={"index": "COUNTY"})
    )

    hui_candidate = hui_candidate.merge(
        quality_df,
        on="COUNTY",
        how="left",
        validate="many_to_one",
    )

    hui_valid = hui_candidate[
        (hui_candidate["is_valid"])
        & (hui_candidate["APX_BLT_YR"].notna())
        & (hui_candidate["APX_BLT_YR"] <= hui_candidate["latest_year_built_with_value"])
        & (hui_candidate["assessment_sales_ratio"].notna())
    ].copy()

    hui_valid["MARKET_ADJUSTED_VALUE"] = (
        hui_valid["TOT_VALUE"] / hui_valid["assessment_sales_ratio"]
    )

    return hui_valid


def load_valid_housing_units():
    hui_raw = gpd.read_file(GDB_PATH, layer=GDB_LAYER_NAME)
    return filter_valid_housing_units(hui_raw, load_county_quality())


def housing_representative_points(hui_valid: gpd.GeoDataFrame):
    hui_points = hui_valid.copy()
    hui_points["geometry"] = hui_points.geometry.representative_point()
    return hui_points


# Round value to nearest 1,000 (or 10^s)
def normalize_value(n: float, s=3):
    if math.isnan(n):
        return float("nan")

    return round(n / 10**s) * 10**s


# Summarize a df of home records
def summarize_values(df: pd.DataFrame, value_col: str):
    percentiles = [normalize_value(df[value_col].quantile(p / 100)) for p in range(1, 100)]

    return pd.Series(
        {
            "n": len(df),
            "mean": normalize_value(df[value_col].mean()),
            "percentiles": percentiles,
        }
    )


# Gets the value summary for a df grouped by some column
def summarize_grouped_values(df, group_cols, value_col):
    rows = []

    for keys, group in df.groupby(group_cols, dropna=False):
        if not isinstance(keys, tuple):
            keys = (keys,)

        group_identity = dict(zip(group_cols, keys))
        summary = summarize_values(group, value_col).to_dict()

        rows.append(
            {
                **group_identity,
                **summary,
            }
        )

    return pd.DataFrame(rows)


def clean_number(value):
    if pd.isna(value):
        return None

    numeric_value = float(value)
    if numeric_value.is_integer():
        return int(numeric_value)

    return numeric_value


def stats_payload(row):
    return {
        "n": int(row["n"]),
        "mean": clean_number(row["mean"]),
        "percentiles": [clean_number(value) for value in row["percentiles"]],
    }


class InvalidPolygonError(ValueError):
    pass


def extract_polygon_geojson(geojson):
    if not isinstance(geojson, dict):
        raise InvalidPolygonError("Request body must be a GeoJSON Polygon")

    geojson_type = geojson.get("type")

    if geojson_type == "Polygon":
        return geojson

    if geojson_type == "Feature":
        return extract_polygon_geojson(geojson.get("geometry"))

    if geojson_type == "FeatureCollection":
        features = geojson.get("features")
        if not isinstance(features, list) or len(features) != 1:
            raise InvalidPolygonError("GeoJSON FeatureCollection must contain exactly one Polygon")

        return extract_polygon_geojson(features[0])

    raise InvalidPolygonError("Request body must be a GeoJSON Polygon")


def parse_polygon(polygon_geojson):
    polygon_geojson = extract_polygon_geojson(polygon_geojson)

    try:
        polygon = shape(polygon_geojson)
    except (AttributeError, GEOSException, TypeError, ValueError) as exc:
        raise InvalidPolygonError("Invalid GeoJSON Polygon") from exc

    if not isinstance(polygon, Polygon):
        raise InvalidPolygonError("Request body must be a GeoJSON Polygon")

    if polygon.is_empty:
        raise InvalidPolygonError("Polygon must not be empty")

    rings = [polygon.exterior, *polygon.interiors]
    coordinates = [coordinate for ring in rings for coordinate in ring.coords]

    if len(coordinates) > MAX_POLYGON_VERTICES:
        raise InvalidPolygonError(f"Polygon must not exceed {MAX_POLYGON_VERTICES} vertices")

    if any(not math.isfinite(value) for coordinate in coordinates for value in coordinate):
        raise InvalidPolygonError("Polygon coordinates must be finite numbers")

    min_x, min_y, max_x, max_y = polygon.bounds
    if min_x < -180 or max_x > 180 or min_y < -90 or max_y > 90:
        raise InvalidPolygonError("Polygon coordinates must be longitude and latitude")

    if not polygon.is_valid:
        repaired = polygon.buffer(0)
        area_delta_ratio = (
            abs(repaired.area - polygon.area) / repaired.area if repaired.area else math.inf
        )

        if (
            not isinstance(repaired, Polygon)
            or repaired.is_empty
            or area_delta_ratio > MAX_POLYGON_REPAIR_AREA_DELTA_RATIO
        ):
            raise InvalidPolygonError(f"Invalid polygon geometry: {explain_validity(polygon)}")

        polygon = repaired

    return polygon


def summarize_polygon(hui_points: gpd.GeoDataFrame, polygon_geojson):
    if hui_points.crs is None:
        raise ValueError("Housing unit geometries must have a CRS")

    polygon_wgs84 = parse_polygon(polygon_geojson)
    polygon = gpd.GeoSeries([polygon_wgs84], crs="EPSG:4326").to_crs(hui_points.crs)[0]

    candidate_indexes = hui_points.sindex.query(polygon)
    candidates = hui_points.iloc[candidate_indexes]
    matched = candidates[candidates.geometry.within(polygon)]

    return {
        "assessed": stats_payload(summarize_values(matched, "TOT_VALUE")),
        "marketAdjusted": stats_payload(summarize_values(matched, "MARKET_ADJUSTED_VALUE")),
    }


def load_polygon_summary_housing_points():
    return housing_representative_points(load_valid_housing_units())


def grouped_stats_payload(df: pd.DataFrame, namespace: str, id_col: str):
    return {
        geography_id(namespace, row[id_col]): stats_payload(row)
        for row in df.to_dict(orient="records")
    }


def build_attribute_payload(
    wasatch_front_stats: pd.Series,
    county_stats: pd.DataFrame,
    place_stats: pd.DataFrame,
    zcta5_stats: pd.DataFrame,
):
    return {
        "Region": {WASATCH_FRONT_ID: stats_payload(wasatch_front_stats)},
        "County": grouped_stats_payload(county_stats, "county", "COUNTY"),
        "Place": grouped_stats_payload(place_stats, "place", "PLACE_GEOID"),
        "ZCTA5": grouped_stats_payload(zcta5_stats, "zcta5", "ZCTA5_GEOID"),
    }


def geography_payload(geography_type: str, name: str, parent_geography=None):
    return {
        "type": geography_type,
        "name": name,
        "parentGeography": parent_geography,
    }


def build_geography_catalog(
    county_stats: pd.DataFrame,
    place_stats: pd.DataFrame,
    zcta5_stats: pd.DataFrame,
    wasatch_front_counties: set[str],
):
    catalog = {
        WASATCH_FRONT_ID: geography_payload("Region", "Wasatch Front"),
    }

    for row in county_stats.to_dict(orient="records"):
        catalog[geography_id("county", row["COUNTY"])] = geography_payload(
            "County",
            row["COUNTY_NAMELSAD"],
            WASATCH_FRONT_ID if row["COUNTY"] in wasatch_front_counties else None,
        )

    for row in place_stats.to_dict(orient="records"):
        catalog[geography_id("place", row["PLACE_GEOID"])] = geography_payload(
            "Place",
            row["PLACE_NAME"],
            geography_id("county", row["PRIMARY_COUNTY"]),
        )

    for row in zcta5_stats.to_dict(orient="records"):
        catalog[geography_id("zcta5", row["ZCTA5_GEOID"])] = geography_payload(
            "ZCTA5",
            row["ZCTA5_NAMELSAD"],
            geography_id("county", row["PRIMARY_COUNTY"]),
        )

    return catalog


def write_json(path: Path, payload):
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))


def publish_json_payloads(output_dir: Path, payloads, validate_payloads=None):
    if validate_payloads is not None:
        validate_payloads(payloads)

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=".generated-data-", dir=output_dir.parent) as staging_dir:
        staging_path = Path(staging_dir)

        for filename, payload in payloads.items():
            write_json(staging_path / filename, payload)

        for filename in payloads:
            (staging_path / filename).replace(output_dir / filename)


def build_manifest():
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "datasets": DATASET_FILENAMES,
    }


def main():
    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Debugging only
    print("Layers:")
    print(pyogrio.list_layers(GDB_PATH))

    # Load in and filter GDB
    hui_raw = gpd.read_file(GDB_PATH, layer=GDB_LAYER_NAME)

    print("GDB df Shape:")
    print(hui_raw.shape)

    county_quality = load_county_quality()
    wasatch_front_counties = get_wasatch_front_counties(county_quality)
    hui_valid = filter_valid_housing_units(hui_raw, county_quality)

    hui_wasatch_front = hui_valid[hui_valid["is_wasatch_front"]].copy()

    wasatch_front_raw_stats = summarize_values(hui_wasatch_front, "TOT_VALUE")
    wasatch_front_adjusted_stats = summarize_values(hui_wasatch_front, "MARKET_ADJUSTED_VALUE")

    # Aggregate by county
    county_raw_stats = (
        hui_valid.groupby("COUNTY").apply(lambda g: summarize_values(g, "TOT_VALUE")).reset_index()
    )
    county_raw_stats["COUNTY_NAMELSAD"] = county_raw_stats["COUNTY"].map(
        lambda county: f"{county} County"
    )

    county_adjusted_stats = (
        hui_valid.groupby("COUNTY")
        .apply(lambda g: summarize_values(g, "MARKET_ADJUSTED_VALUE"))
        .reset_index()
    )
    county_adjusted_stats["COUNTY_NAMELSAD"] = county_adjusted_stats["COUNTY"].map(
        lambda county: f"{county} County"
    )

    # Join with spatial data
    column_mappings_place = {
        "GEOID": "PLACE_GEOID",
        "NAME": "PLACE_NAME",
        "NAMELSAD": "PLACE_NAMELSAD",
    }

    place_raw_stats, place_adjusted_stats = join_shapefile(
        hui_valid, SHAPEFILE_PLACE_ZIP_PATH, column_mappings_place, "PLACE_GEOID"
    )

    column_mappings_zcta5 = {
        "ZCTA5CE20": "ZCTA5_GEOID",
        "GEOID20": "ZCTA5_NAMELSAD",
    }

    zcta5_raw_stats, zcta5_adjusted_stats = join_shapefile(
        hui_valid, SHAPEFILE_ZCTA5_ZIP_PATH, column_mappings_zcta5, "ZCTA5_GEOID"
    )

    geography_catalog = build_geography_catalog(
        county_raw_stats,
        place_raw_stats,
        zcta5_raw_stats,
        wasatch_front_counties,
    )

    assessed_values = build_attribute_payload(
        wasatch_front_raw_stats,
        county_raw_stats,
        place_raw_stats,
        zcta5_raw_stats,
    )

    market_adjusted_values = build_attribute_payload(
        wasatch_front_adjusted_stats,
        county_adjusted_stats,
        place_adjusted_stats,
        zcta5_adjusted_stats,
    )

    publish_json_payloads(
        PROCESSED_DATA_DIR,
        {
            DATASET_FILENAMES["geographies"]: geography_catalog,
            DATASET_FILENAMES["huiAssessedValues"]: assessed_values,
            DATASET_FILENAMES["huiMarketAdjustedValues"]: market_adjusted_values,
            "manifest.json": build_manifest(),
        },
    )


if __name__ == "__main__":
    main()
