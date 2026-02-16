import type Database from "better-sqlite3";
import type {
  GtmConfig,
  GtmScenario,
  GtmWeeklyProjection,
  GtmActualWeek,
} from "../shared/types.js";

export function defaultGtmConfig(): GtmConfig {
  return {
    phases: [
      {
        name: "Foundation",
        weeks: 4,
        weeklyGrowthRate: 0.15,
        conversionRate: 0.08,
        channels: [
          { name: "Direct Outreach", percentage: 60 },
          { name: "LinkedIn", percentage: 25 },
          { name: "Referrals", percentage: 15 },
        ],
        weeklyTargets: { outreach: 50, meetings: 5, demos: 2 },
      },
      {
        name: "Traction",
        weeks: 8,
        weeklyGrowthRate: 0.12,
        conversionRate: 0.12,
        channels: [
          { name: "Direct Outreach", percentage: 40 },
          { name: "LinkedIn", percentage: 30 },
          { name: "Content", percentage: 20 },
          { name: "Referrals", percentage: 10 },
        ],
        weeklyTargets: { outreach: 80, meetings: 10, demos: 5 },
      },
      {
        name: "Scale",
        weeks: 12,
        weeklyGrowthRate: 0.08,
        conversionRate: 0.15,
        channels: [
          { name: "Inbound", percentage: 35 },
          { name: "Direct Outreach", percentage: 25 },
          { name: "Content", percentage: 25 },
          { name: "Referrals", percentage: 15 },
        ],
        weeklyTargets: { outreach: 100, meetings: 15, demos: 8 },
      },
    ],
    initialUsers: 0,
    pricePerUser: 49,
    userMilestones: [
      { label: "First 10", value: 10 },
      { label: "50 users", value: 50 },
      { label: "100 users", value: 100 },
      { label: "250 users", value: 250 },
      { label: "500 users", value: 500 },
    ],
    revenueMilestones: [
      { label: "$500 MRR", value: 500 },
      { label: "$1K MRR", value: 1000 },
      { label: "$3K MRR", value: 3000 },
      { label: "$5K MRR", value: 5000 },
      { label: "$10K MRR", value: 10000 },
    ],
    scenarioMultipliers: {
      conservative: 0.7,
      base: 1.0,
      aggressive: 1.4,
    },
  };
}

export class GtmService {
  constructor(private db: Database.Database) {}

  generateProjections(
    config: GtmConfig,
    scenario: GtmScenario = "base"
  ): GtmWeeklyProjection[] {
    const multiplier = config.scenarioMultipliers[scenario];
    const projections: GtmWeeklyProjection[] = [];
    let totalUsers = config.initialUsers;
    let week = 0;

    for (const phase of config.phases) {
      for (let w = 0; w < phase.weeks; w++) {
        week++;
        const growth = phase.weeklyGrowthRate * multiplier;
        const newUsers = Math.max(1, Math.round(totalUsers * growth + phase.weeklyTargets.outreach * phase.conversionRate * multiplier));
        totalUsers += newUsers;

        projections.push({
          week,
          phase: phase.name,
          newUsers,
          totalUsers,
          mrr: totalUsers * config.pricePerUser,
          conversionRate: phase.conversionRate * multiplier,
        });
      }
    }

    return projections;
  }

  getActuals(projectId: number): GtmActualWeek[] {
    // Find the project's creation date to anchor week numbers
    const project = this.db
      .prepare("SELECT created_at FROM projects WHERE id = ?")
      .get(projectId) as { created_at: string } | undefined;

    if (!project) return [];

    const startDate = new Date(project.created_at);
    // Align to start of week (Monday)
    startDate.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));
    startDate.setHours(0, 0, 0, 0);

    const now = new Date();
    const weeks: GtmActualWeek[] = [];
    const current = new Date(startDate);

    let weekNum = 0;
    while (current < now) {
      weekNum++;
      const weekStart = current.toISOString();
      const weekEnd = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Contacts added this week for this project
      const contactsRow = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM project_contacts
           WHERE project_id = ? AND assigned_at >= ? AND assigned_at < ?`
        )
        .get(projectId, weekStart, weekEnd) as { count: number };

      // Emails sent this week for this project
      const sentRow = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM drafts
           WHERE project_id = ? AND status = 'sent' AND sent_at >= ? AND sent_at < ?`
        )
        .get(projectId, weekStart, weekEnd) as { count: number };

      // Replies: drafts that are follow-ups with parent_draft_id (sequence_step > 1 that were sent)
      // This is a rough proxy for replies — contacts who progressed in the pipeline
      const repliesRow = this.db
        .prepare(
          `SELECT COUNT(DISTINCT pc.contact_id) as count FROM project_contacts pc
           JOIN drafts d ON d.contact_id = pc.contact_id AND d.project_id = pc.project_id
           WHERE pc.project_id = ? AND d.status = 'sent' AND d.sequence_step > 1
           AND d.sent_at >= ? AND d.sent_at < ?`
        )
        .get(projectId, weekStart, weekEnd) as { count: number };

      // Meetings: contacts who reached a "meeting" or "demo" stage this week
      const meetingsRow = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM project_contacts
           WHERE project_id = ? AND (LOWER(current_stage) LIKE '%meeting%' OR LOWER(current_stage) LIKE '%demo%')
           AND stage_updated_at >= ? AND stage_updated_at < ?`
        )
        .get(projectId, weekStart, weekEnd) as { count: number };

      weeks.push({
        week: weekNum,
        weekStart: weekStart.split("T")[0],
        contactsAdded: contactsRow.count,
        emailsSent: sentRow.count,
        replies: repliesRow.count,
        meetings: meetingsRow.count,
      });

      current.setDate(current.getDate() + 7);
    }

    return weeks;
  }
}
