import type { Notification } from "./notifications.js";

const EMOJI: Record<Notification["trigger"], string> = {
  escalate: "🚨",
  milestone: "✅",
  terminal: "🏁",
};

export function slackPayloadFor(notification: Notification): { text: string } {
  return {
    text: `${EMOJI[notification.trigger]} ${notification.message}`,
  };
}
