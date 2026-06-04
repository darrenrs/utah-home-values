class DataValidationError(ValueError):
    pass


REQUIRED_HOUSING_SOURCE_COLUMNS = {
    "ACRES",
    "APX_BLT_YR",
    "COUNTY",
    "SUBTYPE",
    "TOT_VALUE",
    "UNIT_COUNT",
    "geometry",
}

REQUIRED_HOUSING_SOURCE_VALUE_COLUMNS = REQUIRED_HOUSING_SOURCE_COLUMNS


def validate_housing_source_records(records, require_values=True):
    missing_columns = REQUIRED_HOUSING_SOURCE_COLUMNS - set(records.columns)

    if missing_columns:
        column_list = ", ".join(sorted(missing_columns))
        raise DataValidationError(f"missing required columns: {column_list}")

    if not require_values:
        return

    missing_value_columns = []
    for column in sorted(REQUIRED_HOUSING_SOURCE_VALUE_COLUMNS):
        if records[column].isna().any():
            missing_value_columns.append(column)

    if missing_value_columns:
        column_list = ", ".join(missing_value_columns)
        raise DataValidationError(f"missing required values in columns: {column_list}")


def validate_generated_values(payload):
    total_records = sum(stats["n"] for section in payload.values() for stats in section.values())

    if total_records == 0:
        raise DataValidationError("Generated output is empty")


def total_count(payload):
    return sum(stats["n"] for section in payload.values() for stats in section.values())


def validate_record_count_change(previous, current, max_drop_ratio=0.01):
    previous_count = total_count(previous)
    current_count = total_count(current)

    if previous_count == 0:
        return

    drop_ratio = (previous_count - current_count) / previous_count

    if drop_ratio > max_drop_ratio:
        raise DataValidationError(f"record count dropped by {drop_ratio:.1%}")
