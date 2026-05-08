请为已确认规范规划一个 ReAct 风格的生成循环。

已确认规范：
{spec_json}

基础算法指导：
{algorithm_constraints}

只返回一个 JSON 对象：
{"scenario":"...","action_steps":["..."],"observation_checks":["..."],"difficulty_adjustment":"...","final_focus":"..."}

规则：
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出文字。
- observation_checks 必须聚焦于草稿写出后要检查什么。
