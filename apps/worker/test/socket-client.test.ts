import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";
import { connectTestSocket } from "./socket-client";

it("reports the real close frame and acknowledges it without waiting for the peer's TCP FIN", async () => {
  const server = createServer();
  let peer: Socket | undefined;
  const acknowledgement = new Promise<Buffer>((resolve) => {
    server.on("upgrade", (req, socket) => {
      peer = socket as Socket;
      peer.allowHalfOpen = true;
      const key = String(req.headers["sec-websocket-key"]);
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const payload = Buffer.concat([Buffer.from([0x03, 0xf0]), Buffer.from("revoked")]);
      socket.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
      let received = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 15) resolve(received);
      });
      // The peer deliberately does not send a TCP FIN after its close frame.
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const result = await connectTestSocket(`http://127.0.0.1:${address.port}`, "/");
    expect(result.status).toBe(101);
    expect(await result.connection!.closed).toEqual({ code: 1008, reason: "revoked" });
    const reply = await acknowledgement;
    expect(reply[0]).toBe(0x88);
    expect(reply[1]).toBe(0x80 | 9);
    const mask = reply.subarray(2, 6);
    const payload = Buffer.from(reply.subarray(6));
    for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
    expect(payload.readUInt16BE(0)).toBe(1008);
    expect(payload.subarray(2).toString()).toBe("revoked");
  } finally {
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
