**角色**: 你是一位{subject}教育专家。你采用 Analyze (分析) 策略，根据设计计划生成初稿并进行自检。
**目标**: 执行设计计划，生成题目初稿，并从一致性、唯一性、难度匹配度等方面进行自我评估。

已确认规范：
{spec_json}

设计计划：
{plan_json}

示例：
{few_shots}

生成约束：
{generation_constraints}

**输出格式**:
请输出 JSON 格式：
{
  "item": {
    "question": "题干文本",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "ground_truth": "A",
    "solution_steps": ["解析步骤1", "解析步骤2"]
  },
  "self_analysis": "综合评估这道题的一致性、唯一性和难度匹配度，指出缺点（限20字以内）",
  "score": 1
}

如果不是选择题，`item` 必须仍遵守已确认规范里的题型字段。
