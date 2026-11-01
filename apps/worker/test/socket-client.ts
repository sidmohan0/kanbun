import { createHash, randomBytes } from "node:crypto";
import { request } from "node:http";
import type { Socket } from "node:net";

// This client inspects the actual server close frame instead of waiting for the
// dev proxy to tear down TCP. It sends a masked close acknowledgement and ends
// its socket; a missing frame or unexpected disconnect is still a test failure.
export type TestSocket = {
  messages: unknown[];
  closed: Promise<{ code: number; reason: string }>;
  readonly readyState: number;
  send(message: string): void;
  close(): void;
};

function frame(opcode: number, payload: Buffer): Buffer {
  if (payload.length > 65535) throw new Error("Test WebSocket frame is too large");
  const header = Buffer.alloc(payload.length < 126 ? 6 : 8);
  header[0] = 0x80 | opcode;
  if (payload.length < 126) header[1] = 0x80 | payload.length;
  else {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const mask = randomBytes(4);
  mask.copy(header, header.length - 4);
  const encoded = Buffer.from(payload);
  for (let i = 0; i < encoded.length; i++) encoded[i] = encoded[i]! ^ mask[i % 4]!;
  return Buffer.concat([header, encoded]);
}

function connected(socket: Socket, head: Buffer): TestSocket {
  const messages: unknown[] = [];
  let bytes = Buffer.alloc(0);
  let state = 1;
  let sentClose = false;
  let settled = false;
  let fragments: Buffer[] = [];
  let fragmentOpcode = 0;
  let resolveClose!: (value: { code: number; reason: string }) => void;
  let rejectClose!: (error: Error) => void;
  const closed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
    resolveClose = resolve;
    rejectClose = reject;
  });
  // Some tests intentionally initiate a close during cleanup without awaiting it.
  void closed.catch(() => {});
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    state = 3;
    clearTimeout(closeTimer);
    socket.destroy();
    rejectClose(error);
  };
  const consume = (chunk: Buffer) => {
    bytes = Buffer.concat([bytes, chunk]);
    while (bytes.length >= 2 && !settled) {
      const first = bytes[0]!;
      const second = bytes[1]!;
      const opcode = first & 0x0f;
      const fin = (first & 0x80) !== 0;
      if ((first & 0x70) !== 0 || (second & 0x80) !== 0) return fail(new Error("Invalid server WebSocket frame"));
      let size = second & 0x7f;
      let offset = 2;
      if (size === 126) {
        if (bytes.length < 4) return;
        size = bytes.readUInt16BE(2);
        offset = 4;
      } else if (size === 127) {
        if (bytes.length < 10) return;
        const extended = bytes.readBigUInt64BE(2);
        if (extended > 1_048_576n) return fail(new Error("Server WebSocket frame is too large"));
        size = Number(extended);
        offset = 10;
      }
      if (bytes.length < offset + size) return;
      const payload = bytes.subarray(offset, offset + size);
      bytes = bytes.subarray(offset + size);
      if (opcode >= 8 && (!fin || size > 125)) return fail(new Error("Invalid WebSocket control frame"));
      if (opcode === 8) {
        if (size === 1) return fail(new Error("Invalid WebSocket close frame"));
        let reason: string;
        try {
          reason = new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(2));
        } catch {
          return fail(new Error("Invalid WebSocket close reason"));
        }
        const code = size === 0 ? 1005 : payload.readUInt16BE(0);
        settled = true;
        state = 3;
        clearTimeout(closeTimer);
        if (sentClose) socket.end();
        else socket.end(frame(8, payload));
        // Flush the close acknowledgement before releasing the TCP transport;
        // the development proxy may leave its half open for several seconds.
        socket.destroySoon();
        resolveClose({ code, reason });
      } else if (opcode === 9) socket.write(frame(10, payload));
      else if (opcode === 10) continue;
      else if (opcode === 1 || opcode === 2 || opcode === 0) {
        if (opcode === 0 && !fragmentOpcode) return fail(new Error("Unexpected WebSocket continuation"));
        if (opcode !== 0 && fragmentOpcode) return fail(new Error("Overlapping WebSocket messages"));
        if (opcode !== 0) fragmentOpcode = opcode;
        fragments.push(payload);
        if (fin) {
          const complete = Buffer.concat(fragments);
          const message = fragmentOpcode === 1 ? complete.toString("utf8") : complete;
          try {
            messages.push(typeof message === "string" ? JSON.parse(message) : message);
          } catch {
            messages.push(message);
          }
          fragments = [];
          fragmentOpcode = 0;
        }
      } else return fail(new Error("Unsupported WebSocket frame opcode"));
    }
  };
  socket.on("data", consume);
  socket.once("error", (error) => fail(error));
  socket.once("close", () => fail(new Error("WebSocket transport closed without a close frame")));
  if (head.length) consume(head);
  return {
    messages,
    closed,
    get readyState() {
      return state;
    },
    send(message) {
      if (state !== 1) throw new Error("WebSocket is not open");
      socket.write(frame(1, Buffer.from(message)));
    },
    close() {
      if (state !== 1) return;
      state = 2;
      sentClose = true;
      socket.write(frame(8, Buffer.from([0x03, 0xe8])));
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => fail(new Error("WebSocket close acknowledgement timed out")), 5000);
      closeTimer.unref();
    },
  };
}

export function connectTestSocket(
  origin: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; connection: TestSocket | null }> {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const expected = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    const req = request(new URL(path, origin), {
      headers: {
        ...headers,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
      },
    });
    req.setTimeout(5000, () => req.destroy(new Error("WebSocket upgrade timed out")));
    req.once("error", reject);
    req.once("response", (res) => {
      res.resume();
      res.once("end", () => resolve({ status: res.statusCode ?? 0, connection: null }));
    });
    req.once("upgrade", (res, socket, head) => {
      if (res.statusCode !== 101 || res.headers["sec-websocket-accept"] !== expected) {
        socket.destroy();
        reject(new Error("Invalid WebSocket upgrade"));
        return;
      }
      socket.setTimeout(0);
      resolve({ status: 101, connection: connected(socket, head) });
    });
    req.end();
  });
}
