export interface RuntimeContentPart {
  type: "text" | "image";
  content: string;
}

export type RuntimeTextInput = string | string[];
export type RuntimeImageInput = string | string[];

function toStringList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

export function prepareTextInputs(texts: RuntimeTextInput): RuntimeContentPart[] {
  return toStringList(texts)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ type: "text" as const, content: text }));
}

export function prepareTextImageInputs(
  texts: RuntimeTextInput,
  images: RuntimeImageInput,
): RuntimeContentPart[] {
  const textInputs = prepareTextInputs(texts);
  const imageInputs = toStringList(images)
    .map((image) => image.trim())
    .filter(Boolean)
    .map((image) => ({ type: "image" as const, content: image }));

  return [...textInputs, ...imageInputs];
}

export function extractCode(text: string): string {
  const marker = "```python\n";
  const startIndex = text.lastIndexOf(marker);
  if (startIndex < 0) {
    return text.trim();
  }

  const codeStart = startIndex + marker.length;
  const endIndex = text.indexOf("```", codeStart);
  if (endIndex < 0) {
    return text.slice(codeStart).trim();
  }

  return text.slice(codeStart, endIndex).trim();
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) {
      throw new Error("Failed to extract JSON payload");
    }
    return JSON.parse(match[1]);
  }
}
