import type Database from "better-sqlite3";
import { ProjectService } from "../services/project.js";
import { DraftService } from "../services/draft.js";

export class FollowUpScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private projectService: ProjectService;
  private draftService: DraftService;

  constructor(private db: Database.Database) {
    this.projectService = new ProjectService(db);
    this.draftService = new DraftService(db);
  }

  start(intervalMs: number = 60 * 60 * 1000): void {
    this.intervalId = setInterval(() => this.check(), intervalMs);
    console.log("Follow-up scheduler started (checking hourly)");
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async check(): Promise<number> {
    let generated = 0;
    const projects = this.projectService.list();

    for (const project of projects) {
      if (project.follow_up_cadence.length === 0) continue;
      if (!project.default_send_account_id) continue;

      const candidates = this.db
        .prepare(
          `SELECT d.contact_id, d.id as last_draft_id, d.sequence_step, d.sent_at
           FROM drafts d
           WHERE d.project_id = ?
           AND d.status = 'sent'
           AND d.sequence_step <= ?
           AND NOT EXISTS (
             SELECT 1 FROM drafts d2
             WHERE d2.contact_id = d.contact_id
             AND d2.project_id = d.project_id
             AND d2.status = 'pending_review'
           )
           AND NOT EXISTS (
             SELECT 1 FROM project_contacts pc
             WHERE pc.contact_id = d.contact_id
             AND pc.project_id = d.project_id
             AND pc.current_stage = 'Replied'
           )
           ORDER BY d.sequence_step DESC`
        )
        .all(project.id, project.follow_up_cadence.length) as any[];

      for (const candidate of candidates) {
        const nextStep = candidate.sequence_step + 1;
        const cadenceIndex = nextStep - 2;
        if (cadenceIndex >= project.follow_up_cadence.length) continue;

        const daysToWait = project.follow_up_cadence[cadenceIndex];
        const sentDate = new Date(candidate.sent_at);
        const dueDate = new Date(sentDate.getTime() + daysToWait * 86400000);

        if (new Date() >= dueDate) {
          this.draftService.create({
            project_id: project.id,
            contact_id: candidate.contact_id,
            send_account_id: project.default_send_account_id,
            subject: "Re: (follow-up)",
            body: `[Follow-up #${nextStep - 1} — to be personalized]`,
            draft_type: "agent",
            parent_draft_id: candidate.last_draft_id,
            sequence_step: nextStep,
          });
          generated++;
        }
      }
    }
    return generated;
  }
}
