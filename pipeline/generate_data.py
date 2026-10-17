import geopandas as gpd
import json
import math
import pandas as pd
import pyogrio
import re
import tempfile
import yaml
from typing import NamedTuple
from datetime import datetime, timezone
from pathlib import Path
from shapely.errors import GEOSException
from shapely.geometry import Polygon, shape
from shapely.validation import explain_validity

from pipeline.validate_data import (
    DataValidationError,
    validate_generated_values,
    validate_housing_source_records,
    validate_record_count_change,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CONFIG_DIR = PROJECT_ROOT / "config"
RAW_DATA_DIR = PROJECT_ROOT / "data" / "raw"
SHAPEFILES_DIR = RAW_DATA_DIR / "shapefiles"
WEBSITE_DIR = PROJECT_ROOT / "website"
PROCESSED_DATA_DIR = WEBSITE_DIR / "public" / "data"

GDB_PATH = RAW_DATA_DIR / "HousingUnitInventory.gdb"
GDB_LAYER_NAME = "HousingUnitInventory"
COUNTY_QUALITY_PATH = CONFIG_DIR / "counties.yml"
MARKET_CONTEXT_PATH = CONFIG_DIR / "market_context.yml"
SHAPEFILE_PLACE_ZIP_PATH = SHAPEFILES_DIR / "tl_2024_49_place.zip"
SHAPEFILE_ZCTA5_ZIP_PATH = SHAPEFILES_DIR / "tl_2024_us_zcta520.zip"
# Cartographic boundary file: clipped to the shoreline and lighter than TIGER/Line.
SHAPEFILE_COUNTY_ZIP_PATH = SHAPEFILES_DIR / "cb_2024_us_county_500k.zip"
UTAH_STATE_FIPS = "49"

WASATCH_FRONT_ID = "region:wasatch-front"
SCHEMA_VERSION = 1
DATASET_FILENAMES = {
    "geographies": "geographies.json",
    "huiMarketAdjustedValues": "hui_market_adjusted_values.json",
    "huiAssessedValues": "hui_assessed_values.json",
    "acsValues": "acs_values.json",
    "marketContext": "market_context.json",
    "housingStock": "housing_stock.json",
    "boundaries": "boundaries.json",
}

MAX_POLYGON_VERTICES = 10_000
MAX_POLYGON_REPAIR_AREA_DELTA_RATIO = 0.01
PRIMARY_ASSESSED_VALUE_YEAR_MIN_SHARE = 0.9
MIN_SINGLE_FAMILY_ACRES = 0.05
SMALL_LOT_EXEMPT_BEFORE_YEAR = 2000
MIN_PUBLISHED_GEOGRAPHY_RECORD_COUNT = 20
MIN_ZCTA_COVERED_AREA_SHARE = 0.5
# NAD83 / Conus Albers, an equal-area projection for comparing land areas
EQUAL_AREA_CRS = "EPSG:5070"
MIN_RECORDED_BUILDING_SQFT = 100
MISSING_SQFT_MIN_COHORT_VALUE_SHARE = 0.5
MIN_CITY_COHORT_SIZE = 10
# Bands are (label, lower bound inclusive, upper bound exclusive); None is open.
YEAR_BUILT_BANDS = [
    ("Before 1945", None, 1945),
    ("1945–1969", 1945, 1970),
    ("1970–1989", 1970, 1990),
    ("1990–1999", 1990, 2000),
    ("2000–2009", 2000, 2010),
    ("2010–2019", 2010, 2020),
    ("2020 or later", 2020, None),
]
LOT_SIZE_BANDS = [
    ("Under 0.15 ac", None, 0.15),
    ("0.15–0.2 ac", 0.15, 0.2),
    ("0.2–0.3 ac", 0.2, 0.3),
    ("0.3–0.5 ac", 0.3, 0.5),
    ("0.5–1 ac", 0.5, 1.0),
    ("1–3 ac", 1.0, 3.0),
    ("3 ac or more", 3.0, None),
]
# About 150 m; enough detail for a city-scale choropleth at a fraction of the size.
BOUNDARY_SIMPLIFY_TOLERANCE_DEGREES = 0.0015
BOUNDARY_COORDINATE_DECIMALS = 4


def slugify(value: str):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def geography_id(namespace: str, source_id: str):
    normalized_id = slugify(str(source_id)) if namespace == "county" else str(source_id)
    return f"{namespace}:{normalized_id}"


# Places and ZIP codes with too few homes produce unreliable percentiles that
# effectively describe individual parcels, so they are not published.
def drop_small_geographies(stats: pd.DataFrame):
    return stats[stats["n"] >= MIN_PUBLISHED_GEOGRAPHY_RECORD_COUNT].reset_index(drop=True)


# Places and ZIP codes may mix counties with different assessment years. Like
# custom areas in the API, they only get an assessed year when at least 90% of
# their homes share it; otherwise assessed values are not comparable.
def geography_assessed_value_years(matched: pd.DataFrame, id_col: str):
    return {
        geography: primary_assessed_value_year(group, PRIMARY_ASSESSED_VALUE_YEAR_MIN_SHARE)
        for geography, group in matched.groupby(id_col)
    }


class JoinedGeographies(NamedTuple):
    raw_stats: pd.DataFrame
    adjusted_stats: pd.DataFrame
    housing_stock: dict
    boundaries: list


# Year-built mix and lot sizes for a group of homes. Square footage is left out
# on purpose: counties disagree on whether it includes basements.
def band_shares(values: pd.Series, bands):
    shares = []
    for _, lower, upper in bands:
        in_band = pd.Series(True, index=values.index)
        if lower is not None:
            in_band &= values >= lower
        if upper is not None:
            in_band &= values < upper
        shares.append(round(float(in_band.mean()), 3))

    return shares


# Year-built mix and lot sizes for a group of homes. Square footage is left out
# on purpose: counties disagree on whether it includes basements.
def summarize_housing_stock(df: pd.DataFrame):
    years = df["APX_BLT_YR"]
    acres = df["ACRES"]

    return {
        "n": len(df),
        "medianYearBuilt": int(round(years.median())),
        "yearBuiltP25": int(round(years.quantile(0.25))),
        "yearBuiltP75": int(round(years.quantile(0.75))),
        "yearBuiltShares": band_shares(years, YEAR_BUILT_BANDS),
        "medianLotAcres": round(float(acres.median()), 3),
        "lotAcresP25": round(float(acres.quantile(0.25)), 3),
        "lotAcresP75": round(float(acres.quantile(0.75)), 3),
        "lotSizeShares": band_shares(acres, LOT_SIZE_BANDS),
    }


def load_county_shapes():
    return gpd.read_file(
        f"zip://{SHAPEFILE_COUNTY_ZIP_PATH}", columns=["STATEFP", "NAME", "geometry"]
    )


def load_county_boundaries(county_names):
    counties = load_county_shapes()
    counties = counties[
        (counties["STATEFP"] == UTAH_STATE_FIPS) & counties["NAME"].isin(county_names)
    ]
    return simplified_boundary_features(counties, "NAME", "county")


# Share of each shape's area that lies in the covered Utah counties. Area stands
# in for homes, the same measure as the Census ZCTA-to-county relationship file.
def covered_area_shares(
    shapes: gpd.GeoDataFrame, id_col: str, counties: gpd.GeoDataFrame, covered_county_names
):
    counties = counties.to_crs(EQUAL_AREA_CRS)
    counties["covered"] = (counties["STATEFP"] == UTAH_STATE_FIPS) & counties["NAME"].isin(
        covered_county_names
    )
    pieces = gpd.overlay(
        shapes[[id_col, "geometry"]].to_crs(EQUAL_AREA_CRS),
        counties[["covered", "geometry"]],
        how="intersection",
        keep_geom_type=True,
    )
    pieces["area"] = pieces.area
    total_area = pieces.groupby(id_col)["area"].sum()
    covered_area = pieces[pieces["covered"]].groupby(id_col)["area"].sum()
    return covered_area.reindex(total_area.index, fill_value=0) / total_area


def round_coordinates(coordinates, decimals=BOUNDARY_COORDINATE_DECIMALS):
    if isinstance(coordinates[0], (int, float)):
        return [round(value, decimals) for value in coordinates]

    return [round_coordinates(part, decimals) for part in coordinates]


def simplified_boundary_features(shapes: gpd.GeoDataFrame, id_col: str, namespace: str):
    shapes = shapes.to_crs("EPSG:4326")
    features = []
    for row in shapes.itertuples():
        geometry = getattr(row, "geometry").simplify(
            BOUNDARY_SIMPLIFY_TOLERANCE_DEGREES, preserve_topology=True
        )
        if geometry.is_empty:
            continue

        geojson = geometry.__geo_interface__
        features.append(
            {
                "type": "Feature",
                "properties": {"id": geography_id(namespace, getattr(row, id_col))},
                "geometry": {
                    "type": geojson["type"],
                    "coordinates": round_coordinates(geojson["coordinates"]),
                },
            }
        )

    return features


def join_shapefile(
    hui_valid: gpd.GeoDataFrame,
    path: Path,
    column_mappings: dict[str, str],
    id_col: str,
    namespace: str,
    min_covered_area_share: float | None = None,
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

    assessed_value_years = geography_assessed_value_years(matched, id_col)

    raw_stats = summarize_grouped_values(matched, group_cols, "TOT_VALUE")
    adjusted_stats = summarize_grouped_values(matched, group_cols, "MARKET_ADJUSTED_VALUE")

    for stats in (raw_stats, adjusted_stats):
        stats["PRIMARY_COUNTY"] = stats[id_col].map(primary_counties)
        stats["ASSESSED_VALUE_YEAR"] = stats[id_col].map(assessed_value_years)

    raw_stats = drop_small_geographies(raw_stats)
    adjusted_stats = drop_small_geographies(adjusted_stats)

    # A ZIP code lying mostly outside the covered counties would be labeled
    # with the whole ZIP code, and paired with ZIP-wide ACS figures, while
    # describing only a sliver of its homes.
    if min_covered_area_share is not None:
        shares = covered_area_shares(
            shapes[shapes[id_col].isin(raw_stats[id_col])],
            id_col,
            load_county_shapes(),
            set(hui_valid["COUNTY"]),
        )
        covered_ids = set(shares[shares >= min_covered_area_share].index)
        raw_stats = raw_stats[raw_stats[id_col].isin(covered_ids)].reset_index(drop=True)
        adjusted_stats = adjusted_stats[adjusted_stats[id_col].isin(covered_ids)].reset_index(
            drop=True
        )

    published_ids = set(raw_stats[id_col])

    housing_stock = {
        geography_id(namespace, geography): summarize_housing_stock(group)
        for geography, group in matched.groupby(id_col)
        if geography in published_ids
    }
    boundaries = simplified_boundary_features(
        shapes[shapes[id_col].isin(published_ids)], id_col, namespace
    )

    return JoinedGeographies(raw_stats, adjusted_stats, housing_stock, boundaries)


def load_county_quality():
    with open(COUNTY_QUALITY_PATH, "r") as f:
        return yaml.safe_load(f)


def load_market_context_config():
    with open(MARKET_CONTEXT_PATH, "r") as f:
        return yaml.safe_load(f)


# Per-county assessed years and metro price changes for the site's
# market-value label and "prices since" note.
def build_market_context(county_quality, market_config):
    metros = {}
    metro_by_county = {}
    for metro_id, metro in market_config["metros"].items():
        change = metro["latest_quarter_value"] / metro["market_value_year_average"] - 1
        metros[metro_id] = {
            "name": metro["name"],
            "series": metro["series"],
            "changePercent": round(change * 100, 1),
        }
        for county in metro["counties"]:
            metro_by_county[county] = metro_id

    counties = {
        geography_id("county", county): {
            "assessedValueYear": clean_year(quality["assessed_value_year"]),
            "metro": metro_by_county.get(county),
        }
        for county, quality in county_quality.items()
        if quality.get("is_valid")
    }

    return {
        "marketValueYear": int(market_config["market_value_year"]),
        "latestQuarter": str(market_config["latest_quarter"]),
        "metros": metros,
        "counties": counties,
    }


def get_wasatch_front_counties(county_quality):
    return {
        county
        for county, quality in county_quality.items()
        if quality.get("is_valid") and quality.get("is_wasatch_front")
    }


def filter_valid_housing_units(hui_raw: gpd.GeoDataFrame, county_quality):
    hui_raw = hui_raw.copy()
    if "IS_OUG" in hui_raw:
        hui_raw["IS_OUG_CLEAN"] = pd.to_numeric(hui_raw["IS_OUG"], errors="coerce").fillna(0)
    else:
        hui_raw["IS_OUG_CLEAN"] = 0

    hui_candidate = hui_raw[
        # Detached single-family homes only. Townhomes and condos are reported
        # inconsistently across counties (mostly grouped outside Utah County).
        (hui_raw["SUBTYPE"] == "single_family")
        # Not an owned-unit grouping. Null is treated as non-OUG: several
        # counties leave IS_OUG blank for recent builds, but single-family
        # records are OUG under 1% of the time, so this lets through at most
        # a few dozen grouped records.
        & (hui_raw["IS_OUG_CLEAN"].fillna(0) != 1)
        # One dwelling unit represented by the record
        & (hui_raw["UNIT_COUNT"] == 1)
        # Plausible assessed value range. Values under $50,000 are mostly
        # land-only or partial assessments; low-cost areas such as Wendover
        # have many genuine homes between $50,000 and $100,000.
        & (hui_raw["TOT_VALUE"] >= 50_000)
        & (hui_raw["TOT_VALUE"] <= 20_000_000)
        # Implausibly large building square footage. Missing or zero square
        # footage is handled by drop_partial_values_missing_sqft.
        & ~(hui_raw["TOT_BD_FT2"] > 30_000)
        # Plausible acreage
        & (hui_raw["ACRES"] > 0)
        & (hui_raw["ACRES"] <= 100)
        # Lots under 0.05 acres built since 2000 are mostly townhome, twin-home,
        # or PUD units subtyped as single_family. Older small lots are mostly
        # genuine detached cottages, so they are exempt.
        & (
            (hui_raw["ACRES"] >= MIN_SINGLE_FAMILY_ACRES)
            | (hui_raw["APX_BLT_YR"] < SMALL_LOT_EXEMPT_BEFORE_YEAR)
        )
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
    if "hpi_ratio" not in hui_candidate:
        hui_candidate["hpi_ratio"] = 1.0

    hui_valid = hui_candidate[
        (hui_candidate["is_valid"])
        & (hui_candidate["APX_BLT_YR"].notna())
        & (hui_candidate["APX_BLT_YR"] <= hui_candidate["latest_year_built_with_value"])
        & (hui_candidate["assessment_sales_ratio"].notna())
    ].copy()

    # Records that share an identical parcel footprint are stacked or grouped
    # units rather than separate detached homes.
    footprints = hui_valid.geometry.to_wkb()
    hui_valid = hui_valid[~(footprints.notna() & footprints.duplicated(keep=False))].copy()
    hui_valid = drop_partial_values_missing_sqft(hui_valid)

    hui_valid["MARKET_ADJUSTED_VALUE"] = (
        hui_valid["TOT_VALUE"] / hui_valid["assessment_sales_ratio"] * hui_valid["hpi_ratio"]
    )

    return hui_valid


# Square footage is often missing for recent builds whose values are already
# complete, but in some exports it is missing for unfinished homes carrying
# land-only or partial values. Keep a home without recorded square footage only
# if its value is at least half the median for homes with square footage in the
# same county, city, and build year (or county and build year when that city
# cohort is small). Homes with no cohort to compare against are dropped.
def drop_partial_values_missing_sqft(hui_valid: pd.DataFrame):
    missing_sqft = ~(hui_valid["TOT_BD_FT2"] >= MIN_RECORDED_BUILDING_SQFT)
    city = hui_valid["CITY"].fillna("") if "CITY" in hui_valid else ""
    homes = pd.DataFrame(
        {
            "COUNTY": hui_valid["COUNTY"],
            "CITY": city,
            "APX_BLT_YR": hui_valid["APX_BLT_YR"],
            "TOT_VALUE": hui_valid["TOT_VALUE"],
        },
        index=hui_valid.index,
    )
    peers = homes[~missing_sqft]
    city_cohorts = peers.groupby(["COUNTY", "CITY", "APX_BLT_YR"])["TOT_VALUE"].agg(
        city_median="median", city_size="size"
    )
    year_cohorts = peers.groupby(["COUNTY", "APX_BLT_YR"])["TOT_VALUE"].median().rename(
        "year_median"
    )
    homes = homes.join(city_cohorts, on=["COUNTY", "CITY", "APX_BLT_YR"]).join(
        year_cohorts, on=["COUNTY", "APX_BLT_YR"]
    )
    cohort_median = homes["city_median"].where(
        homes["city_size"] >= MIN_CITY_COHORT_SIZE, homes["year_median"]
    )
    keep = ~missing_sqft | (
        homes["TOT_VALUE"] >= MISSING_SQFT_MIN_COHORT_VALUE_SHARE * cohort_median
    )

    return hui_valid[keep].copy()


def load_housing_units():
    # Some HUI exports contain unclosed rings. Close them during WKB decoding,
    # before Shapely constructs the polygons; unrepairable geometries remain null
    # and are rejected by source validation if retained after filtering.
    return gpd.read_file(
        GDB_PATH, layer=GDB_LAYER_NAME, engine="pyogrio", on_invalid="fix"
    )


def load_valid_housing_units():
    hui_raw = load_housing_units()
    validate_housing_source_records(hui_raw, require_values=False)
    hui_valid = filter_valid_housing_units(hui_raw, load_county_quality())
    validate_housing_source_records(hui_valid)
    return hui_valid


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
            "total": normalize_value(df[value_col].sum()),
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
        "total": clean_number(row["total"]),
        "percentiles": [clean_number(value) for value in row["percentiles"]],
    }


def clean_year(value):
    if pd.isna(value):
        return None

    return int(value)


def primary_assessed_value_year(df: pd.DataFrame, min_share: float = 0):
    if "assessed_value_year" not in df or df.empty:
        return None

    counts = df["assessed_value_year"].dropna().value_counts()
    if counts.empty:
        return None

    primary_year = counts.index[0]
    if counts.iloc[0] / counts.sum() < min_share:
        return None

    return clean_year(primary_year)


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
        "assessedValueYear": primary_assessed_value_year(
            matched, PRIMARY_ASSESSED_VALUE_YEAR_MIN_SHARE
        ),
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


def geography_payload(
    geography_type: str,
    name: str,
    parent_geography=None,
    assessed_value_year=None,
):
    return {
        "type": geography_type,
        "name": name,
        "parentGeography": parent_geography,
        "assessedValueYear": clean_year(assessed_value_year),
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
            row["ASSESSED_VALUE_YEAR"],
        )

    for row in place_stats.to_dict(orient="records"):
        catalog[geography_id("place", row["PLACE_GEOID"])] = geography_payload(
            "Place",
            row["PLACE_NAME"],
            geography_id("county", row["PRIMARY_COUNTY"]),
            row["ASSESSED_VALUE_YEAR"],
        )

    for row in zcta5_stats.to_dict(orient="records"):
        catalog[geography_id("zcta5", row["ZCTA5_GEOID"])] = geography_payload(
            "ZCTA5",
            row["ZCTA5_NAMELSAD"],
            geography_id("county", row["PRIMARY_COUNTY"]),
            row["ASSESSED_VALUE_YEAR"],
        )

    return catalog


def write_json(path: Path, payload):
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))


