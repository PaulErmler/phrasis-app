# Git LFS and Deployments (Coolify)

## Problem

The repo uses Git LFS for large data-preparation files, including:

- `data_preparation/data/inputs/sentences.csv` (~708 MB)

These files are **only used by the data-preparation pipeline** (e.g. `read_tatoeba_dataset.py`). The running app (Next.js/Convex) does **not** need them at runtime.

On each deploy, Coolify runs `git clone` / `git pull`, which triggers a full LFS fetch and downloads all tracked files. That:

- Burns GitHub LFS bandwidth quota
- Slows down every deploy
- Is unnecessary for production

## Solution: Exclude only the large input file (recommended)

The repo uses **`.lfsconfig`** so that the 708 MB input file is excluded from LFS fetch by default. All other LFS files (output CSVs, etc.) are still pulled on clone/pull.

- **No Coolify (or other platform) config needed** — the behavior is in the repo.
- Deploys will not download the 708 MB file, but will still get the smaller LFS files.
- Saves GitHub LFS quota and deploy time.

### When you need the large input file (data preparation)

If you need to run the data-preparation pipeline and must have the real `sentences.csv` in `data_preparation/data/inputs/`, fetch it explicitly:

```bash
git lfs pull --include="data_preparation/data/inputs/sentences.csv"
```

### Alternative: Skip all LFS files on deploy

If you ever want to skip **every** LFS file during clone/pull (e.g. app never needs any of them at runtime), set in your deploy environment:

```bash
GIT_LFS_SKIP_SMUDGE=1
```

Then no LFS objects are downloaded. To pull everything later: `git lfs pull`.

## Optional: Move large input out of the repo

To avoid LFS entirely for the 708 MB input:

1. Remove `data_preparation/data/inputs/sentences.csv` from the repo (and from LFS).
2. Add it to `.gitignore`.
3. Store the file in object storage (e.g. S3, Backblaze B2) or document where to obtain it (e.g. Tatoeba download link).
4. Update the data-preparation scripts (or a small wrapper) to download the file when running the pipeline.

Then only developers or CI jobs that run the pipeline need the file; deploys never touch it.
