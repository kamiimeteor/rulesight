import { parseArgs } from "node:util";

export function parseCli(usage: string): { sessionId: string; projectsDir: string | undefined } {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "projects-dir": { type: "string" } } });
  const [sessionId] = positionals;
  if (sessionId === undefined || positionals.length > 1) {
    console.error(`用法：${usage}`);
    process.exit(2);
  }
  return { sessionId, projectsDir: values["projects-dir"] };
}
