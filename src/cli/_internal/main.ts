// Entry point for dist/cli.cjs, run by the console-connect shims through Electron's Node runtime.
import { sendCliRequest } from './client';
import { cliProtocolVersion, pipePath } from './pipe';

const usage = `console-connect: work in your open Console Connect project from any terminal or AI tool.

  brief [--task <id>]                  The team, rules, open tasks, and what needs a click
  task list                            Open tasks
  task show <id>                       One task and its discussion
  task create --title <t> [--description <d>] [--assignee <name>]
  task assign <id> <name>
  task claim <id>
  task decline <id> [--note <why>]
  task reply <id> <message>            Post in the task's discussion
  ask <message>                        Ask on the task this console belongs to
  package show <id>                    A submitted package, or your own draft
  review propose <id> --accept|--changes --note <text>
                                       Prepare a review; it waits for your click in the app

Add --json for machine-readable output. Task ids accept a unique prefix.
Actions run as you, through your open app. Accepting work and approving decisions need a click in the app.`;

async function main() {
  const json = process.argv.includes('--json');
  const argv = process.argv.slice(2).filter(item => item !== '--json');
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0]!)) { console.log(usage); return 0; }
  const reply = await sendCliRequest(pipePath(), { version: cliProtocolVersion, argv, cwd: process.cwd(), tool: process.env.CONSOLE_CONNECT_TOOL });
  if (!reply) { console.error('Open Console Connect to use console-connect.'); return 2; }
  if (!reply.ok) { if (json) console.log(JSON.stringify({ error: reply.error })); else console.error(reply.error); return 1; }
  console.log(json ? JSON.stringify(reply.data, null, 2) : reply.text);
  return 0;
}

main().then(code => { process.exitCode = code; }, error => { console.error((error as Error).message); process.exitCode = 1; });
