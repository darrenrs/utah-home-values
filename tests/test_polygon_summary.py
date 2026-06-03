import geopandas as gpd
import pytest
from shapely.geometry import Point

from pipeline.generate_data import InvalidPolygonError, parse_polygon, summarize_polygon


def polygon():
    return {
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


def feature_collection_polygon():
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-112.084982229231, 41.13272358668658],
                            [-112.04462498666521, 41.132791605983186],
                            [-112.04461184086104, 41.11818715016693],
                            [-112.0848608452982, 41.118102945036554],
                            [-112.084982229231, 41.13272358668658],
                        ]
                    ],
                },
            }
        ],
    }


def housing_points(coordinates):
    return gpd.GeoDataFrame(
        {
            "TOT_VALUE": [200_000 + index * 10_000 for index in range(len(coordinates))],
            "MARKET_ADJUSTED_VALUE": [
                250_000 + index * 10_000 for index in range(len(coordinates))
            ],
        },
        geometry=[Point(coordinate) for coordinate in coordinates],
        crs="EPSG:4326",
    ).to_crs("EPSG:3857")


def test_summarize_polygon_converts_geojson_crs_and_excludes_boundary_points():
    points = housing_points(
        [
            (-112.05, 41.18),
            (-112.051, 41.181),
            (-112.06, 41.17),
            (-112.10, 41.20),
        ]
    )

    summary = summarize_polygon(points, polygon())

    assert summary["assessed"]["n"] == 2
    assert summary["assessed"]["mean"] == 205_000
    assert summary["marketAdjusted"]["mean"] == 255_000
    assert len(summary["assessed"]["percentiles"]) == 99


def test_parse_polygon_rejects_non_polygon_geojson():
    with pytest.raises(InvalidPolygonError, match="GeoJSON Polygon"):
        parse_polygon({"type": "Point", "coordinates": [-112.05, 41.18]})


def test_parse_polygon_accepts_single_polygon_feature_collection():
    parsed = parse_polygon(feature_collection_polygon())

    assert parsed.is_valid
    assert parsed.bounds == pytest.approx(
        (-112.084982229231, 41.118102945036554, -112.04461184086104, 41.132791605983186)
    )


def test_parse_polygon_rejects_self_intersection():
    with pytest.raises(InvalidPolygonError, match="Invalid polygon geometry"):
        parse_polygon(
            {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-112.06, 41.17],
                        [-112.04, 41.19],
                        [-112.04, 41.17],
                        [-112.06, 41.19],
                        [-112.06, 41.17],
                    ]
                ],
            }
        )


def test_parse_polygon_repairs_small_self_intersection():
    # Simplified Wasatch Front housing footprint with a negligible overlap at closure.
    repaired = parse_polygon(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [-112.17334, 41.2606],
                    [-112.14289, 41.30192],
                    [-111.9349, 41.40747],
                    [-111.69283, 41.40649],
                    [-111.5933, 41.36489],
                    [-111.56176, 41.26452],
                    [-111.72255, 41.22277],
                    [-111.86897, 40.96154],
                    [-111.7101, 40.79678],
                    [-111.78074, 40.61773],
                    [-111.511, 40.32901],
                    [-111.26674, 39.95853],
                    [-111.0914, 39.92849],
                    [-111.00225, 39.84382],
                    [-111.12355, 39.83687],
                    [-111.22344, 39.92733],
                    [-111.50444, 39.81253],
                    [-111.80543, 39.94871],
                    [-111.9692, 39.81282],
                    [-112.0133, 39.86118],
                    [-111.98623, 40.10328],
                    [-112.10047, 40.26226],
                    [-112.11417, 40.33388],
                    [-112.1107, 40.70169],
                    [-111.95658, 40.83801],
                    [-112.07891, 41.06446],
                    [-112.10195, 41.0725],
                    [-112.16173, 41.15694],
                    [-112.17334, 41.26061],
                    [-112.17334, 41.2606],
                ]
            ],
        }
    )

    assert repaired.is_valid
