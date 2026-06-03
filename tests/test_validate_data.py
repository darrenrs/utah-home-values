import pandas as pd
import pytest

from pipeline.generate_data import publish_json_payloads
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


def make_housing_source_records():
    return pd.DataFrame(
        {
            "ACRES": [0.25],
            "APX_BLT_YR": [1998],
            "COUNTY": ["Salt Lake"],
            "IS_OUG": [None],
            "SUBTYPE": ["single_family"],
            "TOT_BD_FT2": [2_200],
            "TOT_VALUE": [475_000],
            "UNIT_COUNT": [1],
            "geometry": ["POINT (-111.9 40.7)"],
        }
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


def test_rejects_missing_required_housing_source_value():
    records = make_housing_source_records()
    records.loc[0, "APX_BLT_YR"] = None

    with pytest.raises(DataValidationError, match="missing required values.*APX_BLT_YR"):
        validate_housing_source_records(records)


def test_rejects_record_count_drop_over_one_percent():
    previous = make_payload(n=100_000)
    current = make_payload(n=98_900)

    with pytest.raises(DataValidationError, match="record count dropped"):
        validate_record_count_change(previous, current)


def test_allows_record_count_drop_within_one_percent():
    previous = make_payload(n=100_000)
    current = make_payload(n=99_100)

    validate_record_count_change(previous, current)


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
