请根据已经确认的 `edu-question-spec.v1` 评估下面这道试题。

已确认规范：
{spec_json}

生成草稿 JSON：
{draft_json}

检查清单：
{checklist}

只返回一个 JSON 对象：
{"passed":true|false,"quality_gate":{"passed":true|false,"issues":["..."]},"score":0,"fitness":0,"strengths":["..."],"weaknesses":["..."],"issues":["..."],"difficulty_direction":"easier|matched|harder|unclear","revision_instructions":"...","algorithm_feedback":{"summary":"...","mutation_instructions":"...","rethink_instructions":"...","next_action_hint":"..."}}

规则：
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出任何解释性文字。
- 不要在前后添加推理、说明、标签或注释。
- `quality_gate` 是最终质检结论，只负责判断能否放行。
- `algorithm_feedback` 是给算法循环使用的反思反馈，不只是质检；它要说明保留什么、调整什么、下一步怎么走。
- `score` 和 `fitness` 都必须是 0 到 100 的整数；`fitness` 可用于候选排序、路径奖励或变异选择。
- `difficulty_direction` 表示草稿相对目标难度偏易、匹配、偏难或无法判断。
- 如果 `passed` 为 `true`，`issues` 可以是 `[]`，但 `strengths`、`score`、`fitness` 和 `algorithm_feedback.summary` 仍要给出。
- 如果 `passed` 为 `false`，`revision_instructions` 必须明确说明如何在一次修订中修好这份草稿。
- `mutation_instructions` 用于 EvoQ/候选变异，说明应该保留什么、改变什么。
- `rethink_instructions` 用于 DeAR/ReAct/EQPR 的重想或观察，说明应重新审视的概念、解题路径或难度驱动因素。
- `next_action_hint` 给出下一步建议，例如 revise、rethink、mutate、accept。
- 如果草稿只是停留在同一章节或相邻概念，但没有真正考查 `knowledge_point` 指定的精确目标，必须判为不通过。
- 当 `knowledge_point` 指定更窄的子技能、表征方式、性质、任务或场景时，题干或解析必须体现这个目标。
- 必须按 `{subject}` 的学科标准评估术语、情境、解法和答案严谨性；如果 `subject` 为空，就按通用命题标准评估，但不要擅自补写学科。
