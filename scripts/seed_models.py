"""
Seed the RI-SCALE model hub with representative models.

Usage:
    HYPHA_TOKEN=<your-token> python scripts/seed_models.py

Get a token by logging into https://hypha.aicell.io and running:
    server.generateToken()
in your browser console, or via the Hypha workspace UI.
"""
import asyncio
import os

from hypha_rpc import connect_to_server

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE = "ri-scale"
COLLECTION = f"{WORKSPACE}/ai-model-hub"
TOKEN = os.environ.get("HYPHA_TOKEN")

MODELS = [
    # ── Biomedical / Pathology ──────────────────────────────────────────────
    {
        "alias": "cellpose-lymph-node-segmentation",
        "manifest": {
            "name": "Cellpose Lymph Node Segmentation",
            "description": (
                "A fine-tuned Cellpose 3.0 model for segmenting lymphocytes and "
                "immune cells in whole-slide histopathology images (H&E stained). "
                "Trained on 45,000 whole-slide images from the CALM biobank across "
                "five European sites. Achieves 91.3% mean IoU on the held-out test set."
            ),
            "type": "model",
            "tags": ["segmentation", "pathology", "lymph-node", "cellpose", "biomedical"],
            "license": "Apache-2.0",
            "version": "1.0.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Anna Schmidt", "affiliation": "Forschungszentrum Jülich", "github_user": "a-schmidt-fzj"},
                {"name": "Marc Dubois", "affiliation": "Institut Curie"},
            ],
            "cite": [
                {
                    "text": "Stringer, C. et al. Cellpose: a generalist algorithm for cellular segmentation. Nat Methods 18, 100–106 (2021).",
                    "doi": "10.1038/s41592-020-01018-x",
                },
                {
                    "text": "RI-SCALE Consortium. Federated AI for European Biobank Data (2025).",
                    "url": "https://www.riscale.eu",
                },
            ],
            "documentation": "README.md",
            "covers": [],
            "links": ["https://www.riscale.eu"],
            "git_repo": "https://github.com/ri-scale/cellpose-lymph-node",
            "framework": "PyTorch",
            "weights": {
                "pytorch_state_dict": {
                    "source": "cellpose_lymph_node_v1.0.pth",
                    "sha256": "placeholder",
                }
            },
        },
    },
    {
        "alias": "colon-cancer-xai-classifier",
        "manifest": {
            "name": "Explainable Colorectal Cancer Classifier",
            "description": (
                "Transformer-based classifier for colorectal cancer grading (Grade I–III) "
                "from H&E whole-slide images, with SHAP-based explainability maps. "
                "Trained on data from three federated European pathology centres. "
                "AUC 0.97 on independent test cohort."
            ),
            "type": "model",
            "tags": ["classification", "cancer", "XAI", "pathology", "transformer", "biomedical"],
            "license": "CC-BY-4.0",
            "version": "2.1.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Elena Rossi", "affiliation": "Fondazione IRCCS", "github_user": "e-rossi-irccs"},
                {"name": "Jan Kowalski", "affiliation": "Medical University of Warsaw"},
            ],
            "cite": [
                {
                    "text": "Kather J.N. et al. Deep learning can predict microsatellite instability directly from histology in gastrointestinal cancer. Nat Med (2019).",
                    "doi": "10.1038/s41591-019-0462-y",
                }
            ],
            "documentation": "README.md",
            "covers": [],
            "links": ["https://www.riscale.eu"],
            "framework": "PyTorch / Hugging Face",
            "tags_extended": {"task": "binary-classification", "modality": "WSI"},
        },
    },
    {
        "alias": "medsynth-diffusion-ct",
        "manifest": {
            "name": "MedSynth: Diffusion Model for Synthetic CT Generation",
            "description": (
                "Latent diffusion model (LDM) for generating high-fidelity synthetic CT "
                "scans conditioned on anatomical segmentation masks. Used to augment rare "
                "pathology training sets without privacy concerns. Trained on 12,000 "
                "de-identified abdominal CT volumes."
            ),
            "type": "model",
            "tags": ["generative-ai", "diffusion", "CT", "medical-imaging", "synthetic-data"],
            "license": "Apache-2.0",
            "version": "0.9.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Luisa Fernandez", "affiliation": "Barcelona Supercomputing Center"},
                {"name": "Thomas Berg", "affiliation": "DKFZ Heidelberg"},
            ],
            "cite": [
                {
                    "text": "Rombach R. et al. High-resolution image synthesis with latent diffusion models. CVPR 2022.",
                    "doi": "10.1109/CVPR52688.2022.01042",
                }
            ],
            "documentation": "README.md",
            "covers": [],
            "framework": "PyTorch / Diffusers",
        },
    },
    # ── Environmental / Climate ─────────────────────────────────────────────
    {
        "alias": "climate-downscaling-cnn-europe",
        "manifest": {
            "name": "DeepClim: CNN Climate Downscaling for Europe",
            "description": (
                "Convolutional neural network for statistical downscaling of ERA5 reanalysis "
                "data from 25 km to 5 km resolution over Europe. Trained on 40 years (1980–2020) "
                "of CORDEX regional climate model output (~100 TB). Supports temperature, "
                "precipitation, and wind speed downscaling."
            ),
            "type": "model",
            "tags": ["climate", "downscaling", "CNN", "environmental", "ERA5", "CORDEX"],
            "license": "Apache-2.0",
            "version": "1.2.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Ingrid Hansen", "affiliation": "ECMWF", "github_user": "i-hansen-ecmwf"},
                {"name": "Niklas Johansson", "affiliation": "SMHI"},
            ],
            "cite": [
                {
                    "text": "Baño-Medina J. et al. Configuration and intercomparison of deep learning neural models for statistical downscaling. Geosci. Model Dev. (2020).",
                    "doi": "10.5194/gmd-13-2109-2020",
                }
            ],
            "documentation": "README.md",
            "covers": [],
            "links": ["https://www.riscale.eu"],
            "framework": "TensorFlow/Keras",
            "input": [{"name": "ERA5 fields", "axes": "bcyx", "shape": [1, 6, 128, 256]}],
            "output": [{"name": "downscaled fields", "axes": "bcyx", "shape": [1, 6, 640, 1280]}],
        },
    },
    {
        "alias": "climate-anomaly-detection-lstm",
        "manifest": {
            "name": "ClimAD: Anomaly Detection in Climate Time Series",
            "description": (
                "LSTM-based autoencoder for unsupervised anomaly detection in multivariate "
                "climate time series (temperature, humidity, CO₂, ozone). Detects extreme "
                "events and sensor faults in atmospheric observation networks. Trained on "
                "30+ years of Copernicus Climate Data Store records."
            ),
            "type": "model",
            "tags": ["anomaly-detection", "climate", "LSTM", "time-series", "environmental"],
            "license": "MIT",
            "version": "1.0.1",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Pierre Martin", "affiliation": "Météo-France"},
                {"name": "Hanna Müller", "affiliation": "DWD – German Weather Service"},
            ],
            "cite": [
                {
                    "text": "Hundman K. et al. Detecting Spacecraft Anomalies Using LSTMs and Nonparametric Dynamic Thresholding. KDD 2018.",
                    "doi": "10.1145/3219819.3219845",
                }
            ],
            "documentation": "README.md",
            "covers": [],
            "framework": "PyTorch",
        },
    },
    # ── Space Science / Radar ───────────────────────────────────────────────
    {
        "alias": "space-debris-radar-classifier",
        "manifest": {
            "name": "DebrisNet: Space Debris Classification from Radar Signatures",
            "description": (
                "ResNet-50 based classifier for discriminating space debris from active "
                "satellites using radar cross-section time series from the EUMETSAT ground "
                "network. Trained on 6 years of Tracking and Imaging Radar (TIRA) data. "
                "Achieves 96.8% classification accuracy across 12 debris categories."
            ),
            "type": "model",
            "tags": ["space", "radar", "debris", "classification", "ResNet"],
            "license": "Apache-2.0",
            "version": "1.1.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Markus Weber", "affiliation": "Fraunhofer FHR"},
                {"name": "Stefano Conti", "affiliation": "ASI – Italian Space Agency"},
            ],
            "cite": [
                {
                    "text": "Braun V. et al. Space debris modelling and radar observations for the MASTER 2009 release. Advances in Space Research (2011).",
                    "doi": "10.1016/j.asr.2011.05.037",
                }
            ],
            "documentation": "README.md",
            "covers": [],
            "framework": "PyTorch",
        },
    },
    {
        "alias": "radar-insar-deformation-unet",
        "manifest": {
            "name": "InSAR-UNet: Ground Deformation Mapping from SAR Interferograms",
            "description": (
                "U-Net architecture for automatic mapping of ground surface deformation "
                "from Sentinel-1 SAR interferometric coherence maps. Detects subsidence, "
                "landslides, and seismic deformation at millimetre precision. "
                "Validated on 2,400 Sentinel-1 IW scenes across Europe."
            ),
            "type": "model",
            "tags": ["SAR", "InSAR", "UNet", "earth-observation", "deformation", "space"],
            "license": "CC-BY-4.0",
            "version": "2.0.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Catalina Lopez", "affiliation": "ESA ESRIN"},
                {"name": "Andreas Fischer", "affiliation": "TU Munich"},
            ],
            "cite": [
                {
                    "text": "Ronneberger O. et al. U-Net: Convolutional Networks for Biomedical Image Segmentation. MICCAI 2015.",
                    "doi": "10.1007/978-3-319-24574-4_28",
                }
            ],
            "documentation": "README.md",
            "covers": [],
            "framework": "TensorFlow/Keras",
        },
    },
    # ── Bioimage Foundation Models ──────────────────────────────────────────
    {
        "alias": "bioimage-sam2-finetuned",
        "manifest": {
            "name": "BioSAM2: Segment Anything for Biological Microscopy",
            "description": (
                "SAM 2 (Segment Anything Model 2) fine-tuned on a diverse collection of "
                "fluorescence, brightfield, and electron microscopy images from the BioImage "
                "Archive (>500,000 annotated objects). Supports interactive and automatic "
                "segmentation of cells, organelles, and tissue structures."
            ),
            "type": "model",
            "tags": ["segmentation", "foundation-model", "microscopy", "SAM2", "bioimage"],
            "license": "Apache-2.0",
            "version": "1.0.0",
            "format_version": "0.1.0",
            "authors": [
                {"name": "Wei Ouyang", "affiliation": "KTH Royal Institute of Technology", "github_user": "oeway"},
                {"name": "Caterina Fuster", "affiliation": "EMBL-EBI"},
            ],
            "cite": [
                {
                    "text": "Ravi N. et al. SAM 2: Segment Anything in Images and Videos. arXiv 2024.",
                    "url": "https://arxiv.org/abs/2408.00714",
                },
                {
                    "text": "Ouyang W. et al. BioImage Model Zoo: A Community-Driven Resource for Accessible Deep Learning in BioImage Analysis. Nat Methods (2022).",
                    "doi": "10.1038/s41592-022-01606-0",
                },
            ],
            "documentation": "README.md",
            "covers": [],
            "links": ["https://bioimage.io", "https://www.riscale.eu"],
            "framework": "PyTorch",
        },
    },
]

