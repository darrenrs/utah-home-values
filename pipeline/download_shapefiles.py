import requests
from pathlib import Path

SHAPEFILES = [
    "https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_49_place.zip",
    "https://www2.census.gov/geo/tiger/TIGER2024/ZCTA520/tl_2024_us_zcta520.zip",
]

PROJECT_ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    for i in SHAPEFILES:
        response = requests.get(i)

        if response.status_code == 200:
            filename = i.split("/")[-1]
            path = PROJECT_ROOT / "data" / "raw" / "shapefiles" / filename

            with open(path, "wb") as file:
                file.write(response.content)

            print(f"Successfully downloaded {i}")
        else:
            print(f"Failed to download {i}; please try again")
