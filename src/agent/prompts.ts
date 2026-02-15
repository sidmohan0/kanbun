export function buildDraftPrompt(params: {
  projectName: string;
  projectDescription: string;
  contactName: string;
  contactTitle: string | null;
  contactCompany: string | null;
  contactNotes: string | null;
  priorThread: string | null;
  context: string | null;
  sequenceStep: number;
}): string {
  const lines = [
    `You are writing an outreach email for the project "${params.projectName}".`,
    params.projectDescription ? `Project context: ${params.projectDescription}` : "",
    "",
    `Recipient: ${params.contactName}`,
    params.contactTitle ? `Title: ${params.contactTitle}` : "",
    params.contactCompany ? `Company: ${params.contactCompany}` : "",
    params.contactNotes ? `Notes: ${params.contactNotes}` : "",
    "",
    params.priorThread ? `Previous email thread:\n${params.priorThread}\n` : "",
    params.context ? `Additional context: ${params.context}` : "",
    "",
    params.sequenceStep > 1
      ? `This is follow-up #${params.sequenceStep - 1}. Be brief and reference the previous email.`
      : "This is the initial outreach email.",
    "",
    "Write a concise, personalized email. Return JSON with { subject, body } fields.",
    "The body should be plain text with paragraph breaks. Do not use HTML.",
    "Be natural and human. Avoid salesy language.",
  ];
  return lines.filter(Boolean).join("\n");
}
