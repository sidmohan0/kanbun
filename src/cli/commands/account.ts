import { Command } from "commander";
import { api } from "../client.js";

export const accountCmd = new Command("account").description(
  "Manage email accounts"
);

accountCmd
  .command("add <provider>")
  .description("Add an email account (gmail or outlook)")
  .action(async (provider: string) => {
    if (provider !== "gmail" && provider !== "outlook") {
      console.error("Provider must be 'gmail' or 'outlook'");
      process.exit(1);
    }
    // OAuth flow will be implemented in Phase 5
    // For now, stub with placeholder
    console.log(
      `OAuth flow for ${provider} — not yet implemented. Coming in Phase 5.`
    );
  });

accountCmd
  .command("list")
  .description("List email accounts")
  .action(async () => {
    const accounts = await api("/api/accounts");
    if (accounts.length === 0) {
      console.log("No email accounts configured.");
      return;
    }
    for (const a of accounts) {
      console.log(
        `#${a.id} ${a.provider} — ${a.email_address} (${a.display_name})`
      );
    }
  });
