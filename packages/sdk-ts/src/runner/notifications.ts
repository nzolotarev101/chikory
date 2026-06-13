import type { JournalEntry, NotificationPolicy, VerdictKind } from "../types.js";

export interface Notification {
  trigger: "escalate" | "milestone" | "terminal";
  atStep: number | null;
  message: string;
}

export function notificationsFor(
  entries: JournalEntry[],
  policy: NotificationPolicy,
): Notification[] {
  const notifications: Notification[] = [];

  for (const entry of entries) {
    if (entry.kind === "verdict") {
      const { atStep, verdict } = entry.payload as {
        atStep: number;
        verdict: { kind: VerdictKind; escalateReason?: string };
      };

      if (verdict.kind === "ESCALATE" && policy.on.includes("escalate")) {
        notifications.push({
          trigger: "escalate",
          atStep,
          message: `ESCALATE at step ${atStep}: ${verdict.escalateReason ?? "(no reason given)"}`,
        });
      } else if (verdict.kind === "PROCEED" && policy.on.includes("milestone")) {
        notifications.push({
          trigger: "milestone",
          atStep,
          message: `milestone PROCEED at step ${atStep}`,
        });
      }
    } else if (entry.kind === "terminal" && policy.on.includes("terminal")) {
      const { status } = entry.payload as { status: string };
      notifications.push({
        trigger: "terminal",
        atStep: null,
        message: `terminal: ${status}`,
      });
    }
  }

  return notifications;
}
