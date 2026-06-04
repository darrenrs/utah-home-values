# Utah Home Values Explorer

A data pipeline and interactive website for home values in Utah using public data.

## Features

TBD

## Build Process

TBD

## Polygon Summary API

Install the Python dependencies and run the API:

```bash
pip install -r requirements.txt
uvicorn api.app:app --reload
```

The website uses `http://127.0.0.1:8000` by default. Set `VITE_FASTAPI_BASE_PATH`
when the API is hosted elsewhere, such as
`https://example.com/projects/utah-home-values/api`.

Submit a GeoJSON Polygon in longitude and latitude coordinates:

```bash
curl -X POST http://127.0.0.1:8000/api/polygon \
  -H 'Content-Type: application/json' \
  --data '{"type":"Polygon","coordinates":[[[-112.06,41.17],[-112.06,41.19],[-112.04,41.19],[-112.04,41.17],[-112.06,41.17]]]}'
```

The response contains assessed and market-adjusted summaries using the same
filtering and percentile calculations as the static website data. Requests
matching fewer than 100 housing units return `403` without summary statistics.

## Data Sources

- Utah Housing Unit Inventory
- Utah Assessment/Sales Ratio Studies (2023-25)
- 2024 Census TIGER/Line Shapefiles
- 2024 American Community Survey Data

## Copyright

(C) 2026 Darren R. Skidmore.
