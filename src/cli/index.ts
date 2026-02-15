import { Command } from "commander";
import { projectCmd } from "./commands/project.js";
import { contactCmd } from "./commands/contact.js";
import { draftCmd } from "./commands/draft.js";
import { templateCmd } from "./commands/template.js";
import { accountCmd } from "./commands/account.js";

const program = new Command()
  .name("kanbun")
  .description("Personal CRM for founder outreach")
  .version("0.1.0");

program.addCommand(projectCmd);
program.addCommand(contactCmd);
program.addCommand(draftCmd);
program.addCommand(templateCmd);
program.addCommand(accountCmd);

program.parse();
