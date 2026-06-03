import geopandas as gpd
from fastapi.testclient import TestClient
from shapely.geometry import Point

from api.app import app, get_housing_points


POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-112.06, 41.17],
            [-112.06, 41.19],
            [-112.04, 41.19],
            [-112.04, 41.17],
            [-112.06, 41.17],
        ]
    ],
}

FEATURE_COLLECTION_POLYGON = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": POLYGON,
        }
    ],
}


def housing_points(count):
    return gpd.GeoDataFrame(
        {
            "TOT_VALUE": [300_000] * count,
            "MARKET_ADJUSTED_VALUE": [350_000] * count,
        },
        geometry=[Point(-112.05, 41.18)] * count,
        crs="EPSG:4326",
    ).to_crs("EPSG:3857")


def post_polygon(points, polygon=POLYGON):
    app.dependency_overrides[get_housing_points] = lambda: points

    try:
        with TestClient(app) as client:
            return client.post("/api/polygon", json=polygon)
    finally:
        app.dependency_overrides.clear()


def test_health_accepts_get():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_polygon_summary_returns_summary_at_privacy_threshold():
    response = post_polygon(housing_points(100))

    assert response.status_code == 200
    assert response.json()["assessed"]["n"] == 100
    assert response.json()["marketAdjusted"]["mean"] == 350_000


def test_polygon_summary_accepts_polygon_feature_collection():
    response = post_polygon(housing_points(100), FEATURE_COLLECTION_POLYGON)

    assert response.status_code == 200
    assert response.json()["assessed"]["n"] == 100


def test_polygon_summary_returns_403_below_privacy_threshold():
    response = post_polygon(housing_points(99))

    assert response.status_code == 403
    assert response.json() == {
        "detail": (
            "Polygon summary requires at least 100 matching housing units; only 99 were specified."
        )
    }


def test_polygon_summary_returns_422_for_invalid_polygon():
    app.dependency_overrides[get_housing_points] = lambda: housing_points(100)

    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/polygon",
                json={"type": "Point", "coordinates": [-112.05, 41.18]},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
