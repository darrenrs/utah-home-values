import geopandas as gpd
import pytest
from shapely.geometry import Point

from pipeline.generate_data import (
    DATASET_FILENAMES,
    filter_valid_housing_units,
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
