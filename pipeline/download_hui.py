import argparse
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

# UGRC's Utah Housing Unit Inventory on the Utah open data portal. This link
# always serves the latest published version as a File Geodatabase ZIP, the same
# file as the portal's Download button.
HUI_ITEM_ID = "bbdc62867c2340949f530a71666223ab"
HUI_DOWNLOAD_URL = (
    f"https://opendata.gis.utah.gov/api/download/v1/items/{HUI_ITEM_ID}/filegdb?layers=0"
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GDB_PATH = PROJECT_ROOT / "data" / "raw" / "HousingUnitInventory.gdb"
DOWNLOAD_TIMEOUT_SECONDS = 300


class DownloadError(RuntimeError):
    pass


def download_zip(url: str, path: Path):
    with urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        # The portal answers with a JSON status instead of the file while it
        # is still preparing a new export.
        content_type = response.headers.get("Content-Type", "")
        if "json" in content_type or "html" in content_type:
            raise DownloadError(
                "the portal is still preparing the download; please try again in a few minutes"
            )

        details = {
            "Last modified": response.headers.get("Last-Modified"),
            "Records": response.headers.get("x-ms-meta-recordCount"),
        }
        with open(path, "wb") as file:
            shutil.copyfileobj(response, file)

    return details


def extract_gdb(zip_path: Path, extract_dir: Path):
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(extract_dir)

    # The ZIP holds one {long-guid-text}.gdb folder.
    gdbs = [path for path in extract_dir.rglob("*.gdb") if path.is_dir()]
    if len(gdbs) != 1:
        raise DownloadError(f"expected one .gdb folder in the download, found {len(gdbs)}")

    return gdbs[0]


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Download the latest Utah Housing Unit Inventory geodatabase."
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace an existing geodatabase at the destination",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=DEFAULT_GDB_PATH,
        help=f"where to put the geodatabase (default: {DEFAULT_GDB_PATH})",
    )
    args = parser.parse_args(argv)

    if args.dest.exists() and not args.replace:
        print(
            f"{args.dest} already exists. Rerun with --replace to overwrite it with the "
            "latest published version."
        )
        return 1

    args.dest.parent.mkdir(parents=True, exist_ok=True)

    # Work next to the destination so the final move is a rename, and nothing
    # is replaced until the new geodatabase has downloaded and extracted.
    with tempfile.TemporaryDirectory(prefix=".hui-download-", dir=args.dest.parent) as work_dir:
        work_path = Path(work_dir)
        zip_path = work_path / "HousingUnitInventory.zip"

        try:
            details = download_zip(HUI_DOWNLOAD_URL, zip_path)
            gdb_path = extract_gdb(zip_path, work_path / "extracted")
        except (URLError, TimeoutError, zipfile.BadZipFile, DownloadError) as exc:
            print(f"Failed to download the Housing Unit Inventory: {exc}")
            return 1

        if args.dest.exists():
            shutil.rmtree(args.dest)
        gdb_path.replace(args.dest)

    print(f"Saved the Housing Unit Inventory to {args.dest}")
    for label, value in details.items():
        if value:
            print(f"  {label}: {value}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
