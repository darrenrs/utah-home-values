# Output Data Dictionary

`python3 -m pipeline.generate_data` and `python3 -m pipeline.download_acs_tables` write these JSON files to `website/public/data/`. The website loads them as static files. All of them describe single-family homes only (see the README for the filters).

## Geography IDs

Every file keys its records by the same IDs:

| Level | Format | Example |
| --- | --- | --- |
| Region | `region:wasatch-front` | `region:wasatch-front` (Davis, Salt Lake, Utah and Weber counties) |
| County | `county:{slugified name}` | `county:salt-lake` |
| City or CDP | `place:{7-digit Census place GEOID}` | `place:4967000` (Salt Lake City) |
| ZIP Code Tabulation Area | `zcta5:{5-digit ZCTA}` | `zcta5:84043` |

Places and ZCTAs with fewer than 20 homes are not published.

## `manifest.json`

The entry point. The website reads it first and fetches the files it lists.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Format version. The website refuses versions it doesn't support. |
| `generatedAt` | UTC time of the `generate_data` run. The website adds it to every data URL, so a new run makes browsers fetch fresh files. |
| `datasets` | File name for each dataset below, relative to the manifest. |

## `geographies.json`

One entry per published geography.

| Field | Meaning |
| --- | --- |
| `type` | `Region`, `County`, `Place` or `ZCTA5`. |
| `name` | Display name, for example `Salt Lake County` or `Lehi`. |
| `parentGeography` | For a county, its region (or `null` outside the Wasatch Front). For a place or ZCTA, the county containing most of its homes. `null` for the region. |
| `assessedValueYear` | The assessment year shared by at least 90% of the area's homes, or `null` when no year reaches 90% (the website then hides assessed values for the area). `null` for the region. |

## `hui_market_adjusted_values.json` and `hui_assessed_values.json`

Value distributions, grouped by level: `{"Region": {...}, "County": {...}, "Place": {...}, "ZCTA5": {...}}`. Each level maps geography IDs to:

| Field | Meaning |
| --- | --- |
| `n` | Number of homes. |
| `mean` | Mean value. |
| `total` | Sum of all values. |
| `percentiles` | 99 values. `percentiles[i]` is the (i + 1)th percentile, so `percentiles[49]` is the median. |

All dollar amounts are rounded to the nearest $1,000. Assessed values are the county's `TOT_VALUE` as of its assessment date. Market-adjusted values are `TOT_VALUE / assessment_sales_ratio × hpi_ratio`, which estimates each home's value at the average prices of `marketValueYear` (see `market_context.json`).

## `housing_stock.json`

| Field | Meaning |
| --- | --- |
| `yearBuiltBands` | Labels for the build-year groups, oldest first. |
| `lotSizeBands` | Labels for the lot-size groups, smallest first. |
| `geographies` | Geography ID → the fields below. |

Each geography has:

| Field | Meaning |
| --- | --- |
| `n` | Number of homes. |
| `medianYearBuilt`, `yearBuiltP25`, `yearBuiltP75` | Median, 25th and 75th percentile of `APX_BLT_YR`. |
| `yearBuiltShares` | Share of homes in each `yearBuiltBands` group, as fractions that sum to about 1. |
| `medianLotAcres`, `lotAcresP25`, `lotAcresP75` | Median, 25th and 75th percentile lot size in acres. |
| `lotSizeShares` | Share of homes in each `lotSizeBands` group. |

Each group includes its lower bound and excludes its upper bound. For example, "0.2–0.3 ac" covers lots of at least 0.2 and under 0.3 acres.

## `market_context.json`

| Field | Meaning |
| --- | --- |
| `marketValueYear` | The year whose average prices the market-adjusted values represent. |
| `latestQuarter` | The latest FHFA quarter used for the "prices since" note, for example `2026 Q2`. |
| `metros` | Metro ID → `name`, FRED `series`, and `changePercent`, the change in the metro's quarterly index from the `marketValueYear` average to `latestQuarter`. |
| `counties` | County ID → `assessedValueYear` and `metro` (a key of `metros`). |

The "prices since" note is context only. It never changes published values.

## `boundaries.json`

A GeoJSON `FeatureCollection` of the published counties, places and ZCTAs, in longitude/latitude (EPSG:4326). Each feature's `properties.id` is a geography ID. Shapes are simplified to about 0.0015° (roughly 150 m) and coordinates are rounded to 4 decimals, which is enough for the site's map but not for spatial analysis.

## `acs_values.json`

Written by `download_acs_tables`.

| Field | Meaning |
| --- | --- |
| `acsVintageYear` | Last year of the American Community Survey 5-year estimates, for example `2024` for 2020–2024. |
| `geographies` | Geography ID → `medianHouseholdIncome` and `ownerOccupiedPercent`. |

Each value has an `estimate` and its 90% margin of error, `moe90`. Either is `null` when the Census Bureau reports it as unavailable. `ownerOccupiedPercent` is a percentage from 0 to 100. The Wasatch Front region has no ACS values.
