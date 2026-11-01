import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

export type Session = { provider: "codex" | "claude"; id: string; title: string; updatedAt: number; status: string };
export type Collection = { sessions: Session[]; errors: string[]; collectedAt: number };

function codexPath(): string {
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  let versions: string[] = [];
  try {
    versions = readdirSync(nvm)
      .filter((name) => /^v\d+\.\d+\.\d+$/u.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    /* nvm is optional */
  }
  return [
    path.join(os.homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH,
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS",
    ...versions.map((version) => path.join(nvm, version, "bin")),
  ]
    .filter(Boolean)
    .join(path.delimiter);
}

async function codexSessions(): Promise<Session[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        PATH: codexPath(),
      },
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Codex app-server timed out"));
    }, 15000);
    let buffer = "";
    const sessions: Session[] = [];
    let nextId = 2;
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const fail = (error: Error) => {
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("exit", () => fail(new Error("Codex app-server exited")));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let message: {
          id?: number;
          error?: unknown;
          result?: {
            data?: Array<{ id: string; name?: string | null; preview?: string; updatedAt: number }>;
            nextCursor?: string | null;
          };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          fail(new Error("Codex app-server request failed"));
          return;
        }
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: nextId, method: "thread/list", params: { limit: 100 } });
        } else if (message.id === nextId) {
          if (!message.result || !Array.isArray(message.result.data)) {
            fail(new Error("Invalid Codex response"));
            return;
          }
          for (const thread of message.result.data) {
            sessions.push({
              provider: "codex",
              id: thread.id,
              title: thread.name ?? thread.preview ?? "Untitled",
              updatedAt: thread.updatedAt * 1000,
              status: "unknown",
            });
          }
          if (message.result.nextCursor) {
            nextId++;
            send({ id: nextId, method: "thread/list", params: { limit: 100, cursor: message.result.nextCursor } });
          } else {
            clearTimeout(timer);
            child.removeAllListeners("exit");
            child.kill();
            resolve(sessions);
          }
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "kanbun-collector", version: "0.1.0" } } });
  });
}

export async function collectSessions(): Promise<Collection> {
  const results = await Promise.allSettled([codexSessions(), listSessions()]);
  const sessions: Session[] = [];
  const errors: string[] = [];
  const codex = results[0];
  if (codex.status === "fulfilled") sessions.push(...codex.value);
  else errors.push(`Codex: ${String(codex.reason)}`);
  const claude = results[1];
  if (claude.status === "fulfilled")
    sessions.push(
      ...claude.value.map((session) => ({
        provider: "claude" as const,
        id: session.sessionId,
        title: session.customTitle ?? session.summary,
        updatedAt: session.lastModified,
        status: "unknown",
      })),
    );
  else errors.push(`Claude Code: ${String(claude.reason)}`);
  return { sessions, errors, collectedAt: Date.now() };
}
