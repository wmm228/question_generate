请为已确认规范生成一份隐藏推理计划。

已确认规范：
{spec_json}

基础算法指导：
{algorithm_constraints}

只返回一个 JSON 对象：
{"reasoning_outline":["..."],"difficulty_controls":["..."],"answerability_checks":["..."],"draft_focus":"..."}

规则：
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出文字。
- reasoning_outline 应描述生成器内部应遵循的推理顺序。
- difficulty_controls 应说明如何稳定在目标难度。
- answerability_checks 应避免出现歧义题或无解题。
