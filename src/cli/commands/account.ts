import { Command } from "commander";
import { api } from "../client.js";
import { exec } from "node:child_process";

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
    const baseUrl = process.env.KANBUN_URL ?? "http://localhost:7890";
    const url = `${baseUrl}/api/accounts/oauth/${provider}/start`;
    console.log(`Opening browser for ${provider} OAuth...`);
    console.log(url);

    // Open in default browser
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${cmd} "${url}"`);
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
