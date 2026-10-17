# Updating the Data

The sources update on different schedules. This checklist covers each kind of update. All commands run from the project root with the virtual environment active.

## When the Housing Unit Inventory is updated

UGRC publishes new HUI dumps a few times a year, usually when a county submits new records.

1. Download the new File Geodatabase and replace `data/raw/HousingUnitInventory.gdb` (README steps 8–11).
2. For each county, check whether its assessed year changed. If it did, update `assessed_value_year` in `config/counties.yml`, plus the `assessment_sales_ratio` and `hpi_ratio` that depend on it (see the sections below).
3. Check `latest_year_built_with_value` for each county. It should be the last build year whose homes carry finished values. Compare the median value of each recent build year with the year before it: a build year whose median is far lower (for example under about $350K on the Wasatch Front) is still mostly land-only, so it belongs after the cutoff.
4. Run `python3 -m pipeline.generate_data`, then `python3 -m pipeline.download_acs_tables`.
5. Update the "Utah Housing Unit Inventory" date on the About page (`website/src/pages/AboutPage.tsx`) and the "As of" date in the README.
6. Rebuild and deploy the site.

`generate_data` refuses to overwrite the published files when the total record count drops by more than 1%. If the drop is expected, for example because a filter changed, move the current `website/public/data/hui_*_values.json` files aside before the run.

## Each spring: roll the market-value year forward

FHFA publishes the county annual House Price Index for the previous year by spring. The market-adjusted values represent one calendar year's average prices, and that year moves forward once a year.

1. In `config/market_context.yml`, set `market_value_year` to the new year (for example 2026).
2. Pull from FRED:
   - each county's annual index, `ATNHPIUS{state+county FIPS}A` (for example `ATNHPIUS49035A` for Salt Lake)
   - each metro's quarterly index, `ATNHPIUS{CBSA}Q`. The series and the counties in each metro are listed in `market_context.yml`.
3. Recompute each county's `hpi_ratio` in `config/counties.yml` with the formula at the top of that file, and update the source comment above each value. Once a county annual index exists for a county's assessed year, it uses the full formula. This is how Washington County leaves its metro-only special case.
4. In `market_context.yml`, update `market_value_year_average` (the mean of the four quarters of the new year), `latest_quarter` and `latest_quarter_value`, and the retrieval date.
5. On the About page, update the FHFA date and the two mentions of "the 2025 average".
6. Regenerate, rebuild and deploy (steps 4 and 6 above).

The explorer reads the market-value year from the data, so its labels and "prices since" note don't need code changes.

## When a new assessment/sales ratio study is published

The Utah State Tax Commission publishes a study each year at `https://files.tax.utah.gov/propertytax/srs/srs{YEAR}.pdf`. The study published in year Y+1 matches sales to the January 1, Y assessments.

1. For each county whose `assessed_value_year` is Y, set `assessment_sales_ratio` to the county's Residential median from `srs{Y+1}.pdf`.
2. Washington County currently uses `srs2026` (2025 assessments) as a stand-in for its 2026 assessments. Replace it with the `srs2027` value when that study is published, and remove the warning comment.
3. Update the ratio-study entries and links on the About page.
4. Regenerate, rebuild and deploy.

## When new ACS 5-year estimates are released

The Census Bureau releases new 5-year estimates each December.

1. Update `ACS_VINTAGE_YEAR` in `pipeline/download_acs_tables.py`.
2. Run `python3 -m pipeline.download_acs_tables`.
3. Update the American Community Survey entry on the About page and in the README. The Housing Context note reads the vintage from the data.
4. Regenerate (so the manifest's `generatedAt` changes and browsers fetch the new file), rebuild and deploy.

## Boundaries

The pipeline uses the 2024 Census TIGER/Line place and ZCTA files and the 2024 cartographic county boundaries. To move to a newer vintage, update the URLs in `pipeline/download_shapefiles.py` and the file paths in `pipeline/generate_data.py`, then rerun the whole pipeline.
