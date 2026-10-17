import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point

from pipeline.generate_data import (
    DATASET_FILENAMES,
    build_market_context,
    drop_small_geographies,
    filter_valid_housing_units,
    geography_assessed_value_years,
    publish_json_payloads,
    validate_generated_housing_payloads,
)
from pipeline.validate_data import (
    DataValidationError,
    REQUIRED_HOUSING_SOURCE_COLUMNS,
    validate_generated_values,
    validate_housing_source_records,
    validate_record_count_change,
)


def make_payload(n):
    return {
        "Region": {
            "region:wasatch-front": {"n": n},
        },
    }


def make_generated_housing_payloads(n):
    return {
        DATASET_FILENAMES["huiAssessedValues"]: make_payload(n),
        DATASET_FILENAMES["huiMarketAdjustedValues"]: make_payload(n),
    }


def make_housing_source_records():
    return gpd.GeoDataFrame(
        {
            "ACRES": [0.25],
            "APX_BLT_YR": [1998],
            "COUNTY": ["Salt Lake"],
            "IS_OUG": [None],
            "SUBTYPE": ["single_family"],
            "TOT_BD_FT2": [2_200],
            "TOT_VALUE": [475_000],
            "UNIT_COUNT": [1],
        },
        geometry=[Point(-111.9, 40.7)],
        crs="EPSG:4326",
    )


def test_rejects_empty_output():
    payload = {
        "Region": {},
        "County": {},
        "Place": {},
        "ZCTA5": {},
    }

    with pytest.raises(DataValidationError, match="empty"):
        validate_generated_values(payload)


def test_housing_source_records_allow_expected_columns_and_values():
    validate_housing_source_records(make_housing_source_records())


@pytest.mark.parametrize("column", sorted(REQUIRED_HOUSING_SOURCE_COLUMNS))
def test_rejects_missing_required_housing_source_column(column):
    records = make_housing_source_records().drop(columns=[column])

    with pytest.raises(DataValidationError, match=f"missing required columns: {column}"):
        validate_housing_source_records(records)


def test_allows_missing_is_oug_column():
    records = make_housing_source_records().drop(columns=["IS_OUG"])

    validate_housing_source_records(records)


def test_filter_valid_housing_units_allows_missing_is_oug_column():
    records = make_housing_source_records().drop(columns=["IS_OUG"])
    county_quality = {
        "Salt Lake": {
            "is_valid": True,
            "is_wasatch_front": True,
            "latest_year_built_with_value": 2024,
            "assessment_sales_ratio": 0.9,
        },
    }

    valid_records = filter_valid_housing_units(records, county_quality)

    assert len(valid_records) == 1
    assert valid_records.iloc[0]["MARKET_ADJUSTED_VALUE"] == pytest.approx(527_777.78)


def test_filter_valid_housing_units_keeps_only_single_family():
    records = make_housing_source_records()
    records = gpd.GeoDataFrame(
        records.loc[records.index.repeat(3)].reset_index(drop=True),
        crs=records.crs,
    )
    records["SUBTYPE"] = ["single_family", "townhome", "condo"]
    county_quality = {
        "Salt Lake": {
            "is_valid": True,
            "is_wasatch_front": True,
            "latest_year_built_with_value": 2024,
            "assessment_sales_ratio": 0.9,
        },
    }

    valid_records = filter_valid_housing_units(records, county_quality)

    assert valid_records["SUBTYPE"].tolist() == ["single_family"]


SALT_LAKE_COUNTY_QUALITY = {
    "Salt Lake": {
        "is_valid": True,
        "is_wasatch_front": True,
        "latest_year_built_with_value": 2024,
        "assessment_sales_ratio": 0.9,
    },
}


def make_housing_source_records_at(points, **overrides):
    records = make_housing_source_records()
    records = gpd.GeoDataFrame(
        records.loc[records.index.repeat(len(points))].reset_index(drop=True),
        geometry=list(points),
        crs=records.crs,
    )
    for column, values in overrides.items():
        records[column] = values
    return records


