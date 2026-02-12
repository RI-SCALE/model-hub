# RI-SCALE Model Hub User Guide

The **RI-SCALE Model Hub** is a centralized platform designed to facilitate the sharing, discovery, and utilization of standardized AI models across research infrastructures. It serves as a comprehensive resource for researchers in the field of AI and machine learning.

## Key Features

1.  **Model Discovery**: Search and retrieve open-source models tailored for various research tasks.
2.  **Model Management**: Upload, version, and share your own models with the community.
3.  **AI Agents**: Interact with specialized AI agents to navigate services and resources.

---

## Browsing Models

*   **Search**: Utilize the search bar on the home page to locate models by name, tags, description, or author.
*   **Filter**: Narrow down results using specific tags such as task (e.g., *segmentation*, *restoration*) or imaging modality.
*   **Model Details**: Click on any model card to access comprehensive information, including:
    *   **Overview**: Description, authors, and license.
    *   **History**: Version control and update logs.
    *   **Citations**: Academic references and credit.
    *   **Files**: Direct download links for model weights and configuration files.

## Uploading a Model

Contribution to the hub is streamlined:
1.  Navigate to the **Upload** section via the navigation bar.
2.  **Authenticate** using your designated credentials (via Hypha).
3.  Complete the model metadata form:
    *   **Name**: Provide a clear, descriptive title.
    *   **Description**: elaborate on the model's purpose, architecture, and intended use cases.
    *   **Tags**: Select relevant keywords to enhance discoverability.
    *   **Files**: Drag and drop your model weights, configuration files, and sample data.
4.  **Submit**: Once processed, your model becomes immediately available to the community.

---

## AI Agents

The RI-SCALE Model Hub features advanced AI agents to assist you. One of our primary agents is the **Euro-BioImaging Finder**.

### Euro-BioImaging Finder

This agent (`hypha-agents/leisure-scrimmage-disliked-more`) is an AI assistant specialized in helping users discover imaging technologies, instruments, and services provided by the Euro-BioImaging network.

#### Capabilities

The agent has access to a live index of Euro-BioImaging resources and can perform:

*   **Geographic Queries**: Find facilities and nodes in specific countries (e.g., *"What imaging facilities are available in Germany?"*).
*   **Technology Queries**: Locate specific imaging techniques (e.g., *"Where can I access super-resolution microscopy?"*).
*   **General Assistance**: Guide users on how to access services and apply for resources.

#### Agent Instructions & Logic

To understand how the agent works, here is an overview of its internal instructions and the tools it uses to generate answers.

**System Role:**
> You are an AI assistant specialized in helping users discover imaging technologies, instruments, and services provided by the Euro-BioImaging network.

**Tool Access:**
The agent utilizes a set of specific Python utility functions to retrieve accurate data:
*   `read_tech_details(tech_id)`: Fetches detailed specs for a technology.
*   `read_node_details(node_id)`: Retrieves information about a specific facility/node.
*   `read_nodes_by_country(country_code)`: Lists all nodes within a specific country.
*   `read_website_page_details(page_id)`: Reads content from the Euro-BioImaging website.
*   `fulltext_search(query)`: Performs a broad search across all indexed content.

**Decision Making Process:**
1.  **Analyze Query**: Determine if the user is asking about geography, technology, or general info.
2.  **Identify Resources**: Scan the available index for relevant IDs (Technologies, Nodes, etc.).
3.  **Retrieve Details**: Call the appropriate utility functions to get granular data.
4.  **Synthesize Answer**: Combine the data into a comprehensive response, ensuring geographic context and specific availability details are included.

---

## Documentation & Help

*   **About**: consistent with the project goals, learn more on the [About](/about) page.
*   **Terms**: Review the [Terms of Service](/toc) for acceptable usage policy.
*   **API**: Developers can access the [API Documentation](/#/api) to integrate programmatically.
