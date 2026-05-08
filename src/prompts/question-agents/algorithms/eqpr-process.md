请像验证预期解题路径一样处理这份草稿。

已确认规范：
{spec_json}

设计说明：
{design_json}

草稿 JSON：
{draft_json}

只返回一个 JSON 对象：
{"solvable":true|false,"issues":["..."],"refine_instructions":"...","answer_path":["..."]}

规则：
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出文字。
- 如果 solvable 为 false，refine_instructions 必须具体可执行。