README_TEMPLATE = """# {name}

{description}

## Model Details

| Property | Value |
|----------|-------|
| Type | {type} |
| License | {license} |
| Version | {version} |
| Framework | {framework} |

## Usage

```python
from hypha_rpc import connect_to_server

server = await connect_to_server({{"server_url": "https://hypha.aicell.io"}})
am = await server.get_service("public/artifact-manager")

artifact = await am.read("ri-scale/{alias}")
print(artifact.manifest)
```

## Citation

Please cite the following when using this model:

{citations}

## Acknowledgements

This model was developed as part of the [RI-SCALE project](https://www.riscale.eu),
funded by the European Union under Grant Agreement 101881687.
"""


async def main():
    if not TOKEN:
        raise ValueError(
            "HYPHA_TOKEN environment variable is required.\n"
            "Get a token from your Hypha workspace: server.generateToken()"
        )

    print(f"Connecting to {SERVER_URL}...")
    api = await connect_to_server(
        {"server_url": SERVER_URL, "token": TOKEN}
    )
    am = await api.get_service("public/artifact-manager")
    print("Connected.\n")

    created = []
    skipped = []
    failed = []

    for model in MODELS:
        alias = model["alias"]
        manifest = model["manifest"]
        print(f"  Creating: {manifest['name']} ({alias})...", end=" ", flush=True)

        try:
            # Build README content
            citations = "\n".join(
                f"- {c['text']}" + (f" DOI: {c['doi']}" if "doi" in c else f" URL: {c.get('url','')}")
                for c in manifest.get("cite", [])
            )
            readme = README_TEMPLATE.format(
                name=manifest["name"],
                description=manifest["description"],
                type=manifest.get("type", "model"),
                license=manifest.get("license", "N/A"),
                version=manifest.get("version", "0.1.0"),
                framework=manifest.get("framework", "PyTorch"),
                alias=alias,
                citations=citations or "See rdf.yaml for references.",
            )

            artifact = await am.create(
                alias=alias,
                parent_id=COLLECTION,
                type="model",
                manifest=manifest,
                config={"storage": "git"},
                stage=True,
                
            )

            # Upload README as a file placeholder
            import httpx
            put_url = await am.put_file(
                artifact_id=artifact.id,
                file_path="README.md",
                
            )
            async with httpx.AsyncClient() as client:
                resp = await client.put(
                    put_url,
                    content=readme.encode(),
                    headers={"Content-Type": "text/markdown"},
                )
                resp.raise_for_status()

            # Commit
            await am.commit(artifact_id=artifact.id)
            print(f"OK  (id: {artifact.id})")
            created.append(alias)

        except Exception as e:
            err_str = str(e)
            if "already exists" in err_str.lower() or "conflict" in err_str.lower():
                print(f"SKIP (already exists)")
                skipped.append(alias)
            else:
                print(f"FAIL: {err_str}")
                failed.append((alias, err_str))

    print("\n" + "=" * 60)
    print(f"Created : {len(created)}")
    print(f"Skipped : {len(skipped)} (already existed)")
    print(f"Failed  : {len(failed)}")
    if failed:
        for alias, err in failed:
            print(f"  - {alias}: {err}")
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
