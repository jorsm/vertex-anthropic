# docs/architecture.md

> **Overview**
> This document describes the architecture and API surface of the Vertex AI Models Chat Provider. The extension acts as a dispatcher between VS Code's Language Model API and various Google Cloud Vertex AI backends (Gemini and Anthropic Claude).

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
    - [VertexChatModelDispatcher](#vertexchatmodeldispatcher)
    - [ModelSpec](#modelspec)
    - [ModelCatalog](#modelcatalog)
    - [DiscoveryResult](#discoveryresult)
    - [activate](#activate)
    - [runDiscovery](#rundiscovery)
- [Examples](#examples)

---

## Core Concepts
The extension follows a provider-based architecture centered around the `VertexChatModelDispatcher`. 

- **Multi-Vendor Support**: It manages a registry of specific vendor providers (e.g., `VertexAnthropicProvider`, `VertexGoogleProvider`) that handle the nuances of different LLM protocols while exposing a unified interface to VS Code.
- **Dynamic Discovery**: Instead of hardcoding endpoints, the extension performs region probing. It iterates through prioritized GCP regions (global, us-east5, etc.) to identify where specific models are enabled for the user's project.
- **Unified Usage Tracking**: All interactions are intercepted to record token consumption (including Gemini high-thinking blocks and Anthropic prompt caching) into a local `UsageTrackerService`.
- **VS Code Integration**: It implements the `vscode.LanguageModelChatProvider` interface, making Vertex AI models appear as native options in the Copilot Chat model picker.

## API Reference

### VertexChatModelDispatcher
[source](../src/VertexChatModelDispatcher.ts)
The central class that implements `vscode.LanguageModelChatProvider`. It manages model discovery, provider registration, and request dispatching.

**Methods:**
- `onDidChangeLanguageModelChatInformation`: Event that fires when the available model list changes, prompting VS Code to refresh model information.
- `discoverModelsAndRegion()`: Probes GCP regions to find available models based on the local catalog.
- `setProjectId(projectId: string)`: Updates the active GCP project and resets discovery state.
- `provideLanguageModelChatInformation(...)`: Returns the list of discovered models to VS Code.
- `provideTokenCount(...)`: Calculates or estimates token counts for messages.
- `provideLanguageModelChatResponse(...)`: Streams the chat response from the appropriate vendor provider and records usage.
- `getAnthropicProvider()`: Returns the registered Anthropic provider instance.
- `getGoogleProvider()`: Returns the registered Google provider instance.

### ModelSpec
[source](../src/VertexChatModelDispatcher.ts)
Interface defining the metadata and capabilities for a supported model.

**Properties:**
- `id`: Unique identifier for the model.
- `vendor`: The vendor name (e.g., "google", "anthropic").
- `displayName`: Human-readable name shown in the UI.
- `family`: Model family (e.g., "gemini", "claude").
- `version`: The specific API version/model name.
- `maxInputTokens`: Maximum allowed input tokens.
- `maxOutputTokens`: Maximum allowed output tokens.
- `capabilities`: Object containing `imageInput` and `toolCalling` booleans.

### ModelCatalog
[source](../src/VertexChatModelDispatcher.ts)
Interface for the `models.json` structure containing the list of potential models and region priorities.

**Properties:**
- `candidateModels`: Array of `ModelSpec` objects representing supported model versions.
- `regionPriority`: Ordered list of strings representing GCP regions to probe (e.g., `global`, `us-east5`).

### DiscoveryResult
[source](../src/VertexChatModelDispatcher.ts)
The result of a region discovery operation, containing the successful `region` and the list of `availableModels`.

**Properties:**
- `region`: The successfully identified GCP region where models responded.
- `availableModels`: Array of `ModelSpec` objects successfully pinged in the identified region.

### activate
[source](../src/extension.ts)
The main entry point for the VS Code extension. It handles:
- Configuration migration from legacy settings.
- Initializing the `UsageTrackerService` and `CostStatusBar`.
- Registering the `VertexChatModelDispatcher` as a language model chat provider.
- Setting up commands for model refreshing and commit message generation.
- Watching for configuration changes to trigger re-discovery.

### runDiscovery
[source](../src/extension.ts)
A helper function that triggers the model discovery process on the dispatcher and provides UI feedback (Information/Warning messages) to the user based on the results.

---

## Examples
*(High-level explanation of the architecture, dependencies, or primary design patterns used in this code).*