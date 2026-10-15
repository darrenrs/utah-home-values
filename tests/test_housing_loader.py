import json

import geopandas as gpd
import pytest
from shapely.errors import GEOSException

from pipeline import generate_data
from pipeline.validate_data import DataValidationError


def write_housing_source(tmp_path, coordinates):
    path = tmp_path / "HousingUnitInventory.geojson"
    path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "ACRES": 0.25,
                    "APX_BLT_YR": 1998,
                    "COUNTY": "Salt Lake",
                    "SUBTYPE": "single_family",
                    "TOT_BD_FT2": 2200,
                    "TOT_VALUE": 475000,
                    "UNIT_COUNT": 1,
                },
                "geometry": {"type": "Polygon", "coordinates": [coordinates]},
            },
        ],
    }))
    return path


@pytest.mark.filterwarnings("ignore:Non closed ring detected:RuntimeWarning")
def test_housing_loader_closes_source_ring_without_losing_record(tmp_path, monkeypatch):
    path = write_housing_source(tmp_path, [[0, 0], [1, 0], [1, 1], [0, 1]])
    monkeypatch.setattr(generate_data, "GDB_PATH", path)

    # Reproduce the failure from the original loader with the same source.
    with pytest.raises(GEOSException, match="closed linestring"):
        gpd.read_file(path, engine="pyogrio")

    records = generate_data.load_housing_units()

    assert len(records) == 1
    assert records.iloc[0]["TOT_VALUE"] == 475000
    assert records.crs.to_epsg() == 4326
    polygon = records.geometry.iloc[0]
    assert polygon.is_valid
    assert list(polygon.exterior.coords) == [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]


@pytest.mark.filterwarnings("ignore:Non closed ring detected:RuntimeWarning")
def test_valid_housing_loader_rejects_unrepairable_geometry(tmp_path, monkeypatch):
    path = write_housing_source(tmp_path, [[0, 0]])
    monkeypatch.setattr(generate_data, "GDB_PATH", path)
    monkeypatch.setattr(generate_data, "load_county_quality", lambda: {
        "Salt Lake": {
            "is_valid": True,
            "is_wasatch_front": True,
            "latest_year_built_with_value": 2024,
            "assessment_sales_ratio": 0.9,
        },
    })

    with pytest.raises(DataValidationError, match="missing required values.*geometry"):
        generate_data.load_valid_housing_units()
