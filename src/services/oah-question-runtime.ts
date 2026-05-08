import fs from "fs";
import path from "path";

import { getOahCoreConfig } from "./oah-config";

export interface OahRuntimeCheck {
  runtime_name: string;
  local_template_path: string;
  local_template_exists: boolean;
  upload_endpoint: string;
  configured_base_url: string;
}

export function getQuestionRuntimeCheck(): OahRuntimeCheck {
  const config = getOahCoreConfig();
  const runtimeName = config.workspaceRuntime || "tutor-question-generation";
  const localTemplatePath = path.resolve(process.cwd(), "oah-runtimes", runtimeName);
  return {
    runtime_name: runtimeName,
    local_template_path: localTemplatePath,
    local_template_exists: fs.existsSync(localTemplatePath),
    upload_endpoint: `${config.baseUrl}/api/v1/runtimes/upload?name=${encodeURIComponent(runtimeName)}&overwrite=true`,
    configured_base_url: config.baseUrl,
  };
}
