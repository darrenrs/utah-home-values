import shutil
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

SHAPEFILES = [
    "https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_49_place.zip",
    "https://www2.census.gov/geo/tiger/TIGER2024/ZCTA520/tl_2024_us_zcta520.zip",
    "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip",
]

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SHAPEFILE_DIR = PROJECT_ROOT / "data" / "raw" / "shapefiles"
DOWNLOAD_TIMEOUT_SECONDS = 120


def download(url: str, path: Path):
    # Write to a temporary file first so a failed download never leaves a
    # truncated ZIP where the pipeline expects a complete one.
    partial_path = path.with_suffix(path.suffix + ".part")

    with urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        with open(partial_path, "wb") as file:
            shutil.copyfileobj(response, file)

    partial_path.replace(path)


def main():
    SHAPEFILE_DIR.mkdir(parents=True, exist_ok=True)
    failed = []

    for url in SHAPEFILES:
        path = SHAPEFILE_DIR / url.split("/")[-1]

        try:
            download(url, path)
        except (URLError, TimeoutError) as exc:
            failed.append(url)
            print(f"Failed to download {url} ({exc}); please try again")
        else:
            print(f"Successfully downloaded {url}")

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
