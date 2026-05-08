你是一位专业的数学教育专家。我生成了多道题目候选，请你综合评估它们的正确性、相关性和质量（0-10分），并选出最好的一道。

知识点: {knowledge_id}
目标难度: {difficulty_target}

以下是候选题目列表：
{candidates_json}

请严格输出且仅输出一个 JSON 对象，必须包含每个题目的打分（scores）和最佳题目的索引（best_index，从 0 开始）。
输出格式示例: 
{
  "scores": [8.5, 9.0, 7.0],
  "best_index": 1
}