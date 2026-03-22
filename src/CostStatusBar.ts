import * as vscode from "vscode";
import { UsageTrackerService } from "./UsageTrackerService";

export class CostStatusBar implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly usageTracker: UsageTrackerService;
  private readonly disposable: vscode.Disposable;

  constructor(usageTracker: UsageTrackerService) {
    this.usageTracker = usageTracker;

    // Create the status bar item aligned to the right (priority 100 to stick near the edge)
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = "claudeBilling.showDashboard";
    this.statusBarItem.tooltip = "Click to open Usage Dashboard";

    // Listen to usage updates
    this.disposable = this.usageTracker.onUsageUpdated(() => {
      this.updateStatusBar().catch((err) => console.error(err));
    });

    // Initial update
    this.updateStatusBar().catch((err) => console.error(err));
    this.statusBarItem.show();
  }

  private async updateStatusBar(): Promise<void> {
    try {
      const todayCost = await this.usageTracker.getTodayTotalCost();
      // Format to 2 decimal places with $
      const formattedCost = `$${todayCost.toFixed(2)}`;
      this.statusBarItem.text = `$(pulse) Today: ${formattedCost}`;
    } catch (error) {
      console.error("[CostStatusBar] Error updating status bar:", error);
      this.statusBarItem.text = `$(pulse) Today: $--.--`;
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
    this.disposable.dispose();
  }
}
