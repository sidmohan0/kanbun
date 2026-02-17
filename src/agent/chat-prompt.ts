export interface ChatContext {
  project?: {
    name: string;
    description: string | null;
    stages: { name: string; count: number }[];
  } | null;
  contact?: {
    name: string;
    email: string;
    company: string | null;
    title: string | null;
    notes: string | null;
  } | null;
}

export function buildChatSystemPrompt(context: ChatContext): string {
  const lines = [
    "You are a CRM assistant for Kanbun, a personal CRM for founder outreach.",
    "You help users understand their contacts, projects, pipeline status, and outreach strategy.",
    "Be concise and direct. Use the CRM context provided below to give accurate, specific answers.",
    "",
  ];

  if (context.project) {
    lines.push(`Current project: ${context.project.name}`);
    if (context.project.description) {
      lines.push(`Project description: ${context.project.description}`);
    }
    if (context.project.stages.length > 0) {
      lines.push("Pipeline stages:");
      for (const stage of context.project.stages) {
        lines.push(`  - ${stage.name}: ${stage.count} contact${stage.count !== 1 ? "s" : ""}`);
      }
    }
    lines.push("");
  } else {
    lines.push("No project is currently selected.");
    lines.push("");
  }

  if (context.contact) {
    lines.push(`Selected contact: ${context.contact.name}`);
    lines.push(`Email: ${context.contact.email}`);
    if (context.contact.company) lines.push(`Company: ${context.contact.company}`);
    if (context.contact.title) lines.push(`Title: ${context.contact.title}`);
    if (context.contact.notes) lines.push(`Notes: ${context.contact.notes}`);
    lines.push("");
  }

  return lines.join("\n");
}
