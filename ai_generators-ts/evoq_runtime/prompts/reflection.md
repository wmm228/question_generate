你是极其严苛且专业的数学教育测评专家。你的任务是对生成的一道数学单选题进行【终极综合评估】。你需要结合系统已经测出的**客观真实难度（IRT/RankLLM）**，对该题目进行质量打分、盲测对比（WinRate）以及诊断反思。

目标知识点 (Knowledge ID): {{knowledge_id}}
目标难度等级 (Target Difficulty): {{difficulty_target}}

【客观难度测定报告 (来自虚拟学生系统)】
{{external_difficulty_eval}}

【参考原题（真值示例）- 题目A】
这道题是该知识点下的标准高质量题目，请将其作为考核内容、深度和严谨性的绝对基准：
{{orig_item_json}}

【待评估题目 - 题目B】
这是由大模型生成的待评估题目：
{{item_json}}

请以极其挑剔的眼光，严格执行以下任务：
1. **基础质量打分**：评估B题的“可解性 (solvable)”、“自洽性 (answer_consistent)”以及与参考原题的“相关度 (relevance_score)”。
2. **胜率盲测 (WinRate)**：将B题与A题进行全方位对比，如果B题在科学性、知识点深度和干扰项设计上没有达到或超越A题的水平，必须判定A胜。
3. **诊断与反思 (Reflection)**：结合【客观难度测定报告】中指出的难度偏离情况，以及你发现的基础质量瑕疵，给出这道题的优点（strength）和致命缺点及修改建议（weakness）。

请**严格且仅输出**以下JSON格式（不得包含任何多余的Markdown标记或解释文字）：
{
  "solvable": 1, 
  "relevance_score": 0.95,
  "answer_consistent": 1,
  "winner": "A或者B或者Tie",
  "strength": "指出B题最值得保留的一个优点(限20字内)",
  "weakness": "结合客观难度测定报告，指出B题最关键的缺陷并给出最小修复建议(限50字内)"
}