def read_json(path: Path):
    with open(path) as f:
        return json.load(f)


def validate_generated_housing_payloads(output_dir: Path, payloads):
    filenames = [
        DATASET_FILENAMES["huiAssessedValues"],
        DATASET_FILENAMES["huiMarketAdjustedValues"],
    ]

    for filename in filenames:
        current_payload = payloads[filename]
        validate_generated_values(current_payload)

        previous_path = output_dir / filename
        if previous_path.exists():
            try:
                previous_payload = read_json(previous_path)
            except json.JSONDecodeError as exc:
                raise DataValidationError(
                    f"existing published data is invalid: {filename}"
                ) from exc

            validate_record_count_change(previous_payload, current_payload)


def publish_json_payloads(output_dir: Path, payloads, validate_payloads=None):
    if validate_payloads is not None:
        validate_payloads(payloads)

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix=".generated-data-", dir=output_dir.parent
    ) as staging_dir:
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
    hui_raw = load_housing_units()
    validate_housing_source_records(hui_raw, require_values=False)

    print("GDB df Shape:")
    print(hui_raw.shape)

    county_quality = load_county_quality()
    wasatch_front_counties = get_wasatch_front_counties(county_quality)
    hui_valid = filter_valid_housing_units(hui_raw, county_quality)
    validate_housing_source_records(hui_valid)

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
    county_assessed_value_years = {
        county: quality.get("assessed_value_year") for county, quality in county_quality.items()
    }
    county_raw_stats["ASSESSED_VALUE_YEAR"] = county_raw_stats["COUNTY"].map(
        county_assessed_value_years
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

    places = join_shapefile(
        hui_valid, SHAPEFILE_PLACE_ZIP_PATH, column_mappings_place, "PLACE_GEOID", "place"
    )
    place_raw_stats, place_adjusted_stats = places.raw_stats, places.adjusted_stats

    column_mappings_zcta5 = {
        "ZCTA5CE20": "ZCTA5_GEOID",
        "GEOID20": "ZCTA5_NAMELSAD",
    }

    zcta5s = join_shapefile(
        hui_valid,
        SHAPEFILE_ZCTA5_ZIP_PATH,
        column_mappings_zcta5,
        "ZCTA5_GEOID",
        "zcta5",
        min_covered_area_share=MIN_ZCTA_COVERED_AREA_SHARE,
    )
    zcta5_raw_stats, zcta5_adjusted_stats = zcta5s.raw_stats, zcta5s.adjusted_stats

    housing_stock = {
        WASATCH_FRONT_ID: summarize_housing_stock(hui_wasatch_front),
        **{
            geography_id("county", county): summarize_housing_stock(group)
            for county, group in hui_valid.groupby("COUNTY")
        },
        **places.housing_stock,
        **zcta5s.housing_stock,
    }

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
            DATASET_FILENAMES["marketContext"]: build_market_context(
                county_quality, load_market_context_config()
            ),
            DATASET_FILENAMES["housingStock"]: {
                "yearBuiltBands": [label for label, _, _ in YEAR_BUILT_BANDS],
                "lotSizeBands": [label for label, _, _ in LOT_SIZE_BANDS],
                "geographies": housing_stock,
            },
            DATASET_FILENAMES["boundaries"]: {
                "type": "FeatureCollection",
                "features": [
                    *load_county_boundaries(set(hui_valid["COUNTY"])),
                    *places.boundaries,
                    *zcta5s.boundaries,
                ],
            },
            DATASET_FILENAMES["huiAssessedValues"]: assessed_values,
            DATASET_FILENAMES["huiMarketAdjustedValues"]: market_adjusted_values,
            "manifest.json": build_manifest(),
        },
        validate_payloads=lambda payloads: validate_generated_housing_payloads(
            PROCESSED_DATA_DIR,
            payloads,
        ),
    )


if __name__ == "__main__":
    main()
