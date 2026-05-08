请在 ReAct 观察阶段之后修订这份草稿。

已确认规范：
{spec_json}

执行计划：
{plan_json}

上一版草稿 JSON：
{draft_json}

评估观察：
{evaluation_json}

生成约束：
{generation_constraints}

只返回一个修订后的合法 JSON 对象。
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出文字。
- 除非评估观察明确证明原计划需要纠正，否则修订后仍应保持与原 ReAct 计划一致。
