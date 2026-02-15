export interface Project {
  id: number;
  name: string;
  description: string | null;
  pipeline_stages: string[];
  follow_up_cadence: number[];
  default_send_account_id: number | null;
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
  created_at: string;
  updated_at: string;
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
}

export interface Template {
  id: number;
  project_id: number;
  name: string;
  subject: string;
  body: string;
  variables: string[];
}
