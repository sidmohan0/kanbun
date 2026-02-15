import { Command } from "commander";
import { projectCmd } from "./commands/project.js";

const program = new Command()
  .name("kanbun")
  .description("Personal CRM for founder outreach")
  .version("0.1.0");

program.addCommand(projectCmd);

program.parse();
