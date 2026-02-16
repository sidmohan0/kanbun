export interface Project {
  id: number;
  name: string;
  description: string | null;
  pipeline_stages: string[];
  follow_up_cadence: number[];
  default_send_account_id: number | null;
  gtm_config: GtmConfig | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  phone: string | null;
  notes: string | null;
  apollo_id: string | null;
  source: "manual" | "csv" | "apollo";
  social_links: SocialLink[];
  website: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialLink {
  provider: string;
  value: string;
}

export interface Group {
  id: number;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactTag {
  id: number;
  contact_id: number;
  name: string;
  created_at: string;
}

export interface ContactNote {
  id: number;
  contact_id: number;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface ContactProfile {
  contact: Contact;
  tags: string[];
  groups: Group[];
  notes: ContactNote[];
  social_links: SocialLink[];
}

export interface ProjectContact {
  project_id: number;
  contact_id: number;
  current_stage: string;
  assigned_at: string;
  stage_updated_at: string;
}

export interface EmailAccount {
  id: number;
  provider: "gmail" | "outlook";
  email_address: string;
  display_name: string;
  credentials: string;
}

export interface Draft {
  id: number;
  project_id: number;
  contact_id: number;
  send_account_id: number;
  subject: string;
  body: string;
  draft_type: "template" | "agent";
  status: "pending_review" | "approved" | "sent" | "skipped";
  scheduled_send_at: string | null;
  parent_draft_id: number | null;
  sequence_step: number;
  created_at: string;
  sent_at: string | null;
  thread_id: string | null;
}

export interface Template {
  id: number;
  project_id: number;
  name: string;
  subject: string;
  body: string;
  variables: string[];
}

// GTM Growth Model types

export interface GtmChannel {
  name: string;
  percentage: number;
}

export interface GtmPhase {
  name: string;
  weeks: number;
  weeklyGrowthRate: number;
  conversionRate: number;
  channels: GtmChannel[];
  weeklyTargets: {
    outreach: number;
    meetings: number;
    demos: number;
  };
}

export interface GtmMilestone {
  label: string;
  value: number;
}

export interface GtmConfig {
  phases: GtmPhase[];
  initialUsers: number;
  pricePerUser: number;
  userMilestones: GtmMilestone[];
  revenueMilestones: GtmMilestone[];
  scenarioMultipliers: {
    conservative: number;
    base: number;
    aggressive: number;
  };
}

export type GtmScenario = "conservative" | "base" | "aggressive";

export interface GtmWeeklyProjection {
  week: number;
  phase: string;
  newUsers: number;
  totalUsers: number;
  mrr: number;
  conversionRate: number;
}

export interface GtmActualWeek {
  week: number;
  weekStart: string;
  contactsAdded: number;
  emailsSent: number;
  replies: number;
  meetings: number;
}
