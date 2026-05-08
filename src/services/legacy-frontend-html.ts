import fs from "fs";
import path from "path";
import vm from "vm";

export interface RenderLegacyTutorHtmlInput {
  staticDirectory: string;
  workspaceRoot: string;
}

const LEGACY_SERVER_PATH = path.join("tutor-tutor_before", "tutor", "src", "server.ts");
const GET_HTML_START = "function getHTML(): string {";
const GET_HTML_END = "\nconst PORT =";

function readLegacyServerSource(workspaceRoot: string): string {
  const sourcePath = path.join(workspaceRoot, LEGACY_SERVER_PATH);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`legacy tutor frontend source not found: ${sourcePath}`);
  }
  return fs.readFileSync(sourcePath, "utf-8");
}

function extractLegacyGetHtmlSource(serverSource: string): string {
  const start = serverSource.indexOf(GET_HTML_START);
  const end = serverSource.indexOf(GET_HTML_END, start);
  if (start < 0 || end < 0) {
    throw new Error("legacy getHTML() block not found");
  }
  return serverSource.slice(start, end);
}

function sanitizeLegacyTypeScript(source: string): string {
  return source
    .replace("function getHTML(): string {", "function getHTML() {")
    .replace("(file: string, mime = 'image/png')", "(file, mime = 'image/png')");
}

function injectAiQuestionButton(html: string): string {
  const triggerPattern = /(<button class="btn btn-primary" onclick="findSimilar\('kp'\)">[^<]*<\/button>)/;
  if (!triggerPattern.test(html)) {
    return html;
  }
  return html.replace(
    triggerPattern,
    `$1
          <button class="btn btn-secondary" onclick="window.location.href='/question-agent-workbench'">AI出题</button>`,
  );
}

export function renderLegacyTutorHtml(input: RenderLegacyTutorHtmlInput): string {
  const serverSource = readLegacyServerSource(input.workspaceRoot);
  const extractedSource = extractLegacyGetHtmlSource(serverSource);
  const executableSource = sanitizeLegacyTypeScript(extractedSource);

  const fakeDirname = path.join(input.staticDirectory, "..", "dist");
  const context = {
    fs,
    path,
    __dirname: fakeDirname,
    __renderedHtml: "",
  };
  vm.createContext(context);
  const script = new vm.Script(`${executableSource}\n__renderedHtml = getHTML();`);
  script.runInContext(context);

  const rendered = context.__renderedHtml;
  if (typeof rendered !== "string" || !rendered.includes("<!DOCTYPE html>")) {
    throw new Error("legacy tutor frontend render returned invalid html");
  }
  return injectAiQuestionButton(rendered);
}
