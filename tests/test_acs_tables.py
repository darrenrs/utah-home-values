from pipeline.download_acs_tables import row_payload


def make_acs_row(**overrides):
    row = {
        "NAME": "ZCTA5 84783",
        "B19013_001E": "85000",
        "B19013_001M": "9000",
        "B25003_001E": "414",
        "B25003_001M": "121",
        "B25003_002E": "373",
        "B25003_002M": "86",
    }
    row.update(overrides)
    return row


def test_row_payload_keeps_valid_values():
    payload = row_payload(make_acs_row())

    assert payload["medianHouseholdIncome"] == {"estimate": 85000, "moe90": 9000}
    assert payload["ownerOccupiedPercent"]["estimate"] == 90.1
    assert payload["ownerOccupiedPercent"]["moe90"] is not None


def test_row_payload_nulls_income_sentinels_without_dropping_tenure():
    payload = row_payload(make_acs_row(B19013_001E="-666666666", B19013_001M="-222222222"))

    assert payload["medianHouseholdIncome"] == {"estimate": None, "moe90": None}
    assert payload["ownerOccupiedPercent"]["estimate"] == 90.1


def test_row_payload_keeps_tenure_estimate_when_margin_is_a_sentinel():
    payload = row_payload(make_acs_row(B25003_002M="-555555555"))

    assert payload["ownerOccupiedPercent"] == {"estimate": 90.1, "moe90": None}


def test_row_payload_nulls_tenure_when_no_occupied_units():
    payload = row_payload(make_acs_row(B25003_001E="0", B25003_002E="0"))

    assert payload["ownerOccupiedPercent"] == {"estimate": None, "moe90": None}
