import zipfile

import pytest

from pipeline import download_hui


def write_zip(path, names):
    with zipfile.ZipFile(path, "w") as archive:
        for name in names:
            archive.writestr(name, "data")


def test_extract_gdb_finds_the_geodatabase_folder(tmp_path):
    zip_path = tmp_path / "hui.zip"
    write_zip(zip_path, ["0a1b2c.gdb/a00000001.gdbtable", "0a1b2c.gdb/gdb"])

    gdb_path = download_hui.extract_gdb(zip_path, tmp_path / "extracted")

    assert gdb_path.name == "0a1b2c.gdb"
    assert (gdb_path / "gdb").exists()


def test_extract_gdb_rejects_a_download_without_one_geodatabase(tmp_path):
    zip_path = tmp_path / "hui.zip"
    write_zip(zip_path, ["readme.txt"])

    with pytest.raises(download_hui.DownloadError, match="found 0"):
        download_hui.extract_gdb(zip_path, tmp_path / "extracted")


def test_refuses_to_replace_existing_geodatabase_without_flag(tmp_path, monkeypatch):
    dest = tmp_path / "HousingUnitInventory.gdb"
    dest.mkdir()

    def fail_download(*_args):
        raise AssertionError("should not download")

    monkeypatch.setattr(download_hui, "download_zip", fail_download)

    assert download_hui.main(["--dest", str(dest)]) == 1
    assert dest.exists()
