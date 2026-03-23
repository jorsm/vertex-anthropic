import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import * as vscode from "vscode";
import { VertexModelProvider, ChatInferenceResult } from "./VertexModelProvider";

// ─── Output channel for diagnostics ─────────────────────────────────────────

const outputChannel = vscode.window.createOutputChannel("Vertex Anthropic Plugin");

function log(msg: string): void {
  const ts = new Date().toISOString();
  outputChannel.appendLine(`[${ts}] ${msg}`);
}

// ─── Provider Plugin ───────────────────────────────────────────────────────

export class VertexAnthropicProvider implements VertexModelProvider {
  vendor = "anthropic";
  private client!: AnthropicVertex;
  private projectId!: string;
  private region!: string;

  initialize(projectId: string, region: string): void {
    this.projectId = projectId;
    this.region = region;
    this.client = new AnthropicVertex({
      projectId: this.projectId,
      region: this.region,
    });
  }

  async pingModel(modelId: string): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      });
      log(`    🏓 Anthropic ${modelId} → ✅`);
      return true;
    } catch {
      log(`    🏓 Anthropic ${modelId} → ❌`);
      return false;
    }
  }

  // ── Token counting (heuristic: ~4 chars per token) ─────────────────────

  async provideTokenCount(text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
    if (typeof text === "string") {
      return Math.ceil(text.length / 4);
    }
    let length = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        length += part.value.length;
      }
    }
    return Math.ceil(length / 4);
  }

  // ── Chat response (inference) ─────────────────────────────────────────

  async provideLanguageModelChatResponse(
    modelId: string,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<ChatInferenceResult> {
    log(`▶ Anthropic Plugin provideLanguageModelChatResponse called — model: ${modelId}, region: ${this.region}, messages: ${messages.length}`);

    try {
      // Extract system prompt from System-role messages
      const systemParts: string[] = [];
      const mappedMessages: any[] = [];
      const charCount = { system: 0, user_text: 0, assistant_text: 0, image: 0, tool_use: 0, tool_result: 0 };

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const roleNum = msg.role;
        const roleName = roleNum === vscode.LanguageModelChatMessageRole.User ? "User" : roleNum === vscode.LanguageModelChatMessageRole.Assistant ? "Assistant" : "System";
        log(`  ── Message [${i}] role=${roleName} (${roleNum}), ${msg.content.length} part(s)`);

        for (let p = 0; p < msg.content.length; p++) {
          const part = msg.content[p];
          if (part instanceof vscode.LanguageModelTextPart) {
            const preview = part.value.length > 300 ? "…" + part.value.slice(-300) : part.value;
            log(`     Part [${p}] TextPart (${part.value.length} chars): ${preview}`);
          } else if (part instanceof vscode.LanguageModelToolResultPart) {
            const contentPreview = Array.isArray(part.content)
              ? part.content.map((c) => (c instanceof vscode.LanguageModelTextPart ? (c.value.length > 100 ? "…" + c.value.slice(-100) : c.value) : JSON.stringify(c).slice(-100))).join(", ")
              : String(part.content).length > 100
                ? "…" + String(part.content).slice(-100)
                : String(part.content);
            log(`     Part [${p}] ToolResultPart callId=${part.callId}, content: ${contentPreview}`);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            const inputStr = JSON.stringify(part.input);
            const inputPreview = inputStr.length > 200 ? "…" + inputStr.slice(-200) : inputStr;
            log(`     Part [${p}] ToolCallPart callId=${part.callId}, name=${part.name}, input=${inputPreview}`);
          } else if (part instanceof vscode.LanguageModelDataPart) {
            const size = part.data?.byteLength ?? 0;
            log(`     Part [${p}] DataPart mime=${part.mimeType}, size=${size} bytes`);
          } else {
            const keys = Object.keys(part as any);
            const snapshot = keys.slice(0, 5).map((k) => `${k}=${String((part as any)[k]).slice(0, 50)}`).join(", ");
            log(`     Part [${p}] Unknown part type: ${Object.getPrototypeOf(part)?.constructor?.name ?? typeof part} — keys: [${keys.join(", ")}] ${snapshot}`);
          }
        }

        // System messages → Anthropic "system" parameter
        if (roleNum !== vscode.LanguageModelChatMessageRole.User && roleNum !== vscode.LanguageModelChatMessageRole.Assistant) {
          for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelTextPart && part.value.length > 0) {
              systemParts.push(part.value);
              charCount.system += part.value.length;
            }
          }
          log(`     → Extracted as system prompt (${systemParts.length} part(s) so far, ${systemParts.reduce((a, s) => a + s.length, 0)} chars total)`);
          continue;
        }

        const role = roleNum === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";
        const contentParts: any[] = [];

        for (const part of msg.content) {
          if (part instanceof vscode.LanguageModelTextPart) {
            if (part.value.length > 0) {
              contentParts.push({ type: "text", text: part.value });
              if (role === "user") charCount.user_text += part.value.length;
              else charCount.assistant_text += part.value.length;
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
            charCount.tool_result += toolResultStr.length;
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            contentParts.push({
              type: "tool_use",
              id: part.callId,
              name: part.name,
              input: part.input,
            });
            charCount.tool_use += JSON.stringify(part.input).length + part.name.length;
          } else if (part instanceof vscode.LanguageModelDataPart) {
            // Image data → Anthropic base64 image content block
            if (part.mimeType?.startsWith("image/")) {
              const base64 = Buffer.from(part.data).toString("base64");
              contentParts.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: part.mimeType,
                  data: base64,
                },
              });
              charCount.image += base64.length;
              log(`     🖼️  Mapped image: ${part.mimeType}, ${part.data.byteLength} bytes → base64 (${base64.length} chars)`);
            } else {
              // Non-image data part — try to include as text
              try {
                const text = new TextDecoder().decode(part.data);
                if (text.length > 0) {
                  contentParts.push({ type: "text", text });
                  if (role === "user") charCount.user_text += text.length;
                  else charCount.assistant_text += text.length;
                  log(`     📎 Mapped non-image DataPart (${part.mimeType}) as text (${text.length} chars)`);
                }
              } catch {
                log(`     ⚠️  Skipped non-image DataPart (${part.mimeType}, ${part.data.byteLength} bytes) — could not decode`);
              }
            }
          }
        }

        if (contentParts.length === 0) {
          contentParts.push({ type: "text", text: " " });
        }
        mappedMessages.push({ role, content: contentParts });
      }

      // Ensure the first message is from the user (Anthropic requirement)
      if (mappedMessages.length === 0 || mappedMessages[0].role !== "user") {
        log(`  ⚠️  No user messages — inserting placeholder`);
        mappedMessages.unshift({ role: "user", content: [{ type: "text", text: " " }] });
      }

      // Explicit tool format mapping to Anthropic tool schema. Allows provider to overwrite default tool behaviors.
      const tools: any[] | undefined = options.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema ?? { type: "object", properties: {} },
      }));

      if (tools?.length) {
        log(`  🔧 Tools provided: ${tools.map((t) => t.name).join(", ")}`);
        charCount.system += JSON.stringify(tools).length;
      }

      const maxTokens = 4096; // Just a default fallback, could be pulled from options or model spec in the future

      let systemBlocks: any[] | undefined = undefined;
      if (systemParts.length > 0) {
          systemBlocks = systemParts.map(text => ({ type: "text", text }));
      }

      // 1. Static Prefix Caching (System / Tools)
      let prefixCached = false;
      if (tools && tools.length > 0) {
          tools[tools.length - 1].cache_control = { type: "ephemeral" };
          prefixCached = true;
      } else if (systemBlocks && systemBlocks.length > 0) {
          systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };
          prefixCached = true;
      }

      // 2. Chat History Caching (Messages)
      let historyTokens = 0;
      for (let i = 0; i < mappedMessages.length - 1; i++) {
         historyTokens += Math.ceil(JSON.stringify(mappedMessages[i]).length / 4);
      }
      
      let historyCached = false;
      if (historyTokens > 1024 && mappedMessages.length > 1) {
         const secondToLast = mappedMessages[mappedMessages.length - 2];
         if (secondToLast.content && secondToLast.content.length > 0) {
             const lastBlock = secondToLast.content[secondToLast.content.length - 1];
             lastBlock.cache_control = { type: "ephemeral" };
             historyCached = true;
         }
      }

      // Log final mapped messages summary
      log(`  ── Mapped messages summary ──`);
      for (let i = 0; i < mappedMessages.length; i++) {
        const mm = mappedMessages[i];
        const partsDesc = mm.content
          .map((p: any) => p.type + (p.cache_control ? " [CACHED]" : ""))
          .join(", ");
        log(`     [${i}] ${mm.role}: ${partsDesc}`);
      }
      
      const sysLog = systemBlocks ? systemParts.reduce((a, b) => a + b.length, 0) + " chars" : "none";
      log(`  Sending: model=${modelId}, max_tokens=${maxTokens}, msgs=${mappedMessages.length}, system=${sysLog}, tools=${tools?.length ?? 0}`);
      log(`  Caching Strategy Applied: Prefix=${prefixCached}, History=${historyCached} (Estimated ${historyTokens} tokens)`);

      const stream = await this.client.messages.create({
        model: modelId,
        messages: mappedMessages,
        max_tokens: maxTokens,
        stream: true,
        ...(systemBlocks ? { system: systemBlocks } : {}),
        ...(tools?.length ? { tools } : {}),
      });

      log(`  Stream created successfully`);

      let activeToolCallId = "";
      let activeToolName = "";
      let activeToolJson = "";
      let chunkCount = 0;

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheCreateTokens = 0;

      for await (const chunk of stream) {
        chunkCount++;

        if (token.isCancellationRequested) {
          log(`  Cancelled after ${chunkCount} chunks`);
          break;
        }

        if (chunk.type === "message_start") {
          const usage = (chunk as any).message?.usage;
          if (usage) {
            inputTokens = usage.input_tokens ?? 0;
            cacheReadTokens = usage.cache_read_input_tokens ?? 0;
            cacheCreateTokens = usage.cache_creation_input_tokens ?? 0;
            log(`  📊 Input tokens: ${inputTokens}, cache_read: ${cacheReadTokens}, cache_create: ${cacheCreateTokens}`);
          }
        } else if (chunk.type === "message_delta") {
          const usage = (chunk as any).usage;
          if (usage) {
            outputTokens = usage.output_tokens ?? 0;
            log(`  📊 Output tokens: ${outputTokens}`);
          }
        } else if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          charCount.assistant_text += chunk.delta.text.length;
          progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
        } else if (chunk.type === "content_block_start" && chunk.content_block.type === "tool_use") {
          activeToolCallId = chunk.content_block.id;
          activeToolName = chunk.content_block.name;
          activeToolJson = "";
        } else if (chunk.type === "content_block_delta" && chunk.delta.type === "input_json_delta") {
          charCount.tool_use += chunk.delta.partial_json.length;
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
      log(`  ✅ Stream finished — ${chunkCount} chunks total`);

      return {
        usage: {
          input: inputTokens,
          output: outputTokens,
          cache_read: cacheReadTokens,
          cache_create: cacheCreateTokens,
        },
        charCount
      };
    } catch (e) {
      log(`  ❌ Anthropic provideLanguageModelChatResponse error: ${e}`);
      throw e;
    }
  }
}
