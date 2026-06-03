import json
import math
import os
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA_DIR = PROJECT_ROOT / "website" / "public" / "data"
GEOGRAPHIES_PATH = PUBLIC_DATA_DIR / "geographies.json"
OUTPUT_PATH = PUBLIC_DATA_DIR / "acs_values.json"
ENV_PATH = PROJECT_ROOT / ".env"

ACS_VINTAGE_YEAR = 2024
ACS_API_URL = f"https://api.census.gov/data/{ACS_VINTAGE_YEAR}/acs/acs5"
UTAH_STATE_FIPS = "49"
ACS_VARIABLES = [
    "NAME",
    "B19013_001E",
    "B19013_001M",
    "B25003_001E",
    "B25003_001M",
    "B25003_002E",
    "B25003_002M",
]


def slugify(value: str):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def load_env(path: Path):
    if not path.exists():
        return

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def fetch_rows(api_key: str, geography: str, within_state=False):
    params = {
        "get": ",".join(ACS_VARIABLES),
        "for": f"{geography}:*",
        "key": api_key,
    }
    if within_state:
        params["in"] = f"state:{UTAH_STATE_FIPS}"

    with urlopen(f"{ACS_API_URL}?{urlencode(params)}", timeout=60) as response:
        payload = json.load(response)

    columns, *rows = payload
    return [dict(zip(columns, row)) for row in rows]


def parse_number(value: str):
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"Invalid ACS numeric value: {value}")

    return int(number) if number.is_integer() else number


def owner_occupied_percent(row):
    occupied_units = parse_number(row["B25003_001E"])
    occupied_units_moe = parse_number(row["B25003_001M"])
    owner_occupied_units = parse_number(row["B25003_002E"])
    owner_occupied_units_moe = parse_number(row["B25003_002M"])

    if occupied_units == 0:
        raise ValueError(f"Occupied housing unit count is zero for {row['NAME']}")
    if owner_occupied_units > occupied_units:
        raise ValueError(f"Owner-occupied unit count exceeds total for {row['NAME']}")

    proportion = owner_occupied_units / occupied_units
    variance_component = owner_occupied_units_moe**2 - proportion**2 * occupied_units_moe**2
    if variance_component < 0:
        variance_component = owner_occupied_units_moe**2 + proportion**2 * occupied_units_moe**2

    return {
        "estimate": round(proportion * 100, 1),
        "moe90": round(math.sqrt(variance_component) / occupied_units * 100, 1),
    }


def row_payload(row):
    return {
        "medianHouseholdIncome": {
            "estimate": parse_number(row["B19013_001E"]),
            "moe90": parse_number(row["B19013_001M"]),
        },
        "ownerOccupiedPercent": owner_occupied_percent(row),
    }


def county_id(row):
    county_name = row["NAME"].split(",", 1)[0].removesuffix(" County")
    return f"county:{slugify(county_name)}"


def place_id(row):
    return f"place:{row['state']}{row['place']}"


def zcta5_id(row):
    return f"zcta5:{row['zip code tabulation area']}"


def main():
    load_env(ENV_PATH)
    api_key = os.environ.get("CENSUS_API_KEY")
    if not api_key:
        raise RuntimeError("CENSUS_API_KEY is not set")

    with GEOGRAPHIES_PATH.open() as f:
        geographies = json.load(f)

    geography_values = {}
    sources = [
        (fetch_rows(api_key, "county", within_state=True), county_id),
        (fetch_rows(api_key, "place", within_state=True), place_id),
        (fetch_rows(api_key, "zip code tabulation area"), zcta5_id),
    ]

    for rows, get_id in sources:
        for row in rows:
            geography_id = get_id(row)
            if geography_id in geographies:
                try:
                    geography_values[geography_id] = row_payload(row)
                except ValueError as error:
                    print(f"Skipping {geography_id}: {error}")

    output = {
        "acsVintageYear": ACS_VINTAGE_YEAR,
        "geographies": geography_values,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w") as f:
        json.dump(output, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
