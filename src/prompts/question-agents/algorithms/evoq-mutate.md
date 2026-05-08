请基于父代候选生成一个变异子代。

已确认规范：
{spec_json}

父代 A 候选 JSON：
{parent_a_json}

父代 A 评审摘要：
{parent_a_summary}

父代 B 候选 JSON：
{parent_b_json}

父代 B 评审摘要：
{parent_b_summary}

变异目标：
{mutation_goal}

生成约束：
{generation_constraints}

只返回子代试题草稿对应的一个合法 JSON 对象。
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出文字。
- 要保留父代最强的优点，同时修复主要缺陷。
