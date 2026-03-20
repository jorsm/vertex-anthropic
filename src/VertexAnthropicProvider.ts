import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleAuth } from "google-auth-library";
import * as vscode from "vscode";
import modelCatalog from "./models.json";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModelSpec {
  id: string;
  displayName: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: { imageInput: boolean; toolCalling: boolean };
}

interface DiscoveryResult {
  region: string;
  availableModels: ModelSpec[];
}

// ─── Output channel for diagnostics ─────────────────────────────────────────

const outputChannel = vscode.window.createOutputChannel("Vertex Anthropic");

function log(msg: string): void {
  const ts = new Date().toISOString();
  outputChannel.appendLine(`[${ts}] ${msg}`);
}

// ─── Provider ───────────────────────────────────────────────────────────────

export class VertexAnthropicProvider implements vscode.LanguageModelChatProvider {
  private client!: AnthropicVertex;
  private readonly auth: GoogleAuth;
  private projectId: string;
  private region = "global";
  private availableModels: ModelSpec[] = [];
  private discoveryDone = false;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  /**
   * Discover working region and available models by pinging candidates.
   *
   * Strategy:
   *   1. Try "global" endpoint first (routes to nearest region automatically).
   *   2. If global fails for *all* candidates, try each regional endpoint in
   *      priority order until at least one model responds.
   *   3. The first region where ≥1 model responds is used for all inference.
   */
  async discoverModelsAndRegion(): Promise<DiscoveryResult> {
    const candidates: ModelSpec[] = modelCatalog.candidateModels;
    const regions = modelCatalog.regionPriority;

    log(`Starting model discovery for project "${this.projectId}"…`);
    log(`Candidate models: ${candidates.map((m) => m.id).join(", ")}`);
    log(`Region priority: ${regions.join(" → ")}`);

    for (const region of regions) {
      log(`  Probing region "${region}"…`);
      const client = new AnthropicVertex({
        projectId: this.projectId,
        region,
      });

      const available: ModelSpec[] = [];

      for (const model of candidates) {
        const ok = await this.pingModel(client, model.id);
        if (ok) {
          available.push(model);
        }
      }

      if (available.length > 0) {
        log(`✅ Region "${region}" — ${available.length} model(s) available: ${available.map((m) => m.id).join(", ")}`);

        // Commit
        this.region = region;
        this.client = client;
        this.availableModels = available;
        this.discoveryDone = true;

        return { region, availableModels: available };
      }

      log(`  ⚠️  No models responded in "${region}", trying next…`);
    }

    // Nothing worked
    log("❌ No models available in any region.");
    this.availableModels = [];
    this.discoveryDone = true;

    return { region: "none", availableModels: [] };
  }

  /**
   * Send a minimal ping (max_tokens: 1) to see if a model is available.
   */
  private async pingModel(client: AnthropicVertex, modelId: string): Promise<boolean> {
    try {
      await client.messages.create({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      });
      log(`    🏓 ${modelId} → ✅`);
      return true;
    } catch {
      log(`    🏓 ${modelId} → ❌`);
      return false;
    }
  }

  // ── Re-discovery (project changed) ────────────────────────────────────

  /**
   * Update the project ID. Call `discoverModelsAndRegion()` afterwards to
   * re-run discovery with the new project.
   */
  setProjectId(projectId: string): void {
    this.projectId = projectId;
    this.discoveryDone = false;
  }

  // ── Chat provider interface ───────────────────────────────────────────

  provideLanguageModelChatInformation(_options: vscode.PrepareLanguageModelChatModelOptions, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
    if (!this.discoveryDone || this.availableModels.length === 0) {
      return [];
    }

    return this.availableModels.map((m) => ({
      id: m.id,
      name: `Vertex ${m.displayName}`,
      family: m.family,
      version: m.version,
      maxInputTokens: m.maxInputTokens,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {
        imageInput: m.capabilities.imageInput,
        toolCalling: m.capabilities.toolCalling,
      },
    }));
  }

  // ── Token counting ────────────────────────────────────────────────────

