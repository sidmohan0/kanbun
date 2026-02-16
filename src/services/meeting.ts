import type Database from "better-sqlite3";

export interface Meeting {
  id: number;
  project_id: number;
  contact_id: number;
  meeting_type: "meeting" | "demo";
  scheduled_at: string | null;
  notes: string | null;
  created_at: string;
}

interface CreateMeetingInput {
  project_id: number;
  contact_id: number;
  meeting_type?: "meeting" | "demo";
  scheduled_at?: string;
  notes?: string;
}

export class MeetingService {
  constructor(private db: Database.Database) {}

  create(input: CreateMeetingInput): Meeting {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO meetings (project_id, contact_id, meeting_type, scheduled_at, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.project_id,
        input.contact_id,
        input.meeting_type ?? "meeting",
        input.scheduled_at ?? null,
        input.notes ?? null,
        now
      );
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Meeting | undefined {
    return this.db
      .prepare("SELECT * FROM meetings WHERE id = ?")
      .get(id) as Meeting | undefined;
  }

  listByProject(projectId: number): Meeting[] {
    return this.db
      .prepare("SELECT * FROM meetings WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Meeting[];
  }

  countByProjectInRange(projectId: number, start: string, end: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM meetings
         WHERE project_id = ? AND created_at >= ? AND created_at < ?`
      )
      .get(projectId, start, end) as { count: number };
    return row.count;
  }
}
