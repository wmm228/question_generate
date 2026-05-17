import fs from "fs";
import path from "path";
import { createHash } from "crypto";

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

const OPTION_KEYS = ["A", "B", "C", "D"] as const;
const OUTPUT_ROOT = path.resolve(process.cwd(), "output", "ai-generated-visuals");
const MAX_SVG_BYTES = 200_000;

type OptionKey = (typeof OPTION_KEYS)[number];

export interface ImageQuestionRenderInput {
  payload: AiGenPayload;
  requestId: string;
  imagePosition: AiGenImagePlacementOrEmpty;
  imageSvg: string;
}

interface SvgRenderResult {
  imageUrl: string;
  imagePath: string;
}

function safeRequestSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
  if (!sanitized) {
    return `${Date.now()}`;
  }
  if (sanitized.length <= 96) {
    return sanitized;
  }
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${sanitized.slice(0, 79)}-${digest}`;
}

function buildImageUrl(imagePath: string): string {
  const relativePath = path.relative(process.cwd(), imagePath);
  const encodedPath = relativePath
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/${encodedPath}`;
}

function stripSvgFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:svg|xml)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function validateAndNormalizeSvg(value: string): string {
  let svg = stripSvgFence(value);
  const svgStart = svg.search(/<svg[\s>]/i);
  if (svgStart < 0) {
    throw new Error("Image question is missing image_svg");
  }
  svg = svg.slice(svgStart).trim();
  const svgEnd = svg.toLowerCase().lastIndexOf("</svg>");
  if (svgEnd < 0) {
    throw new Error("image_svg must be a complete SVG document");
  }
  svg = svg.slice(0, svgEnd + "</svg>".length).trim();

  if (Buffer.byteLength(svg, "utf-8") > MAX_SVG_BYTES) {
    throw new Error("image_svg is too large");
  }
  if (!/^<svg[\s>]/i.test(svg)) {
    throw new Error("image_svg must start with an <svg> root element");
  }
  if (/<\s*!doctype|<\s*!entity|<\?xml-stylesheet/i.test(svg)) {
    throw new Error("image_svg must not include external document declarations");
  }
  if (/<\s*\/?\s*(?:script|foreignObject|iframe|object|embed|audio|video|image|link|meta|style|animate|set)\b/i.test(svg)) {
    throw new Error("image_svg contains an unsupported SVG element");
  }
  if (/\s(?:on[a-z]+|href|xlink:href|src)\s*=/i.test(svg)) {
    throw new Error("image_svg contains an unsafe attribute");
  }
  if (/javascript:|data:text\/html|url\s*\(/i.test(svg)) {
    throw new Error("image_svg contains an unsafe reference");
  }

  if (!/^<svg\b[^>]*\sxmlns=/i.test(svg)) {
    svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
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

export async function renderSvgImageForQuestion(input: ImageQuestionRenderInput): Promise<Record<string, unknown>> {
  const imageSvg = validateAndNormalizeSvg(input.imageSvg);
  const outputDir = path.join(OUTPUT_ROOT, safeRequestSegment(input.requestId));
  const imagePath = path.join(outputDir, "question.svg");
  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.writeFile(imagePath, imageSvg, "utf-8");

  const renderResult: SvgRenderResult = {
    imageUrl: buildImageUrl(imagePath),
    imagePath,
  };

  logEvent("info", null, "ai_generate.visual.svg.responded", {
    request_uuid: input.requestId,
    renderer: "safe_svg",
    image_path: renderResult.imagePath,
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
    provider: "safe_svg",
    stage: "rendered",
    algorithm: input.payload.algorithm,
    difficulty: input.payload.difficulty,
    renderer: "safe_svg",
    image_position: input.imagePosition,
    image_svg_path: renderResult.imagePath,
    image_url: renderResult.imageUrl,
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
    provider: "safe_svg",
    stage: "failed",
    algorithm: payload.algorithm,
    difficulty: payload.difficulty,
    renderer: "safe_svg",
    image_position: imagePosition,
    error: reason,
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
