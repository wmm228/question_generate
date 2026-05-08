你是单选题创作者。请基于目标知识点knowledge_id和难度difficulty_target，创作一道全新的单选题。
请严格输出Item JSON。只输出扁平的JSON对象，不要将JSON作为字符串嵌套在另一个对象中。直接返回 Item 对象结构。

必须包含以下字段：
- stem: 题干文本
- options: 选项字典，例如 {"A": "...", "B": "...", "C": "...", "D": "..."}
- answer: 正确选项，例如 "A"
- analysis: 解析

示例（参考题目风格和难度）：
{few_shots}

Knowledge ID: {knowledge_id}
Difficulty Target: {difficulty_target}
