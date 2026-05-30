import geopandas as gpd
import json
import math
import pandas as pd
import pyogrio
import yaml
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
SHAPEFILES_DIR = RAW_DATA_DIR / "shapefiles"
PROCESSED_DATA_DIR = DATA_DIR / "processed"

GDB_PATH = RAW_DATA_DIR / "HousingUnitInventory.gdb"
GDB_LAYER_NAME = "HousingUnitInventory"
COUNTY_QUALITY_PATH = CONFIG_DIR / "counties.yml"
PLACE_SHAPEFILE_ZIP_PATH = SHAPEFILES_DIR / "tl_2024_49_place.zip"


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


def stats_payload(row, name: str):
    return {
        "name": name,
        "n": int(row["n"]),
        "mean": clean_number(row["mean"]),
        "percentiles": [clean_number(value) for value in row["percentiles"]],
    }


def grouped_stats_payload(df: pd.DataFrame, id_col: str, name_col: str):
    return {
        str(row[id_col]): stats_payload(row, str(row[name_col]))
        for row in df.to_dict(orient="records")
    }


def build_attribute_payload(
    wasatch_front_stats: pd.Series,
    county_stats: pd.DataFrame,
    place_stats: pd.DataFrame,
):
    return {
        "WasatchFront": stats_payload(wasatch_front_stats, "Wasatch Front"),
        "County": grouped_stats_payload(county_stats, "COUNTY", "COUNTY_NAMELSAD"),
        "Place": grouped_stats_payload(place_stats, "PLACE_GEOID", "PLACE_NAMELSAD"),
    }


def write_json(path: Path, payload):
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))


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
    places = gpd.read_file(f"zip://{PLACE_SHAPEFILE_ZIP_PATH}")

    places = places[["GEOID", "NAME", "NAMELSAD", "geometry"]].copy()
    places = places.rename(
        columns={
            "GEOID": "PLACE_GEOID",
            "NAME": "PLACE_NAME",
            "NAMELSAD": "PLACE_NAMELSAD",
        }
    )

    assert places.crs is not None, "HousingUnitInventory has no CRS set"
    hui_points = hui_valid.to_crs(places.crs).copy()
    hui_points["geometry"] = hui_points.geometry.representative_point()

    hui_places = gpd.sjoin(
        hui_points,
        places,
        how="left",
        predicate="within",
    ).drop(columns=["index_right"], errors="ignore")

    # Aggregate by place
    place_raw_stats = summarize_grouped_values(
        hui_places[hui_places["PLACE_GEOID"].notna()],
        ["PLACE_GEOID", "PLACE_NAME", "PLACE_NAMELSAD"],
        "TOT_VALUE",
    )

    place_adjusted_stats = summarize_grouped_values(
        hui_places[hui_places["PLACE_GEOID"].notna()],
        ["PLACE_GEOID", "PLACE_NAME", "PLACE_NAMELSAD"],
        "MARKET_ADJUSTED_VALUE",
    )

    write_json(
        PROCESSED_DATA_DIR / "TOT_VALUE.json",
        build_attribute_payload(
            wasatch_front_raw_stats,
            county_raw_stats,
            place_raw_stats,
        ),
    )

    write_json(
        PROCESSED_DATA_DIR / "MARKET_ADJUSTED_VALUE.json",
        build_attribute_payload(
            wasatch_front_adjusted_stats,
            county_adjusted_stats,
            place_adjusted_stats,
        ),
    )


if __name__ == "__main__":
    main()
