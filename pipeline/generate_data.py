import geopandas as gpd
import json
import math
import pandas as pd
import pyogrio
import re
import yaml
from datetime import datetime, timezone
from pathlib import Path

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
    adjusted_stats = summarize_grouped_values(
        matched, group_cols, "MARKET_ADJUSTED_VALUE"
    )

    for stats in (raw_stats, adjusted_stats):
        stats["PRIMARY_COUNTY"] = stats[id_col].map(primary_counties)

    return raw_stats, adjusted_stats


# Round value to nearest 1,000 (or 10^s)
def normalize_value(n: float, s=3):
    if math.isnan(n):
        return float("nan")

    return round(n / 10**s) * 10**s


# Summarize a df of home records
def summarize_values(df: pd.DataFrame, value_col: str):
    percentiles = [
        normalize_value(df[value_col].quantile(p / 100)) for p in range(1, 100)
    ]

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

    hui_raw["IS_OUG_CLEAN"] = pd.to_numeric(hui_raw["IS_OUG"], errors="coerce").fillna(
        0
    )
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

    # Join with county quality data
    with open(COUNTY_QUALITY_PATH, "r") as f:
        county_quality = yaml.safe_load(f)

    wasatch_front_counties = {
        county
        for county, quality in county_quality.items()
        if quality.get("is_valid") and quality.get("is_wasatch_front")
    }

    #
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

    # Apply filters based on county quality data
    hui_valid = hui_candidate[
        (hui_candidate["is_valid"])
        & (hui_candidate["APX_BLT_YR"].notna())
        & (hui_candidate["APX_BLT_YR"] <= hui_candidate["latest_year_built_with_value"])
        & (hui_candidate["assessment_sales_ratio"].notna())
    ].copy()

    hui_valid["MARKET_ADJUSTED_VALUE"] = (
        hui_valid["TOT_VALUE"] / hui_valid["assessment_sales_ratio"]
    )

    hui_wasatch_front = hui_valid[hui_valid["is_wasatch_front"]].copy()

    wasatch_front_raw_stats = summarize_values(hui_wasatch_front, "TOT_VALUE")
    wasatch_front_adjusted_stats = summarize_values(
        hui_wasatch_front, "MARKET_ADJUSTED_VALUE"
    )

    # Aggregate by county
    county_raw_stats = (
        hui_valid.groupby("COUNTY")
        .apply(lambda g: summarize_values(g, "TOT_VALUE"))
        .reset_index()
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

    write_json(
        PROCESSED_DATA_DIR / "geographies.json",
        build_geography_catalog(
            county_raw_stats,
            place_raw_stats,
            zcta5_raw_stats,
            wasatch_front_counties,
        ),
    )

    write_json(
        PROCESSED_DATA_DIR / DATASET_FILENAMES["huiAssessedValues"],
        build_attribute_payload(
            wasatch_front_raw_stats,
            county_raw_stats,
            place_raw_stats,
            zcta5_raw_stats,
        ),
    )

    write_json(
        PROCESSED_DATA_DIR / DATASET_FILENAMES["huiMarketAdjustedValues"],
        build_attribute_payload(
            wasatch_front_adjusted_stats,
            county_adjusted_stats,
            place_adjusted_stats,
            zcta5_adjusted_stats,
        ),
    )

    write_json(PROCESSED_DATA_DIR / "manifest.json", build_manifest())


if __name__ == "__main__":
    main()
