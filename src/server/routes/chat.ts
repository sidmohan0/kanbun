import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { ProjectService } from "../../services/project.js";
import { ContactService } from "../../services/contact.js";
import { buildChatSystemPrompt } from "../../agent/chat-prompt.js";
import type { ChatContext } from "../../agent/chat-prompt.js";

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  projectId?: number | null;
  contactId?: number | null;
}

export function chatRoutes(db: Database.Database) {
  const router = new Hono();

  router.post("/", async (c) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return c.json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);
    }

    const body = (await c.req.json()) as ChatRequest;
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages array is required" }, 400);
    }

    const context: ChatContext = {};

    if (body.projectId) {
      const projectService = new ProjectService(db);
      const project = projectService.getById(body.projectId);
      if (project) {
        const stageCounts = db
          .prepare(
            `SELECT current_stage AS name, COUNT(*) AS count
             FROM project_contacts
             WHERE project_id = ?
             GROUP BY current_stage`
          )
          .all(body.projectId) as { name: string; count: number }[];

        context.project = {
          name: project.name,
          description: project.description,
          stages: stageCounts,
        };
      }
    }

    if (body.contactId) {
      const contactService = new ContactService(db);
      const contact = contactService.getById(body.contactId);
      if (contact) {
        context.contact = {
          name: `${contact.first_name} ${contact.last_name}`,
          email: contact.email,
          company: contact.company,
          title: contact.title,
          notes: contact.notes,
        };
      }
    }

    const systemPrompt = buildChatSystemPrompt(context);
    const anthropic = new Anthropic({ apiKey });

    return streamSSE(c, async (stream) => {
      try {
        const response = anthropic.messages.stream({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          system: systemPrompt,
          messages: body.messages,
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            await stream.writeSSE({
              data: JSON.stringify({ type: "delta", text: event.delta.text }),
            });
          }
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: "done" }),
        });
      } catch (err: any) {
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message: err.message ?? "Unknown error" }),
        });
      }
    });
  });

  return router;
}
