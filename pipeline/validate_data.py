class DataValidationError(ValueError):
    pass


# Every kept record must have a value in these columns.
REQUIRED_HOUSING_SOURCE_VALUE_COLUMNS = {
    "ACRES",
    "APX_BLT_YR",
    "COUNTY",
    "SUBTYPE",
    "TOT_VALUE",
    "UNIT_COUNT",
    "geometry",
}

# The filters also read building square footage, which may be missing for
# individual records but must exist as a column.
REQUIRED_HOUSING_SOURCE_COLUMNS = REQUIRED_HOUSING_SOURCE_VALUE_COLUMNS | {"TOT_BD_FT2"}


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


def validate_record_count_change(
    previous, current, max_drop_ratio=0.01, max_county_drop_ratio=0.05
):
    previous_count = total_count(previous)
    current_count = total_count(current)

    if previous_count == 0:
        return

    drop_ratio = (previous_count - current_count) / previous_count

    if drop_ratio > max_drop_ratio:
        raise DataValidationError(f"record count dropped by {drop_ratio:.1%}")

    # The statewide total can hide a large loss in one small county (Morgan is
    # under 2% of all homes), so each county is checked on its own as well.
    current_counties = current.get("County", {})
    for county_id, previous_stats in previous.get("County", {}).items():
        previous_county_count = previous_stats["n"]
        current_county_count = current_counties.get(county_id, {"n": 0})["n"]

        if previous_county_count == 0:
            continue

        county_drop_ratio = (previous_county_count - current_county_count) / previous_county_count

        if county_drop_ratio > max_county_drop_ratio:
            raise DataValidationError(
                f"{county_id} record count dropped by {county_drop_ratio:.1%}"
            )
