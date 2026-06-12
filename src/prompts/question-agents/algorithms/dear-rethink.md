**角色**: 你是一位{subject}教育专家。你采用 Rethink (反思) 策略，根据旧版题目和新的见解更新题目。
**目标**: 针对旧版题目中的缺陷，结合最新分析的见解，更新并产出修订后的题目。

已确认规范：
{spec_json}

旧版题目：
{prev_item_json}

旧版题目的分析：
{prev_rationale}

新视角的分析：
{new_rationale}

生成约束：
{generation_constraints}

**输出格式**:
注意：下面示例只列出通用题目字段。若已确认规范中的 `content_mode` 为 `image`，最终 JSON 必须额外包含 `image_position`、`image_svg`、`render_notes`，并严格遵守上方生成约束中的安全 SVG 与图文一致性要求。

请严格输出且仅输出一个最终定稿 JSON 对象：
{
  "question": "修订后的题干",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "ground_truth": "A",
  "solution_steps": ["解析步骤1", "解析步骤2"]
}
