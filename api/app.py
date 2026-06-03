from functools import lru_cache
from typing import Annotated, Any

import geopandas as gpd
from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pipeline.generate_data import (
    InvalidPolygonError,
    load_polygon_summary_housing_points,
    summarize_polygon,
)

MINIMUM_RECORD_COUNT = 100

app = FastAPI(title="Utah Home Values Explorer Custom Polygon API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def get_housing_points() -> gpd.GeoDataFrame:
    return load_polygon_summary_housing_points()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/polygon")
def polygon_summary(
    polygon: Annotated[dict[str, Any], Body()],
    housing_points: Annotated[gpd.GeoDataFrame, Depends(get_housing_points)],
):
    try:
        summary = summarize_polygon(housing_points, polygon)
    except InvalidPolygonError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if summary["assessed"]["n"] < MINIMUM_RECORD_COUNT:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Polygon summary requires at least {MINIMUM_RECORD_COUNT} matching housing units; only {summary['assessed']['n']} were specified."
            ),
        )

    return summary
