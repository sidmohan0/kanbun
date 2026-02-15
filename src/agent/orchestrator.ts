import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { ProjectService } from "../services/project.js";
import { ContactService } from "../services/contact.js";
import { DraftService } from "../services/draft.js";
import { buildDraftPrompt } from "./prompts.js";

export class Orchestrator {
  private anthropic: Anthropic;
  private projectService: ProjectService;
  private contactService: ContactService;
  private draftService: DraftService;

  constructor(private db: Database.Database, apiKey?: string) {
    this.anthropic = new Anthropic({ apiKey });
    this.projectService = new ProjectService(db);
    this.contactService = new ContactService(db);
    this.draftService = new DraftService(db);
  }

  async generateDrafts(params: {
    projectId: number;
    context?: string;
    model?: string;
    contactIds?: number[];
  }): Promise<number> {
    const project = this.projectService.getById(params.projectId);
    if (!project) throw new Error(`Project ${params.projectId} not found`);
    if (!project.default_send_account_id)
      throw new Error("Project has no default send account");

    let contacts = this.contactService.listByProject(params.projectId);
    if (params.contactIds) {
      contacts = contacts.filter((c) => params.contactIds!.includes(c.id));
    }
    contacts = contacts.filter(
      (c) => !this.draftService.pendingForContact(c.id, params.projectId)
    );

    let count = 0;
    for (const contact of contacts) {
      const prompt = buildDraftPrompt({
        projectName: project.name,
        projectDescription: project.description ?? "",
        contactName: `${contact.first_name} ${contact.last_name}`,
        contactTitle: contact.title,
        contactCompany: contact.company,
        contactNotes: contact.notes,
        priorThread: null,
        context: params.context ?? null,
        sequenceStep: 1,
      });

      const response = await this.anthropic.messages.create({
        model: params.model ?? "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const parsed = JSON.parse(text);

      this.draftService.create({
        project_id: params.projectId,
        contact_id: contact.id,
        send_account_id: project.default_send_account_id,
        subject: parsed.subject,
        body: parsed.body,
        draft_type: "agent",
      });
      count++;
    }
    return count;
  }
}
