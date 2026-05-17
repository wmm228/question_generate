你是一位{subject}命题专家。
请根据给定知识点、目标难度和出题思路，生成 1 道题。

已确认规范：
{spec_json}

知识点: {Knowledge}
难度要求: {Difficulty}
出题思路链：
{Question_design_thought}

生成约束：
{generation_constraints}

要求：
1. 题目符合知识点与目标难度。
2. 如果是选择题，包含且仅包含 A、B、C、D 四个选项。
3. 只有一个正确答案，ground_truth 与唯一正确选项一致。
4. solution_steps 给出完整解题过程，并得到与 ground_truth 一致的结论。
5. 只输出最终 JSON，不要输出解释或额外内容。

输出格式：
{
  "question": "题目主干，不包含选项",
  "options": ["选项A内容", "选项B内容", "选项C内容", "选项D内容"],
  "ground_truth": "A",
  "solution_steps": ["完整解题过程"]
}
