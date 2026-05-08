import fs from "fs";
import path from "path";

import { getAiGeneratorsConfig } from "../config";

export interface RuntimeConfigData {
  models: {
    default: string;
    temperature: number;
    print_cost: boolean;
    verbose: boolean;
  };
  generation: {
    output_dir: string;
    max_retries: number;
    language: string;
    subject: string;
    difficulty: string;
    question_type: string;
    visual_mode: string;
    num_variants: number;
    include_explanation: boolean;
    include_knowledge_points: boolean;
    require_visual_phrase: boolean;
    visual_dependency_retry_limit: number;
    enable_evaluation: boolean;
    evaluation_scale: string;
  };
  provider: {
    oah_base_url: string | null;
    request_log_dir: string;
  };
  image_irt: {
    provider: "oah";
    method: "irt";
    model: string;
    input_mode: "multimodal";
    enabled: boolean;
  };
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "runtime_config.json");

const BUILTIN_DEFAULTS: RuntimeConfigData = {
  models: {
    default: getAiGeneratorsConfig().model,
    temperature: 0.7,
    print_cost: true,
    verbose: false,
  },
  generation: {
    output_dir: "output",
    max_retries: 2,
    language: "zh",
    subject: "general",
    difficulty: "medium",
    question_type: "auto",
    visual_mode: "optional",
    num_variants: 1,
    include_explanation: true,
    include_knowledge_points: true,
    require_visual_phrase: true,
    visual_dependency_retry_limit: 2,
    enable_evaluation: true,
    evaluation_scale: "1_to_5",
  },
  provider: {
    oah_base_url: null,
    request_log_dir: "logs/oah_requests",
  },
  image_irt: {
    provider: "oah",
    method: "irt",
    model: "kimi2.6",
    input_mode: "multimodal",
    enabled: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function deepMergeRuntimeConfig(base: RuntimeConfigData, override: Record<string, unknown>): RuntimeConfigData {
  return {
    models: isRecord(override.models)
      ? {
          default: readNonEmptyString(override.models.default, base.models.default),
          temperature: typeof override.models.temperature === "number" ? override.models.temperature : base.models.temperature,
          print_cost: typeof override.models.print_cost === "boolean" ? override.models.print_cost : base.models.print_cost,
          verbose: typeof override.models.verbose === "boolean" ? override.models.verbose : base.models.verbose,
        }
      : { ...base.models },
    generation: isRecord(override.generation)
      ? {
          output_dir: typeof override.generation.output_dir === "string" ? override.generation.output_dir : base.generation.output_dir,
          max_retries: typeof override.generation.max_retries === "number" ? override.generation.max_retries : base.generation.max_retries,
          language: typeof override.generation.language === "string" ? override.generation.language : base.generation.language,
          subject: typeof override.generation.subject === "string" ? override.generation.subject : base.generation.subject,
          difficulty: typeof override.generation.difficulty === "string" ? override.generation.difficulty : base.generation.difficulty,
          question_type: typeof override.generation.question_type === "string" ? override.generation.question_type : base.generation.question_type,
          visual_mode: typeof override.generation.visual_mode === "string" ? override.generation.visual_mode : base.generation.visual_mode,
          num_variants: typeof override.generation.num_variants === "number" ? override.generation.num_variants : base.generation.num_variants,
          include_explanation:
            typeof override.generation.include_explanation === "boolean"
              ? override.generation.include_explanation
              : base.generation.include_explanation,
          include_knowledge_points:
            typeof override.generation.include_knowledge_points === "boolean"
              ? override.generation.include_knowledge_points
              : base.generation.include_knowledge_points,
          require_visual_phrase:
            typeof override.generation.require_visual_phrase === "boolean"
              ? override.generation.require_visual_phrase
              : base.generation.require_visual_phrase,
          visual_dependency_retry_limit:
            typeof override.generation.visual_dependency_retry_limit === "number"
              ? override.generation.visual_dependency_retry_limit
              : base.generation.visual_dependency_retry_limit,
          enable_evaluation:
            typeof override.generation.enable_evaluation === "boolean"
              ? override.generation.enable_evaluation
              : base.generation.enable_evaluation,
          evaluation_scale:
            typeof override.generation.evaluation_scale === "string"
              ? override.generation.evaluation_scale
              : base.generation.evaluation_scale,
        }
      : { ...base.generation },
    provider: isRecord(override.provider)
      ? {
          oah_base_url:
            typeof override.provider.oah_base_url === "string" || override.provider.oah_base_url === null
              ? override.provider.oah_base_url
              : base.provider.oah_base_url,
          request_log_dir:
            typeof override.provider.request_log_dir === "string"
              ? override.provider.request_log_dir
              : base.provider.request_log_dir,
        }
      : { ...base.provider },
    image_irt: isRecord(override.image_irt)
      ? {
          provider: override.image_irt.provider === "oah" ? override.image_irt.provider : base.image_irt.provider,
          method: override.image_irt.method === "irt" ? override.image_irt.method : base.image_irt.method,
          model: readNonEmptyString(override.image_irt.model, base.image_irt.model),
          input_mode:
            override.image_irt.input_mode === "multimodal"
              ? override.image_irt.input_mode
              : base.image_irt.input_mode,
          enabled: typeof override.image_irt.enabled === "boolean" ? override.image_irt.enabled : base.image_irt.enabled,
        }
      : { ...base.image_irt },
  };
}

export class Config {
  private static configPath = DEFAULT_CONFIG_PATH;
  private static configData: RuntimeConfigData | null = null;

  static OUTPUT_DIR = path.resolve(REPO_ROOT, BUILTIN_DEFAULTS.generation.output_dir);
  static DEFAULT_MODEL = BUILTIN_DEFAULTS.models.default;
  static DEFAULT_TEMPERATURE = BUILTIN_DEFAULTS.models.temperature;
  static DEFAULT_PRINT_COST = BUILTIN_DEFAULTS.models.print_cost;
  static DEFAULT_VERBOSE = BUILTIN_DEFAULTS.models.verbose;
  static DEFAULT_MAX_RETRIES = BUILTIN_DEFAULTS.generation.max_retries;
  static DEFAULT_LANGUAGE = BUILTIN_DEFAULTS.generation.language;
  static DEFAULT_SUBJECT = BUILTIN_DEFAULTS.generation.subject;
  static DEFAULT_DIFFICULTY = BUILTIN_DEFAULTS.generation.difficulty;
  static DEFAULT_QUESTION_TYPE = BUILTIN_DEFAULTS.generation.question_type;
  static DEFAULT_VISUAL_MODE = BUILTIN_DEFAULTS.generation.visual_mode;
  static DEFAULT_NUM_VARIANTS = BUILTIN_DEFAULTS.generation.num_variants;
  static DEFAULT_INCLUDE_EXPLANATION = BUILTIN_DEFAULTS.generation.include_explanation;
  static DEFAULT_INCLUDE_KNOWLEDGE_POINTS = BUILTIN_DEFAULTS.generation.include_knowledge_points;
  static DEFAULT_REQUIRE_VISUAL_PHRASE = BUILTIN_DEFAULTS.generation.require_visual_phrase;
  static DEFAULT_VISUAL_DEPENDENCY_RETRY_LIMIT = BUILTIN_DEFAULTS.generation.visual_dependency_retry_limit;
  static DEFAULT_ENABLE_EVALUATION = BUILTIN_DEFAULTS.generation.enable_evaluation;
  static DEFAULT_EVALUATION_SCALE = BUILTIN_DEFAULTS.generation.evaluation_scale;
  static DEFAULT_OAH_BASE_URL = BUILTIN_DEFAULTS.provider.oah_base_url;
  static DEFAULT_REQUEST_LOG_DIR = path.resolve(REPO_ROOT, BUILTIN_DEFAULTS.provider.request_log_dir);
  static DEFAULT_IMAGE_IRT_PROVIDER = BUILTIN_DEFAULTS.image_irt.provider;
  static DEFAULT_IMAGE_IRT_METHOD = BUILTIN_DEFAULTS.image_irt.method;
  static DEFAULT_IMAGE_IRT_MODEL = BUILTIN_DEFAULTS.image_irt.model;
  static DEFAULT_IMAGE_IRT_INPUT_MODE = BUILTIN_DEFAULTS.image_irt.input_mode;
  static DEFAULT_IMAGE_IRT_ENABLED = BUILTIN_DEFAULTS.image_irt.enabled;

  private static resolvePath(configPath?: string): string {
    if (!configPath) {
      return this.configPath;
    }
    return path.isAbsolute(configPath) ? configPath : path.resolve(REPO_ROOT, configPath);
  }

  static load(options?: { configPath?: string; forceReload?: boolean }): RuntimeConfigData {
    const resolvedPath = this.resolvePath(options?.configPath);
    if (this.configData && !options?.forceReload && resolvedPath === this.configPath) {
      return this.configData;
    }

    let data = BUILTIN_DEFAULTS;
    if (fs.existsSync(resolvedPath)) {
      const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as Record<string, unknown>;
      data = deepMergeRuntimeConfig(BUILTIN_DEFAULTS, parsed);
    }

    this.configPath = resolvedPath;
    this.configData = data;
    this.applyRuntimeValues(data);
    return data;
  }

  static reload(configPath?: string): RuntimeConfigData {
    return this.load({ configPath, forceReload: true });
  }

  static path(): string {
    this.load();
    return this.configPath;
  }

  static asDict(): RuntimeConfigData {
    return JSON.parse(JSON.stringify(this.load())) as RuntimeConfigData;
  }

  static get(keyPath: string): unknown {
    const segments = keyPath.split(".");
    let current: unknown = this.load();
    for (const segment of segments) {
      if (!isRecord(current) || !(segment in current)) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  private static applyRuntimeValues(config: RuntimeConfigData): void {
    this.OUTPUT_DIR = path.resolve(REPO_ROOT, config.generation.output_dir || "output");
    this.DEFAULT_MODEL = config.models.default;
    this.DEFAULT_TEMPERATURE = config.models.temperature;
    this.DEFAULT_PRINT_COST = config.models.print_cost;
    this.DEFAULT_VERBOSE = config.models.verbose;
    this.DEFAULT_MAX_RETRIES = config.generation.max_retries;
    this.DEFAULT_LANGUAGE = config.generation.language;
    this.DEFAULT_SUBJECT = config.generation.subject;
    this.DEFAULT_DIFFICULTY = config.generation.difficulty;
    this.DEFAULT_QUESTION_TYPE = config.generation.question_type;
    this.DEFAULT_VISUAL_MODE = config.generation.visual_mode;
    this.DEFAULT_NUM_VARIANTS = config.generation.num_variants;
    this.DEFAULT_INCLUDE_EXPLANATION = config.generation.include_explanation;
    this.DEFAULT_INCLUDE_KNOWLEDGE_POINTS = config.generation.include_knowledge_points;
    this.DEFAULT_REQUIRE_VISUAL_PHRASE = config.generation.require_visual_phrase;
    this.DEFAULT_VISUAL_DEPENDENCY_RETRY_LIMIT = config.generation.visual_dependency_retry_limit;
    this.DEFAULT_ENABLE_EVALUATION = config.generation.enable_evaluation;
    this.DEFAULT_EVALUATION_SCALE = config.generation.evaluation_scale;
    this.DEFAULT_OAH_BASE_URL = config.provider.oah_base_url;
    this.DEFAULT_REQUEST_LOG_DIR = path.resolve(REPO_ROOT, config.provider.request_log_dir || "logs/oah_requests");
    this.DEFAULT_IMAGE_IRT_PROVIDER = config.image_irt.provider;
    this.DEFAULT_IMAGE_IRT_METHOD = config.image_irt.method;
    this.DEFAULT_IMAGE_IRT_MODEL = config.image_irt.model;
    this.DEFAULT_IMAGE_IRT_INPUT_MODE = config.image_irt.input_mode;
    this.DEFAULT_IMAGE_IRT_ENABLED = config.image_irt.enabled;
  }
}

Config.load();
