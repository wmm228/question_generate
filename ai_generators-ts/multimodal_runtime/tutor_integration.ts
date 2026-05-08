import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import {
  type AiGenerateResponse,
  type AiGenerateStructuredContent,
  type AiGenerateStructuredImageAsset,
  type AiGenerateVisualPipelineMeta,
  type AiGenImagePlacementOrEmpty,
  type AiGenImageTarget,
  type AiGenPayload,
} from "../../src/types/ai-generate";
import { logEvent } from "../../src/utils/request";
import { getAiGeneratorsConfig } from "../config";

const OPTION_KEYS = ["A", "B", "C", "D"] as const;
const DEFAULT_IMAGE_IRT_MODEL = getAiGeneratorsConfig().model || "platform/kimi-k25";
const DEFAULT_MANIM_COMMAND = "manim";
const DEFAULT_SCENE_NAME = "QuestionScene";
const OUTPUT_ROOT = path.resolve(process.cwd(), "output", "ai-generated-visuals");

type OptionKey = (typeof OPTION_KEYS)[number];

export interface ImageQuestionRenderInput {
  payload: AiGenPayload;
  requestId: string;
  imagePosition: AiGenImagePlacementOrEmpty;
  sceneName: string;
  imageCode: string;
}

interface ImageIrtConfig {
  provider: "oah";
  method: "irt";
  model: string;
  input_mode: "multimodal";
  enabled: boolean;
}

interface ManimRenderResult {
  imageUrl: string;
  imagePath: string;
  sceneCodePath: string;
  mediaDir: string;
  renderCommand: string[];
  renderStdout: string;
  renderStderr: string;
}

function safeRequestSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 96);
  return sanitized || `${Date.now()}`;
}

function normalizeSceneName(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : DEFAULT_SCENE_NAME;
}

function getManimCommand(): string {
  return (process.env.MANIM_COMMAND || process.env.OAH_MANIM_COMMAND || DEFAULT_MANIM_COMMAND).trim();
}

function getImageIrtConfig(): ImageIrtConfig {
  return {
    provider: "oah",
    method: "irt",
    model: (process.env.OAH_IMAGE_IRT_MODEL_NAME || DEFAULT_IMAGE_IRT_MODEL).trim(),
    input_mode: "multimodal",
    enabled: (process.env.OAH_IMAGE_IRT_ENABLED || "false").trim().toLowerCase() === "true",
  };
}

function buildImageUrl(imagePath: string): string {
  const imageBytes = fs.readFileSync(imagePath);
  return `data:image/png;base64,${imageBytes.toString("base64")}`;
}

function findRenderedPng(mediaDir: string, sceneName: string): string | null {
  if (!fs.existsSync(mediaDir)) {
    return null;
  }

  const candidates: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        candidates.push(fullPath);
      }
    }
  };
  visit(mediaDir);

  const exact = candidates.find((candidate) => path.basename(candidate) === `${sceneName}.png`);
  return exact || candidates.sort((left, right) => left.length - right.length)[0] || null;
}

