# RI-SCALE Model Hub Implementation

This repository contains the frontend code for the RI-SCALE Model Hub, utilizing the [Hypha](https://ha.amun.ai) backend.

## Developer Tools & Scripts

The `scripts/` directory contains several utility scripts for managing the hub during development.

### Setup

Ensure you have the required Python packages installed:
```bash
pip install hypha-rpc requests
```

### 1. Fixing Permissions (`scripts/fix_hub_permissions.py`)

If you encounter `403 Forbidden` errors when accessing the hub or artifacts (especially after changing storage backends), use this script to restore public read access.

**Usage:**

```bash
# Using a token directly
python3 scripts/fix_hub_permissions.py --token <YOUR_HYPHA_TOKEN>

# Using environment variable
export HYPHA_TOKEN=<YOUR_HYPHA_TOKEN>
python3 scripts/fix_hub_permissions.py
```

### 2. Uploading Sample Artifacts (`scripts/upload_sample.py`)

To upload a sample artifact that demonstrates the "Open App" (static site) feature:

```bash
# Using a token
python3 scripts/upload_sample.py --token <YOUR_HYPHA_TOKEN>
```

This will create an artifact `ri-scale/sample-static-app` containing an `index.html` file.

### 3. Diagnosing Issues (`scripts/diagnose_hub.py`)

Run this script to inspect the current configuration and permissions of the hub artifact without modifying them.

```bash
python3 scripts/diagnose_hub.py
```

## Features

### Static Site Hosting ("Open App")
Artifacts containing an `index.html` file will display an **"Open App"** button in the interface. This opens the static site directly in the browser, served via Hypha.
