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

const TITLE: Record<Notification["trigger"], string> = {
  escalate: "🚨 Escalation",
  milestone: "✅ Milestone",
  terminal: "🏁 Run finished",
};

export function desktopPayloadFor(notification: Notification): {
  title: string;
  body: string;
} {
  return {
    title: TITLE[notification.trigger],
    body: notification.message,
  };
}
