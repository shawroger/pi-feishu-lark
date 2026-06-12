import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIND_PATH, INBOX_ROOT, ensureRoot } from "./config.js";
import { debugLog } from "./debug.js";

const BIND_STALE_MS = 30_000;

/** 前台终端会话与飞书桥接的绑定记录。单一全局绑定。 */
export type FeishuBind = {
  pid: number;
  sessionId: string;
  cwd: string;
  boundAt: number;
  heartbeatAt: number;
};

/** daemon 转发给前台进程的一条飞书消息（仅文本）。 */
export type InboxMessage = {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  sessionKey: string;
  /** 用于 reply 到用户原消息。 */
  replyToMessageId: string;
  text: string;
  enqueuedAt: number;
};

// ----------------------------------------------------------------------------
// 绑定记录（前台写，daemon 只读）
// ----------------------------------------------------------------------------

export function readBind(): FeishuBind | undefined {
  try {
    const raw = readFileSync(BIND_PATH, "utf-8");
    const value = JSON.parse(raw);
    if (
      value &&
      typeof value.pid === "number" &&
      typeof value.sessionId === "string" &&
      typeof value.cwd === "string"
    ) {
      return value as FeishuBind;
    }
  } catch {}
  return undefined;
}

export function writeBind(bind: FeishuBind) {
  ensureRoot();
  writeFileSync(BIND_PATH, JSON.stringify(bind, null, 2));
}

/** 仅在记录属于该 pid 时清除，避免误删其它进程的绑定。 */
export function clearBind(pid?: number) {
  const current = readBind();
  if (!current) return;
  if (pid !== undefined && current.pid !== pid) return;
  rmSync(BIND_PATH, { force: true });
  rmSync(inboxDir(current.pid), { recursive: true, force: true });
}

export function touchBind(pid: number) {
  const current = readBind();
  if (!current || current.pid !== pid) return;
  current.heartbeatAt = Date.now();
  writeBind(current);
}

export function isBindActive(bind: FeishuBind | undefined): bind is FeishuBind {
  if (!bind) return false;
  if (!isProcessAlive(bind.pid)) return false;
  return Date.now() - bind.heartbeatAt <= BIND_STALE_MS;
}

/** 返回当前有效绑定，过期/进程已退则视为无绑定。 */
export function activeBind(): FeishuBind | undefined {
  const bind = readBind();
  return isBindActive(bind) ? bind : undefined;
}

// ----------------------------------------------------------------------------
// inbox 文件队列（daemon 写，前台读后删除）。每条一个文件，按 pid 隔离目录。
// ----------------------------------------------------------------------------

function inboxDir(pid: number) {
  return join(INBOX_ROOT, String(pid));
}

export function enqueueInbox(pid: number, msg: InboxMessage) {
  const dir = inboxDir(pid);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${msg.enqueuedAt}-${msg.messageId}.json`);
  const tmpPath = `${finalPath}.tmp`;
  // temp + rename 保证前台不会读到半写文件。
  writeFileSync(tmpPath, JSON.stringify(msg));
  renameSync(tmpPath, finalPath);
}

/** 读取并删除该 pid 收件箱里的全部消息，按入队顺序返回。 */
export function drainInbox(pid: number): InboxMessage[] {
  const dir = inboxDir(pid);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  names.sort();
  const out: InboxMessage[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      const msg = JSON.parse(readFileSync(path, "utf-8")) as InboxMessage;
      out.push(msg);
    } catch (error) {
      debugLog("feishu.inbox.parse_failed", { name, error: error instanceof Error ? error.message : String(error) });
    }
    rmSync(path, { force: true });
  }
  return out;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