function validateImageCode(sceneName: string, imageCode: string): void {
  if (!imageCode.trim()) {
    throw new Error("Image question is missing image_code");
  }
  if (!imageCode.includes("from manim import")) {
    throw new Error("image_code must import from manim");
  }
  if (!imageCode.includes(`class ${sceneName}(`)) {
    throw new Error(`image_code must define class ${sceneName}`);
  }
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code !== 0) {
        reject(new Error(`Manim render failed with exit code ${code}.\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function normalizeImagePosition(
  imagePosition: string | undefined,
  fallbackTargets: AiGenImageTarget[],
): AiGenImagePlacementOrEmpty {
  if (imagePosition === "stem_image" || imagePosition === "explanation_image" || imagePosition === "option_image") {
    return imagePosition;
  }
  if (fallbackTargets.includes("options")) {
    return "option_image";
  }
  if (fallbackTargets.includes("solution")) {
    return "explanation_image";
  }
  if (fallbackTargets.includes("stem")) {
    return "stem_image";
  }
  return "";
}

export function placementToImageTargets(imagePosition: AiGenImagePlacementOrEmpty): AiGenImageTarget[] {
  if (imagePosition === "option_image") {
    return ["options"];
  }
  if (imagePosition === "explanation_image") {
    return ["solution"];
  }
  if (imagePosition === "stem_image") {
    return ["stem"];
  }
  return [];
}

export async function renderManimImageForQuestion(input: ImageQuestionRenderInput): Promise<Record<string, unknown>> {
  const sceneName = normalizeSceneName(input.sceneName);
  validateImageCode(sceneName, input.imageCode);

  const outputDir = path.join(OUTPUT_ROOT, safeRequestSegment(input.requestId));
  const sceneCodePath = path.join(outputDir, "question_scene.py");
  const imagePath = path.join(outputDir, "question.png");
  const mediaDir = path.join(outputDir, "manim_media");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(sceneCodePath, input.imageCode, "utf-8");
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  const renderCommand = [
    "-qk",
    "-s",
    sceneCodePath,
    sceneName,
    "--media_dir",
    mediaDir,
  ];

  logEvent("info", null, "ai_generate.visual.manim.request", {
    request_uuid: input.requestId,
    renderer: "manim",
    scene_name: sceneName,
    scene_code_path: sceneCodePath,
    command: [getManimCommand(), ...renderCommand],
  });

  const completed = await runCommand(getManimCommand(), renderCommand, outputDir);
  const renderedPng = findRenderedPng(mediaDir, sceneName);
  if (!renderedPng) {
    throw new Error(`Manim render completed but no PNG was found under ${mediaDir}`);
  }
  fs.copyFileSync(renderedPng, imagePath);

  const renderResult: ManimRenderResult = {
    imageUrl: buildImageUrl(imagePath),
    imagePath,
    sceneCodePath,
    mediaDir,
    renderCommand: [getManimCommand(), ...renderCommand],
    renderStdout: completed.stdout,
    renderStderr: completed.stderr,
  };

  logEvent("info", null, "ai_generate.visual.manim.responded", {
    request_uuid: input.requestId,
    renderer: "manim",
    image_path: renderResult.imagePath,
    scene_code_path: renderResult.sceneCodePath,
  });

  const stemImage = input.imagePosition === "stem_image" ? renderResult.imageUrl : null;
  const explanationImage = input.imagePosition === "explanation_image" ? renderResult.imageUrl : null;
  const optionImages = input.imagePosition === "option_image" && input.payload.question_type === "multiple_choice"
    ? Object.fromEntries(OPTION_KEYS.map((key) => [key, renderResult.imageUrl]))
    : input.payload.question_type === "multiple_choice"
      ? Object.fromEntries(OPTION_KEYS.map((key) => [key, null]))
      : {};

  const visualPipeline: AiGenerateVisualPipelineMeta & Record<string, unknown> = {
    requested: true,
    image_mode: input.payload.image_mode,
    image_targets: placementToImageTargets(input.imagePosition),
    status: "completed",
    provider: "oah_manim",
    stage: "rendered",
    algorithm: input.payload.algorithm,
    difficulty: input.payload.difficulty,
    renderer: "manim_static_png",
    image_position: input.imagePosition,
    image_code: input.imageCode,
    scene_name: sceneName,
    scene_code_path: renderResult.sceneCodePath,
    image_path: renderResult.imagePath,
    media_dir: renderResult.mediaDir,
    render_command: renderResult.renderCommand,
    image_irt: getImageIrtConfig(),
  };

  return {
    stem_image: stemImage,
    explanation_image: explanationImage,
    option_images: optionImages,
    visual_pipeline: visualPipeline,
    image_generation_failed: false,
  };
}

export function buildFailedVisualResponse(payload: AiGenPayload, imagePosition: AiGenImagePlacementOrEmpty, reason: string): Record<string, unknown> {
  const visualPipeline: AiGenerateVisualPipelineMeta & Record<string, unknown> = {
    requested: true,
    image_mode: payload.image_mode,
    image_targets: placementToImageTargets(imagePosition),
    status: "failed",
    provider: "oah_manim",
    stage: "failed",
    algorithm: payload.algorithm,
    difficulty: payload.difficulty,
    renderer: "manim_static_png",
    image_position: imagePosition,
    image_irt: getImageIrtConfig(),
  };

  return {
    stem_image: null,
    explanation_image: null,
    option_images: payload.question_type === "multiple_choice"
      ? Object.fromEntries(OPTION_KEYS.map((key) => [key, null]))
      : {},
    visual_pipeline: visualPipeline,
    image_generation_failed: true,
    visual_pipeline_error: reason,
  };
}

function attachImageToStructuredContent(
  content: AiGenerateStructuredContent,
  target: AiGenImageTarget,
  imageAsset: AiGenerateStructuredImageAsset,
): AiGenerateStructuredContent {
  if (target === "stem") {
    return {
      ...content,
      stem: {
        ...content.stem,
        image: imageAsset,
      },
    };
  }

  if (target === "solution") {
    return {
      ...content,
      solution: {
        ...content.solution,
        image: imageAsset,
      },
    };
  }

  return {
    ...content,
    options: content.options.map((option) => ({
      ...option,
      image: option.key && OPTION_KEYS.includes(option.key as OptionKey)
        ? {
            role: "option",
            label: `Option ${option.key} visual`,
            url: imageAsset.url,
            option_key: option.key as OptionKey,
          }
        : option.image,
    })),
  };
}

export function mergeVisualResultIntoResponse(
  response: AiGenerateResponse,
  visualResult: Record<string, unknown>,
): AiGenerateResponse {
  const stemImage = typeof visualResult.stem_image === "string" ? visualResult.stem_image : null;
  const explanationImage = typeof visualResult.explanation_image === "string" ? visualResult.explanation_image : null;
  const optionImages = visualResult.option_images && typeof visualResult.option_images === "object"
    ? visualResult.option_images as Partial<Record<OptionKey, string | null>>
    : {};

  let content = response.content;
  if (stemImage) {
    content = attachImageToStructuredContent(content, "stem", { role: "stem", label: "Stem visual", url: stemImage });
  }
  if (explanationImage) {
    content = attachImageToStructuredContent(content, "solution", { role: "solution", label: "Solution visual", url: explanationImage });
  }
  if (Object.values(optionImages).some((value) => typeof value === "string" && value)) {
    content = {
      ...content,
      options: content.options.map((option) => ({
        ...option,
        image: option.key && OPTION_KEYS.includes(option.key as OptionKey) && optionImages[option.key as OptionKey]
          ? { role: "option", option_key: option.key as OptionKey, label: `Option ${option.key} visual`, url: optionImages[option.key as OptionKey] || null }
          : option.image,
      })),
    };
  }

  return {
    ...response,
    content,
    assets: {
      stem_image: stemImage,
      explanation_image: explanationImage,
      option_images: optionImages,
    },
    visual_pipeline: visualResult.visual_pipeline && typeof visualResult.visual_pipeline === "object"
      ? visualResult.visual_pipeline as AiGenerateVisualPipelineMeta
      : response.visual_pipeline,
    ...(visualResult.image_generation_failed === true ? { image_generation_failed: true } : { image_generation_failed: undefined }),
  };
}
