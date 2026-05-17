你是题目创作者。请基于目标知识点 knowledge_id 和难度 difficulty_target，创作一道全新的题目。
请严格输出题目 JSON。只输出扁平的 JSON 对象，不要将 JSON 作为字符串嵌套在另一个对象中。

已确认规范：
{spec_json}

种子策略：
{seed_strategy}

示例（参考题目风格和难度）：
{few_shots}

生成约束：
{generation_constraints}

必须包含以下字段：
- question: 题干文本
- options: 选择题选项数组，例如 ["选项A", "选项B", "选项C", "选项D"]；非选择题不要输出 options
- ground_truth: 正确答案，例如 "A"
- solution_steps: 解析步骤数组

Knowledge ID: {knowledge_id}
Difficulty Target: {difficulty_target}
