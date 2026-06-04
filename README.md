# Utah Home Values Explorer

A data pipeline and interactive website for exploring single-family home values and affordability metrics for counties, cities, and ZIP Code Tabulation Areas in Utah based on public data sources. Currently available live at https://darrenskidmore.com/projects/utah-home-values.

## Features

- Fully deterministic data pipeline based on four official data sources
- Responsive website design with data visualizations, with support for counties, cities/CDPs, ZIP Code Tabulation Areas, and the Wasatch Front
- Rankings page including all cities/CDPs, allowing a target budget or percentile input for quick comparison
- Support for custom areas defined by GeoJSON polygons allowing deeper neighborhood/census tract analysis

## Setup

This section will guide users on how to set up this project locally.

### Initial

Run each of these commands:

1. `git clone https://github.com/darrenrs/utah-home-values`.
2. `cd utah-home-values/`
3. `python3 -m venv .venv`
4. `source .venv/bin/activate`
5. `pip install -r requirements.txt`
6. `mkdir -p data/raw/`
7. `cp .env.example .env`

Then, populate each value in .env.

### Geodatabase

The geodatabase (.gdb) will need to be downloaded manually.

8. Go to https://opendata.gis.utah.gov/datasets/utah-housing-unit-inventory/about, then click "Download", then "Download" under File Geodatabase.
9. Extract the ZIP file.
10. Move the `{long-guid-text}.gdb` folder to the `data/raw/` directory underneath this project root directory.
11. Rename the `{long-guid-text}.gdb` folder to `HousingUnitInventory.gdb`.

### Pipeline

Run each of these commands (from the project root directory):

12. `python3 -m pipeline.download_shapefiles`
13. `python3 -m pipeline.generate_data`
14. `python3 -m pipeline.download_acs_tables`

Data artifacts will be generated in `PROJECT_ROOT/website/public/data`. This process must be re-run when data are updated.

### Build Site

Run each of these commands (from the project root directory):

15. `cd website/`
16. `npm ci`
17. `npm run build`

The site will be built as a React/Vite single-page application in `PROJECT_ROOT/website/dist`. If data have been updated, the site must be rebuilt.

### Polygon API

The Polygon API uses Uvicorn as a server to interface between the FastAPI application and the browser. Run this command (from the project root directory):

18. `uvicorn api.app:app --reload`

The website uses `http://127.0.0.1:8000/api` by default. Set `VITE_FASTAPI_BASE_PATH` when the API is hosted elsewhere, such as `https://example.com/projects/utah-home-values/api`.

#### Example Usage

Submit a GeoJSON Polygon, Feature, or FeatureCollection in longitude and latitude coordinates. An example is provided below:

```bash
curl -X POST http://127.0.0.1:8000/api/polygon \
  -H 'Content-Type: application/json' \
  --data '{"type":"Polygon","coordinates":[[[-112.06,41.17],[-112.06,41.19],[-112.04,41.19],[-112.04,41.17],[-112.06,41.17]]]}'
```

The response contains assessed and market-adjusted summaries using the same filtering and percentile calculations as the static website data. For privacy reasons, requests containing fewer than 100 housing units are rejected with a 403 status code.

## Data Sources

### Utah Housing Unit Inventory

All parcel-level/value data are provided for public use by Utah Open Data as part of the [Utah Housing Unit Inventory](https://gis.utah.gov/products/sgid/planning/housing-unit-inventory/) dataset. Parcels which correspond to single- and multi-family housing units are aggregated by county assessors and submitted to the dataset. As of January 2026, the dataset currently includes the core Wasatch Front — Salt Lake, Utah, Davis, and Weber counties — along with Tooele, Morgan, and Washington counties.

A [live service](https://opendata.gis.utah.gov/datasets/utah-housing-unit-inventory/about) is available on ArcGIS. This is where updated geodatabases will be available.

As part of the pipeline, outlier or non-single-family records from this dataset are dropped. The filters include:
```
- SUBTYPE in {single_family, townhome, condo}
- IS_OUG != 1
- UNIT_COUNT = 1
- 10_000 <= TOT_VALUE <= 20_000_000
- 100 <= TOT_BD_FT2 <= 30_000
- 0 < ACRES <= 100
```

### Utah Assessment/Sales Ratio Studies

Assessment/Sales ratios are provided by the Utah State Tax Commission. The reference year depends on the year that the assessed value is associated with, which can be found in `config/counties.yml`. The most recent report, concerning fiscal year 2024, was published in 2025, and is available here: https://files.tax.utah.gov/propertytax/srs/srs2025.pdf.

### Census TIGER/Line Shapefiles

Place names and boundaries are provided by the U.S. Census Bureau from the [2024 Census TIGER/Line Shapefiles](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html). This method is used over the Housing Unit Inventory's existing CITY field for the following reasons:

- Extending support to geography groupings beyond counties and cities
- Adding support to CDPs (census-designated places) such as Stansbury Park and Mountain Green
- Addressing missing values in the CITY field, such as the January 2026 data update having blank values for parcels in Orem

### American Community Survey Data

American Community Survey data from the 2020-2024 5-year estimates are provided by the U.S. Census Bureau via the [Census API](https://www.census.gov/data/developers.html). The tables used are [Median Household Income in the Past 12 Months (B19013)](https://data.census.gov/table?q=B19013) and [Tenure (B25003)](https://data.census.gov/table?q=B25003). This is used for reporting home affordability ratios.

## Testing

There is a test suite that covers common scenarios and essential guardrails.

- `tests/test_api.py` - Tests that API is up, returns valid data, and rejects invalid requests.
- `tests/test_polygon_summary.py` - Tests some valid and invalid GeoJSON polygons.
- `tests/test_validate_data.py` - Tests that empty output and required columns are rejected, that non-required columns are not rejected, that failed updates or record count drops of more than 1% do not overwrite existing knowing good data.

### Running Tests

Please run the test suite whenever contributing or updating the source data. To run tests install `pytest` through `pip` and run `python3 -m pytest` at the project root directory.

## Copyright

(C) 2026 Darren R. Skidmore.