def test_filter_valid_housing_units_excludes_small_lots_built_since_2000():
    records = make_housing_source_records_at(
        [Point(-111.9, 40.7), Point(-111.8, 40.6)],
        ACRES=[0.04, 0.05],
        APX_BLT_YR=[2005, 2005],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert valid_records["ACRES"].tolist() == [0.05]


def test_filter_valid_housing_units_keeps_small_lots_built_before_2000():
    records = make_housing_source_records_at(
        [Point(-111.9, 40.7), Point(-111.8, 40.6)],
        ACRES=[0.04, 0.04],
        APX_BLT_YR=[1999, 2000],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert valid_records["APX_BLT_YR"].tolist() == [1999]


def test_filter_valid_housing_units_excludes_values_under_50k():
    records = make_housing_source_records_at(
        [Point(-111.9, 40.7), Point(-111.8, 40.6)],
        TOT_VALUE=[49_999, 50_000],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert valid_records["TOT_VALUE"].tolist() == [50_000]


def distinct_points(count):
    return [Point(-111.9 + index * 0.001, 40.7) for index in range(count)]


def test_filter_valid_housing_units_compares_missing_sqft_to_city_cohort():
    # Ten homes with square footage set a $500,000 cohort median. Of the two
    # without square footage, $250,000 (50%) is kept and $240,000 is dropped.
    records = make_housing_source_records_at(
        distinct_points(12),
        CITY=["Lehi"] * 12,
        TOT_BD_FT2=[2_200] * 10 + [0, None],
        TOT_VALUE=[500_000] * 10 + [250_000, 240_000],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert len(valid_records) == 11
    assert 240_000 not in valid_records["TOT_VALUE"].tolist()


def test_filter_valid_housing_units_falls_back_to_county_cohort_for_small_cities():
    # Highland has only three homes with square footage, so its home without
    # square footage is compared to the county and build-year median ($400,000)
    # instead of Highland's $1,000,000.
    records = make_housing_source_records_at(
        distinct_points(13),
        CITY=["Highland"] * 3 + ["Lehi"] * 9 + ["Highland"],
        TOT_BD_FT2=[2_200] * 12 + [0],
        TOT_VALUE=[1_000_000] * 3 + [400_000] * 9 + [300_000],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert 300_000 in valid_records["TOT_VALUE"].tolist()


def test_filter_valid_housing_units_drops_missing_sqft_without_cohort():
    records = make_housing_source_records_at(
        distinct_points(2),
        APX_BLT_YR=[1998, 1999],
        TOT_BD_FT2=[2_200, 0],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert valid_records["APX_BLT_YR"].tolist() == [1998]


def test_filter_valid_housing_units_excludes_shared_footprints():
    records = make_housing_source_records_at(
        [Point(-111.9, 40.7), Point(-111.9, 40.7), Point(-111.8, 40.6)],
        TOT_VALUE=[400_000, 410_000, 500_000],
    )

    valid_records = filter_valid_housing_units(records, SALT_LAKE_COUNTY_QUALITY)

    assert valid_records["TOT_VALUE"].tolist() == [500_000]


def test_drop_small_geographies_requires_at_least_20_records():
    stats = pd.DataFrame({"PLACE_GEOID": ["a", "b"], "n": [19, 20]})

    published = drop_small_geographies(stats)

    assert published["PLACE_GEOID"].tolist() == ["b"]


def test_geography_assessed_value_years_requires_90_percent_share():
    matched = pd.DataFrame({
        "PLACE_GEOID": ["a"] * 10 + ["b"] * 10,
        "assessed_value_year": [2024] * 9 + [2023] + [2024] * 8 + [2023] * 2,
    })

    years = geography_assessed_value_years(matched, "PLACE_GEOID")

    assert years == {"a": 2024, "b": None}


def test_build_market_context_reports_factors_and_metro_changes():
    county_quality = {
        "Davis": {
            "is_valid": True,
            "assessed_value_year": 2024,
            "assessment_sales_ratio": 0.9673,
            "hpi_ratio": 1.0438,
        },
        "Summit": {"is_valid": False},
    }
    market_config = {
        "market_value_year": 2025,
        "latest_quarter": "2026 Q2",
        "metros": {
            "ogden": {
                "name": "Ogden",
                "series": "ATNHPIUS36260Q",
                "counties": ["Davis"],
                "market_value_year_average": 441.692,
                "latest_quarter_value": 455.11,
            },
        },
    }

    context = build_market_context(county_quality, market_config)

    assert context["marketValueYear"] == 2025
    assert context["latestQuarter"] == "2026 Q2"
    assert context["metros"]["ogden"]["changePercent"] == 3.0
    assert context["counties"] == {
        "county:davis": {
            "adjustmentFactor": 1.0791,
            "assessedValueYear": 2024,
            "metro": "ogden",
        },
    }


def test_rejects_missing_required_housing_source_value():
    records = make_housing_source_records()
    records.loc[0, "APX_BLT_YR"] = None

    with pytest.raises(DataValidationError, match="missing required values.*APX_BLT_YR"):
        validate_housing_source_records(records)


def test_raw_housing_source_records_allow_missing_values_before_filtering():
    records = make_housing_source_records()
    records.loc[0, "APX_BLT_YR"] = None
    records.loc[0, "TOT_VALUE"] = None

    validate_housing_source_records(records, require_values=False)


def test_rejects_record_count_drop_over_one_percent():
    previous = make_payload(n=100_000)
    current = make_payload(n=98_900)

    with pytest.raises(DataValidationError, match="record count dropped"):
        validate_record_count_change(previous, current)


def test_allows_record_count_drop_within_one_percent():
    previous = make_payload(n=100_000)
    current = make_payload(n=99_100)

    validate_record_count_change(previous, current)


def test_generated_housing_payload_validation_rejects_empty_output(tmp_path):
    payloads = make_generated_housing_payloads(n=100)
    payloads[DATASET_FILENAMES["huiAssessedValues"]] = {
        "Region": {},
        "County": {},
        "Place": {},
        "ZCTA5": {},
    }

    with pytest.raises(DataValidationError, match="empty"):
        validate_generated_housing_payloads(tmp_path, payloads)


def test_generated_housing_payload_validation_rejects_record_count_drop(tmp_path):
    existing_file = tmp_path / DATASET_FILENAMES["huiAssessedValues"]
    existing_file.write_text('{"Region":{"region:wasatch-front":{"n":100000}}}')
    payloads = make_generated_housing_payloads(n=98_900)

    with pytest.raises(DataValidationError, match="record count dropped"):
        validate_generated_housing_payloads(tmp_path, payloads)


def test_failed_update_does_not_overwrite_existing_data(tmp_path):
    output_dir = tmp_path / "data"
    output_dir.mkdir()
    existing_file = output_dir / "hui_assessed_values.json"
    existing_file.write_text('{"status":"published"}')

    def fail_validation(_payloads):
        raise DataValidationError("validation failed")

    with pytest.raises(DataValidationError, match="validation failed"):
        publish_json_payloads(
            output_dir,
            {
                "hui_assessed_values.json": {"status": "new"},
                "manifest.json": {"status": "new"},
            },
            validate_payloads=fail_validation,
        )

    assert existing_file.read_text() == '{"status":"published"}'
    assert not (output_dir / "manifest.json").exists()
