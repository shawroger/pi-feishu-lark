import { extractText } from "./bridge-runtime.js";
import { clearBind, drainInbox, touchBind, writeBind } from "./bind-store.js";
import { debugLog } from "./debug.js";
import { FeishuDelivery } from "./delivery.js";
import type { FeishuRoute } from "./types.js";

const POLL_MS = 500;
const HEARTBEAT_MS = 5_000;

type SendUserMessage = (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void;

/**
 * 前台终端进程一侧的桥接：把 daemon 转发到 inbox 的飞书消息注入当前 OMP 会话，
 * 并在每轮 agent_end 时把最终回复发回对应飞书会话。仅在用户执行 /feishu bind 后激活。
 */
export class ForegroundFeishuBridge {
  private active = false;
  private pollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  /** 注入但尚未回投的飞书来源，按注入顺序与 agent_end FIFO 对应。 */
  private readonly pending: FeishuRoute[] = [];
  private lastAssistantText = "";
  /** 前台没有 transport，delivery 会自动回落到 lark SDK 直发。 */
  private readonly delivery: FeishuDelivery;

  constructor(
    private readonly sendUserMessage: SendUserMessage,
    delivery?: FeishuDelivery,
  ) {
    this.delivery = delivery ?? new FeishuDelivery(() => undefined);
  }

  get bound() {
    return this.active;
  }

  bind(sessionId: string, cwd: string) {
    const now = Date.now();
    writeBind({ pid: process.pid, sessionId, cwd, boundAt: now, heartbeatAt: now });
    this.active = true;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => this.poll(), POLL_MS);
      this.pollTimer.unref?.();
    }
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => touchBind(process.pid), HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }
  }

  unbind() {
    this.stopTimers();
    clearBind(process.pid);
    this.pending.length = 0;
    this.lastAssistantText = "";
    this.active = false;
  }

  /** 进程退出时清理本进程的绑定与收件箱。 */
  dispose() {
    this.stopTimers();
    clearBind(process.pid);
    this.active = false;
  }

  private stopTimers() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private poll() {
    const messages = drainInbox(process.pid);
    for (const m of messages) {
      this.pending.push({
        sessionKey: m.sessionKey,
        chatId: m.chatId,
        chatType: m.chatType,
        threadMessageId: m.replyToMessageId,
        lastMessageId: m.messageId,
        updatedAt: Date.now(),
      });
      // 统一 followUp：idle 时直接起一轮，streaming 时排队；不指定会抛错并丢消息。
      this.sendUserMessage(m.text, { deliverAs: "followUp" });
      debugLog("feishu.forward.injected", { messageId: m.messageId, key: m.sessionKey });
    }
  }

  /** message_end 时调用：缓存最近一条有正文的 assistant 回复（纯工具调用消息正文为空，会被跳过）。 */
  noteAssistant(message: unknown) {
    const m = message as { role?: string } | undefined;
    if (!m || m.role !== "assistant") return;
    const text = extractText(m);
    if (text) this.lastAssistantText = text;
  }

  /** agent_end 时调用：把这一轮最终回复发回对应飞书会话。 */
  async flushReply() {
    const route = this.pending.shift();
    if (!route) return;
    const text = this.lastAssistantText;
    this.lastAssistantText = "";
    if (!text) return;
    try {
      await this.delivery.send(route, text);
      debugLog("feishu.forward.replied", { key: route.sessionKey, length: text.length });
    } catch (error) {
      debugLog("feishu.forward.reply_failed", {
        key: route.sessionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
