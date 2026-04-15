# docs/usage-and-billing.md

> **Overview**
> This module provides a visual dashboard for tracking LLM usage, token consumption, and estimated costs within the Vertex AI extension.

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [DashboardWebview](#dashboardwebview)
- [Examples](#examples)

---

## Core Concepts
The usage and billing module is centered around the `DashboardWebview`, which provides an interactive UI for developers to monitor their GCP Vertex AI consumption.

- **Data Visualization**: Uses [ECharts](https://echarts.apache.org/en/index.html) to render time-series costs, token distribution, and payload footprints (input vs. output vs. cached tokens).
- **Cost Estimation**: Calculates raw token estimates based on standard publicly documented pricing for Gemini and Claude models. Users are warned that the Google Cloud Billing Console remains the final source of truth.
- **Project Context**: Automatically generates deep links to the specific Google Cloud Billing page using the configured `vertexAiChat.projectId`.
- **Filtering**: Supports date range selection, model-specific filtering, and quick presets (Today, Last 7 Days, This Month).
- **Persistence**: Usage logs are tracked by the `UsageTrackerService`, and the dashboard can permanently dismiss cost warnings by updating the `vertexAiChat.hideBillingWarning` global configuration.

## API Reference

### DashboardWebview
[source](../src/DashboardWebview.ts)
The primary class responsible for creating and managing the VS Code Webview panel for the "Vertex AI Usage & Costs" dashboard.

#### currentPanel
[source](../src/DashboardWebview.ts)
`public static currentPanel: DashboardWebview | undefined`
A static reference to the currently active dashboard instance, used to prevent duplicate panels.

#### createOrShow
[source](../src/DashboardWebview.ts)
`public static createOrShow(extensionUri: vscode.Uri, usageTracker: UsageTrackerService)`
Reveals the existing dashboard panel or creates a new one if it doesn't exist.
- `extensionUri`: The base URI of the extension for resolving local media resources (scripts, CSS).
- `usageTracker`: An instance of `UsageTrackerService` used to query the local usage database.

#### dispose
[source](../src/DashboardWebview.ts)
`public dispose()`
Cleans up the webview panel and disposes of all internal event listeners and subscriptions.

## Examples

### Programmatic Dashboard Launch
To show the dashboard from an extension command:
```typescript
import { DashboardWebview } from './DashboardWebview';

// Inside an activation or command registration
DashboardWebview.createOrShow(context.extensionUri, usageTrackerInstance);
```

### Dashboard UI Components
The dashboard renders several key metrics and interactive elements:
- **Summary Cards**: Displays Total Cost, Total Tokens, Most Used Model, and Cached Tokens savings.
- **Interactive Charts**:
    - **Costs**: Daily bar chart and model distribution pie chart.
    - **Tokens**: Input vs. Output trends.
    - **Payload Footprint**: Analysis of payload density across models.
- **Summary Table**: Detailed breakdown of requests, costs, and token types per model.