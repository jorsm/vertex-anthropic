# docs/providers.md

> **Overview**
> This module contains the provider implementations that bridge VS Code's Language Model API with Vertex AI backend services. It handles authentication via Application Default Credentials, model discovery, and the transformation of VS Code's chat protocol into provider-specific payloads (Anthropic/Google).

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
    - [VertexGoogleProvider](#vertexgoogleprovider)
        - [initialize](#initialize)
        - [pingModel](#pingmodel)
        - [provideTokenCount](#providetokencount)
        - [provideLanguageModelChatResponse](#providelanguagemodelchatresponse)
- [Examples](#examples)

---

## Core Concepts
The provider architecture uses a unified `VertexModelProvider` interface to support multiple model families. 

- **Google Gemini Integration**: Managed by `VertexGoogleProvider`, supporting Gemini 3 Flash and Pro models.
- **Thinking Models**: Specialized support for "High Thinking" models via model ID suffixes (e.g., `-high`), which triggers specific `thinkingConfig` parameters.
- **Thought Signatures**: A mechanism to maintain reasoning continuity across conversational turns by caching and re-injecting signatures into the message history.
- **Parallel Tool Execution**: Implementation of tool call buffering and message merging to satisfy Gemini's requirements for grouped function responses.

## API Reference

### VertexGoogleProvider
[source](../src/providers/VertexGoogleProvider.ts)
The `VertexGoogleProvider` class implements the `VertexModelProvider` interface for Google Gemini models hosted on Vertex AI. It manages the lifecycle of the `@google/genai` client and handles the complexities of Gemini-specific features like thinking signatures and parallel tool calls.

#### initialize
[source](../src/providers/VertexGoogleProvider.ts)
`initialize(projectId: string, region: string): void`

Sets the GCP Project ID and regional endpoint (e.g., `us-central1`) for the provider.

#### pingModel
[source](../src/providers/VertexGoogleProvider.ts)
`pingModel(modelId: string): Promise<boolean>`

Attempts a minimal request to the specified model ID to verify availability and permissions in the current GCP project. It automatically resolves high-thinking model IDs to their base counterparts for the ping.

#### provideTokenCount
[source](../src/providers/VertexGoogleProvider.ts)
`provideTokenCount(text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number>`

Provides a rough estimation of token usage. For text or message objects, it computes the count based on a 4-characters-per-token heuristic.

#### provideLanguageModelChatResponse
[source](../src/providers/VertexGoogleProvider.ts)
`provideLanguageModelChatResponse(modelId: string, messages: readonly vscode.LanguageModelChatRequestMessage[], options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<ChatInferenceResult>`

Main entry point for chat inference. This method:
1. Maps VS Code messages to the Gemini `contents` format.
2. Re-injects cached thought signatures into the conversation history to preserve reasoning quality.
3. Merges consecutive tool result messages into a single user turn.
4. Handles streaming responses, capturing both text and tool calls.
5. Buffers parallel tool calls to ensure they are emitted to VS Code as a single atomic step.
6. Updates internal signature caches for both text reasoning and tool calls.
7. Tracks and returns detailed usage statistics including character counts and token usage metadata.

## Examples