import { generateAiQuestion } from "../src/services/ai-generate";
import {
  normalizeAiGenPayload,
  validateAiGenPayload,
  type AiGenPayload,
} from "../src/types/ai-generate";

interface CliArgs {
  subject: string;
  kp: string;
  diff: string;
  questionType: string;
  contentMode: string;
  imagePlacement: string;
}

function parseArgValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0) {
    return "";
  }
  return args[index + 1] ?? "";
}

function parseCliArgs(argv: string[]): CliArgs {
  return {
    subject: parseArgValue(argv, "--subject") || "数学",
    kp: parseArgValue(argv, "--kp"),
    diff: parseArgValue(argv, "--diff"),
    questionType: parseArgValue(argv, "--question-type") || "multiple_choice",
    contentMode: parseArgValue(argv, "--content-mode") || "text",
    imagePlacement: parseArgValue(argv, "--image-placement") || "",
  };
}

function buildPayload(algorithm: AiGenPayload["algorithm"], cliArgs: CliArgs): AiGenPayload {
  const payload = normalizeAiGenPayload({
    subject: cliArgs.subject,
    knowledge_point: cliArgs.kp,
    difficulty: cliArgs.diff,
    algorithm,
    question_type: cliArgs.questionType,
    content_mode: cliArgs.contentMode,
    image_placement: cliArgs.imagePlacement,
  });

  const validationError = validateAiGenPayload(payload);
  if (validationError) {
    throw new Error(validationError);
  }

  return payload;
}

export async function runAiGeneratorCli(algorithm: AiGenPayload["algorithm"], argv: string[]): Promise<void> {
  const cliArgs = parseCliArgs(argv);
  const payload = buildPayload(algorithm, cliArgs);
  const requestId = process.env.REQUEST_UUID?.trim() || `ai-gen-cli-${Date.now()}`;
  const result = await generateAiQuestion(payload, requestId);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