  async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
    let content: string;
    if (typeof text === "string") {
      content = text;
    } else {
      content = text.content
        .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
        .map((part) => part.value)
        .join("");
    }

    try {
      return await this.countTokensViaApi(model.version, content);
    } catch (e) {
      log(`⚠️  Token count API failed, falling back to heuristic: ${e}`);
      return Math.ceil(content.length / 4);
    }
  }

  /**
   * Calls the Vertex AI :countTokens endpoint.
   *
   * The countTokens endpoint is only available on regional endpoints
   * (us-east5, europe-west1, asia-southeast1), NOT on global.
   * If we're using the global endpoint for inference we pick the first
   * supported count-tokens region.
   */
  private async countTokensViaApi(modelVersion: string, text: string): Promise<number> {
    const countTokensRegions = modelCatalog.countTokensRegions;
    const region = countTokensRegions.includes(this.region) ? this.region : countTokensRegions[0];

    const authClient = await this.auth.getClient();
    const accessToken = await authClient.getAccessToken();

    const host = `${region}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1beta1/projects/${this.projectId}/locations/${region}/publishers/anthropic/models/${modelVersion}:countTokens`;

    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (response.ok) {
      const result = (await response.json()) as { totalTokens?: number };
      if (result.totalTokens !== undefined) {
        log(`Token count (${modelVersion}): ${result.totalTokens} tokens`);
        return result.totalTokens;
      }
    }

    // Fallback heuristic
    const estimate = Math.ceil(text.length / 4);
    log(`Token count heuristic (${modelVersion}): ${estimate} tokens (${text.length} chars)`);
    return estimate;
  }

  // ── Chat response (inference) ─────────────────────────────────────────

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const modelId = model.version;

    const mappedMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role !== vscode.LanguageModelChatMessageRole.User && msg.role !== vscode.LanguageModelChatMessageRole.Assistant) {
        continue;
      }
      const role = msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";
      const contentParts: any[] = [];

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          if (part.value.length > 0) {
            contentParts.push({ type: "text", text: part.value });
          }
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          let toolResultStr = "";
          if (Array.isArray(part.content)) {
            toolResultStr = part.content
              .map((c) => {
                if (c instanceof vscode.LanguageModelTextPart) {
                  return c.value;
                }
                return JSON.stringify(c);
              })
              .join("\n");
          }
          contentParts.push({
            type: "tool_result",
            tool_use_id: part.callId,
            content: toolResultStr || " ",
          });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          contentParts.push({
            type: "tool_use",
            id: part.callId,
            name: part.name,
            input: part.input,
          });
        }
      }

      if (contentParts.length === 0) {
        contentParts.push({ type: "text", text: " " });
      }
      mappedMessages.push({ role, content: contentParts });
    }

    const tools: any[] | undefined = options.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));

    const spec = this.availableModels.find((m) => m.id === modelId);
    const maxTokens = spec?.maxOutputTokens ?? 4096;

    const stream = await this.client.messages.create({
      model: modelId,
      messages: mappedMessages,
      max_tokens: maxTokens,
      stream: true,
      tools: tools?.length ? tools : undefined,
    });

    let activeToolCallId = "";
    let activeToolName = "";
    let activeToolJson = "";

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }

      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
      } else if (chunk.type === "content_block_start" && chunk.content_block.type === "tool_use") {
        activeToolCallId = chunk.content_block.id;
        activeToolName = chunk.content_block.name;
        activeToolJson = "";
      } else if (chunk.type === "content_block_delta" && chunk.delta.type === "input_json_delta") {
        activeToolJson += chunk.delta.partial_json;
      } else if (chunk.type === "content_block_stop" && activeToolCallId) {
        let parsedInput = {};
        try {
          parsedInput = JSON.parse(activeToolJson);
        } catch {
          // Ignore JSON parse errors
        }

        progress.report(new vscode.LanguageModelToolCallPart(activeToolCallId, activeToolName, parsedInput));
        activeToolCallId = "";
        activeToolName = "";
        activeToolJson = "";
      }
    }
  }
}
