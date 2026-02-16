# RI-SCALE Model Hub Copilot Instructions

## Background

This website is from an old project called "Bioimage model zoo" and we want to migrate to a new project called "RI-SCALE Model Hub". The RI-SCALE Model Hub is much simpler than the Bioimage model zoo, it only has one type of artifact (models). The partners of the project are different from the bioimage model zoo, and the target audience is also different (researchers in the field of AI and machine learning, not necessarily in the field of bioimaging).

### Description of Model Hub from RI-SCALE project proposal:

## Agents

### Frontend for agents

The agents chat use pyodide, using the web-python-kernel. They relay requests to the chat-proxy app, Hypha app ID: ri-scale/chat-proxy.

Implementation of the web python kernel is here: https://github.com/oeway/web-python-kernel/tree/fa89a96152fd85e4263cff8f78435b440890a885

Example usages of the web python kernel:
1. https://github.com/aicell-lab/safe-colab repo. Ask the user for info from this one if you like
2. https://github.com/aicell-lab/hypha-agents the main inspiration for the agents chat. Has extra functionality that is not yet implemented in the model hub agents chat, some of which will never be.


### Backend for agents

The only backends for agent chat are the ri-scale/chat-proxy app in Hypha and the OpenAI API (which is called from the chat-proxy). The chat-proxy is a microservice that acts as a proxy between the frontend and the OpenAI API. It is responsible for handling the authentication and authorization, and for forwarding the requests from the frontend to the OpenAI API.

## Role and Expertise
You are an expert Python/JavaScript (full-stack) developer focusing on the RI-SCALE Model Hub project under the RI-SCALE EU initiative. You have deep knowledge of building cloud-native web applications and backends using **Hypha** (for server, service registration, and artifact management), along with modern frontend frameworks. Your code should be production-ready, well-documented, and consistent with best practices for both Python and JavaScript/TypeScript.

This project is a frontend for the RI-SCALE Model Hub. It is built with React and Typescript, it uses `pnpm` as package manager.

## Documentation

Hypha artifact manager documentation is in artifact-manager-4.md
Documentation for hypha apps is in apps.md
Other Hypha documentation is in https://docs.amun.ai

## Deploying and Running the Project

**To start the project locally**, you can use the following commands:

```bash
pnpm start
```

**To deploy the chat-proxy**, look at ~/github-repos/hypha-apps-cli/README.md for instructions on how to deploy a microservice to Hypha. There is an example app there that you can use as a template for deploying the chat-proxy.

The hypha-proxy files are in chat-proxy-app/.

## Relevant repos

1. https://github.com/aicell-lab/safe-colab repo. Private, accessible by hugokallander user. Ask the user for info from this one if you like
2. https://github.com/aicell-lab/hypha-agents the main inspiration for the agents chat. Has extra functionality that is not yet implemented in the model hub agents chat, some of which will never be.


## Project Context
The RI-SCALE Model Hub is a community-driven, open resource for sharing standardized AI models across research infrastructures. It is part of the **RI-SCALE** project, aiming to provide scalable Data Exploitation Platforms (DEPs), cloud-based services, robust data/metadata management, and easy-to-use developer and end-user tools.

We use a **Hypha**-based backend (written in Python) that handles:
- Service registration (e.g., “Hello World” services, microservices for inference or data processing).
- File management and artifact versioning (via the **Artifact Manager**).
- Authentication and authorization through token-based or user login flows.

For detailed guidance on Hypha usage (server startup, file uploads, artifact manager APIs, etc.), see the separate documentation under `hypha-docs/`.

## Coding Standards

IMPORTANT: test everything end to end. Make many tests, though not superfluous ones. When you present your results to the user, you should be confident that the code works and is tested, from simulated user input to true result, with minimal mocking. If you are not sure, test it before presenting it to the user. If it fails, keep iterating until it works.

### General Principles
- **PEP 8** and **PEP 257** compliance for Python code.
- Consistent style for JavaScript/TypeScript (e.g., Prettier, ESLint).
- Use **type hints** in Python functions/methods whenever possible.
- Include **docstrings** or JSDoc comments for all significant classes, functions, and modules.

### Naming Conventions
- **Python Variables and Functions**: `snake_case`
- **Python Classes**: `PascalCase`
- **JS/TS Variables and Functions**: `camelCase`
- **JS/TS Classes**: `PascalCase`
- **Files and Folders**: `snake_case` or `kebab-case` (consistent within each repo).

### Error Handling
- Wrap critical I/O operations (e.g., activity calls, file/HTTP requests) in try-except blocks (Python) or try-catch blocks (JavaScript).
- Log or raise meaningful exceptions with context (who, what, why).
- For Python, use `logging` or structured logs; for JS, use a consistent logging library (e.g., `winston`).

## Project Structure
Organize the code to keep the client (frontend) and server (backend) logic clearly separated.
