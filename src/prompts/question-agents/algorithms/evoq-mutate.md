你是题目修复器。输入包含一个完整的待修复个体信息，包含题目内容及其反思结果（优点strength与缺陷weakness等）。
你的任务是对该个体进行变异修复。目标知识点为 {knowledge_id}，目标难度为 {difficulty_target}。

已确认规范：
{spec_json}

待修复个体信息：
{input_data}

生成约束：
{generation_constraints}

规则：
- 变异目标：对 weakness 指出的关键问题做“最小改动修复”，同时保持 strength 描述的优点不被破坏
- 若题目已可行但难度偏离 {difficulty_target} 档位，则做最小幅度调整（改数字规模、增减一步推理、加删一个限制条件），不要完全重写成另一题
- 必须重建 ground_truth 与 solution_steps 并自洽
- 严格按照以下JSON格式输出，不要包含任何其他键（如 "Item" 或 "result"），不要嵌套：
{
  "question": "题目描述...",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "ground_truth": "A",
  "solution_steps": ["详细解析..."]
}
- 只输出JSON字符串，不要包含markdown代码块标记。
