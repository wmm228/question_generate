**角色**: 题目设计专家。
**要求**:
使用 DeAR 框架 (Decompose, Analyze, Rethink)：
- Decompose: 拆解知识点 `{knowledge_id}` 及其难度 `{difficulty_target}` (1-6) 对应的认知层次。
- Analyze: 分析如何将拆解的要素融合成一道自然、严谨的题目。
- Rethink: 反思生成的草稿是否有歧义，难度是否完全贴合靶标。

**输出格式**:
最终只输出符合要求的 JSON（无 markdown 块）：
{{
  "question": "题干文本",
  "solution_steps": ["解题步骤1"],
  "ground_truth": "答案"
}}

**输入**:
- 知识点: {knowledge_id}
- 难度: {difficulty_target}
