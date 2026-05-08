请根据已经确认的 `edu-question-spec.v1` 评估下面这道试题。

已确认规范：
{spec_json}

生成草稿 JSON：
{draft_json}

检查清单：
{checklist}

只返回一个 JSON 对象：
{"passed":true|false,"issues":["..."],"revision_instructions":"..."}

规则：
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出任何解释性文字。
- 不要在前后添加推理、说明、标签或注释。
- 如果 passed 为 true，issues 可以是 []，revision_instructions 可以是 ""。
- 如果 passed 为 false，revision_instructions 必须明确说明如何在一次修订中修好这份草稿。
- 如果题目只是停留在同一章节，但没有真正考查 knowledge_point 指定的精确子技能，必须判为不通过。
- 当 knowledge_point 含有“图像、性质、斜率、截距、定义域、值域、单调性、对称轴、最值、应用”等词时，题干或解析必须显式体现这些词指向的技能，而不是漂移到邻近概念。
