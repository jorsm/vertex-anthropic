# Vertex Anthropic Provider for VS Code

A VS Code extension that registers **Claude Opus 4.6** (via Google Cloud Vertex AI) as a native language model chat provider. Once installed, the model appears alongside other models in the VS Code Copilot Chat view — no separate UI, no extra windows.

## How It Works

The extension implements the `vscode.LanguageModelChatProvider` API to bridge VS Code's built-in Chat UI with Anthropic Claude models hosted on [Google Cloud Vertex AI Model Garden](https://cloud.google.com/vertex-ai/docs/start/explore-models). It handles:

- **Message mapping** — translates VS Code chat messages (user, assistant, tool results, tool calls) into Anthropic's API format.
- **Streaming responses** — streams tokens back to the Chat UI in real time via the Vertex AI SDK.
- **Tool calling** — supports VS Code's native tool-calling flow, forwarding tool definitions and parsing streamed tool-use responses.
- **Authentication** — delegates to Google Cloud Application Default Credentials (ADC), so there are no API keys to manage.

## Installation

### From `.vsix` (pre-built)

1. Download the `.vsix` file from the repository:  
   [`vertex-anthropic-0.0.1.vsix`](https://github.com/jorsm/vertex-anthropic/blob/develop/vertex-anthropic-0.0.1.vsix)

2. Install it in VS Code using one of the following methods:

   **Option A — VS Code UI:**
   - Open the Extensions view (`Ctrl+Shift+X`)
   - Click the `···` menu (top-right of the Extensions sidebar) → **Install from VSIX…**
   - Select the downloaded `.vsix` file

   **Option B — Command line:**
   ```bash
   code --install-extension vertex-anthropic-0.0.1.vsix
   ```

3. Reload VS Code when prompted.

### From Source

```bash
git clone https://github.com/jorsm/vertex-anthropic.git
cd vertex-anthropic
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

## Prerequisites

### Google Cloud Authentication

The extension uses the [`@anthropic-ai/vertex-sdk`](https://www.npmjs.com/package/@anthropic-ai/vertex-sdk), which authenticates via [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/application-default-credentials). Before using the extension, authenticate locally:

```bash
gcloud auth application-default login
```

> Your GCP project must have the Vertex AI API enabled and access to the Claude Opus 4.6 model in the Model Garden.

### VS Code Version

Requires **VS Code 1.110.0** or later (for the `languageModelChatProviders` contribution point).

## Configuration

Open VS Code Settings (`Ctrl+,`) and search for **Vertex Anthropic**, or add the following to your `settings.json`:

| Setting                      | Type     | Default        | Description                                          |
|------------------------------|----------|----------------|------------------------------------------------------|
| `vertexAnthropic.projectId`  | `string` | `""`           | Your GCP Project ID (required)                       |
| `vertexAnthropic.region`     | `string` | `us-central1`  | GCP region for Vertex AI (e.g. `us-central1`, `europe-west1`) |

Example:

```jsonc
// settings.json
{
  "vertexAnthropic.projectId": "my-gcp-project-123",
  "vertexAnthropic.region": "us-central1"
}
```

> ⚠️ The extension will show a warning on activation if `projectId` is not set.

## Usage

1. Open the **Chat view** in VS Code (Copilot icon in the sidebar, or `Ctrl+Shift+I`).
2. Click the model picker and select **Vertex Claude 4.6 Opus**.
3. Type a message and send — responses stream in real time from Vertex AI.

The model supports tool calling, so it works with VS Code's built-in agent tools and any extensions that provide tool definitions.

## Model Details

| Property         | Value              |
|------------------|--------------------|
| Model ID         | `claude-opus-4-6`  |
| Family           | `claude`           |
| Max Input Tokens | 1,000,000          |
| Max Output Tokens| 128,000            |
| Tool Calling     | ✅                  |
| Image Input      | ❌                  |

## Development

```bash
npm run watch    # compile TypeScript in watch mode
npm run lint     # run ESLint
npm run test     # run tests
```

Press `F5` to launch the Extension Development Host. Use `Ctrl+R` inside the host window to reload after code changes.

## License

See the [LICENSE](LICENSE) file for details.
