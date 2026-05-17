你是一位经验丰富的{subject}教育专家。你目前的任务是反思当前的题目设计方案，并一次性给出 {expand_width} 套不同的优化思路，并为每套思路打分。

考察要求：
- 知识点: {knowledge_id}
- 难度要求: {difficulty_target}

当前方案：
{Question_design_thought}

历史轨迹：
{trajectory_thoughts}

已确认规范：
{spec_json}

输出格式（请严格返回如下JSON格式的数组）：
{
  "children": [
    {
      "gradient": "指出当前方案的不足(限20字)",
      "thought": "优化后的出题思路1(限20字内)",
      "score": 评分数字(1-10分)
    },
    {
      "gradient": "指出当前方案的不足(限20字)",
      "thought": "优化后的出题思路2(限20字内)",
      "score": 评分数字(1-10分)
    }
  ]
}
