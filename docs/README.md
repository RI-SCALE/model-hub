# RI-SCALE Model Hub User Guide

The **RI-SCALE Model Hub** is a centralized platform designed to facilitate the sharing, discovery, and utilization of standardized AI models across research infrastructures. It serves as a comprehensive resource for researchers in the field of AI and machine learning.

## Key Features

1. **Model Discovery**: Search and retrieve open-source models tailored for various research tasks.
2. **Model Management**: Upload, version, and share your own models with the community.

---

## Browsing Models

* **Search**: Utilize the search bar on the home page to locate models by name, tags, description, or author.
* **Filter**: Narrow down results using specific tags such as task (e.g., *segmentation*, *restoration*) or imaging modality.
* **Model Details**: Click on any model card to access comprehensive information, including:
  * **Overview**: Description, authors, and license.
  * **History**: Version control and update logs.
  * **Citations**: Academic references and credit.
  * **Files**: Direct download links for model weights and configuration files.

## Uploading a Model

Contribution to the hub is streamlined:

1. Navigate to the **Upload** section via the navigation bar.
2. **Authenticate** using your designated credentials (via Hypha).
3. **Files**: Drag and drop your model weights, configuration files, and sample data. A valid `rdf.yaml` manifest file is required.
4. **Metadata**: You can edit the `rdf.yaml` file using the built-in editor after uploading your package if needed.
   * **Name**: Provide a clear, descriptive title.
   * **Description**: elaborate on the model's purpose, architecture, and intended use cases.
   * **Tags**: Select relevant keywords to enhance discoverability.
5. **Submit**: Once processed, your model becomes immediately available to the community.

---

## Documentation & Help

* **About**: consistent with the project goals, learn more on the [About](/about) page.
* **Terms**: Review the [Terms of Service](/toc) for acceptable usage policy.
* **API**: Developers can access the [API Documentation](/#/api) to integrate programmatically.
