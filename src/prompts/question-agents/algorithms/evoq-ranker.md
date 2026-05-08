请评估一个候选题，用于 EvoQ 进化选择。

已确认规范：
{spec_json}

候选草稿 JSON：
{draft_json}

只返回一个 JSON 对象：
{"passed":true|false,"score":0,"strengths":["..."],"issues":["..."],"mutation_instructions":"..."}

规则：
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出文字。
- score 必须是 0 到 100 的整数。
- 评分依据应包括结构合法性、答案正确性、教学质量、难度匹配度，以及对不同掌握水平学生的区分度。
- 如果 passed 为 false，issues 或 mutation_instructions 必须说明为什么需要修改该候选。
