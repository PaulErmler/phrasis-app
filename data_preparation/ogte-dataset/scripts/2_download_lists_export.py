#!/usr/bin/env python3
"""
Download Tatoeba's bulk sentences_in_lists export.

The export is a single tab-separated file (list_id\\tsentence_id) covering every
public Tatoeba list. Inner-joining with the existing sentences.csv gives us
every OGTE list's contents without page-by-page scraping.

Source: https://downloads.tatoeba.org/exports/sentences_in_lists.tar.bz2
"""

import sys
import tarfile
from pathlib import Path

import requests

OGTE_ROOT = Path(__file__).resolve().parents[1]
RAW = OGTE_ROOT / "data" / "raw"
ARCHIVE = RAW / "sentences_in_lists.tar.bz2"
EXTRACTED = RAW / "sentences_in_lists.csv"
URL = "https://downloads.tatoeba.org/exports/sentences_in_lists.tar.bz2"


def download(url: str, dest: Path) -> None:
    print(f"  GET {url}")
    with requests.get(url, stream=True, timeout=120, headers={"User-Agent": "phrasis-ogte/1.0"}) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        with dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = 100 * downloaded / total
                        print(f"\r  {downloaded/1e6:6.1f} / {total/1e6:6.1f} MB ({pct:5.1f}%)", end="")
        print()
    print(f"  saved -> {dest}")


def extract(archive: Path, dest_dir: Path) -> Path:
    with tarfile.open(archive, "r:bz2") as tar:
        members = [m for m in tar.getmembers() if m.isfile() and m.name.endswith(".csv")]
        if not members:
            raise RuntimeError(f"No .csv member found inside {archive}")
        member = members[0]
        tar.extract(member, dest_dir)
        extracted_path = dest_dir / member.name
        final = dest_dir / "sentences_in_lists.csv"
        if extracted_path != final:
            extracted_path.rename(final)
        # Best-effort cleanup of any nested directories tar may have created.
        for sub in dest_dir.iterdir():
            if sub.is_dir():
                try:
                    sub.rmdir()
                except OSError:
                    pass
        return final


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    if EXTRACTED.exists():
        print(f"  {EXTRACTED} already exists ({EXTRACTED.stat().st_size:,} bytes), skipping.")
        return 0

    if not ARCHIVE.exists():
        download(URL, ARCHIVE)
    else:
        print(f"  archive already present: {ARCHIVE}")

    print("  extracting ...")
    out = extract(ARCHIVE, RAW)
    print(f"  extracted -> {out} ({out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
