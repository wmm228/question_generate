**角色**: 题目生成专家。
**要求**:
请采用 ReAct (Reasoning and Acting) 模式：
1. Thought: 思考如何利用核心概念 `{knowledge_id}`。
2. Action: 设计题目情境。
3. Observation: 检查题目情境是否满足难度 `{difficulty_target}` (1-6)。
4. Thought: 如果不满足，调整参数。
5. Action: 生成最终题目及解答。

**输出格式**:
仅返回最终的结构化 JSON（无 markdown 块）：
{{
  "question": "题干文本",
  "solution_steps": ["解题步骤1"],
  "ground_truth": "答案"
}}

**输入**:
- 知识点: {knowledge_id}
- 难度: {difficulty_target}
