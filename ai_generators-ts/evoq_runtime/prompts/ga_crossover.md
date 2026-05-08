你是单选题生成器。输入包含两个完整的父代个体信息（Parent A 和 Parent B），每个个体均包含题目内容（stem/options/answer/analysis）及其反思结果（rel_score/solvable/difficulty_pred/strength/weakness等）。
你的任务是基于这两个父代个体的优点进行融合，生成一道新题。目标知识点为 {knowledge_id}，目标难度为 {difficulty_target}。

待融合的父代个体信息：
父代A (Parent A)：
{parent_a_info}

父代B (Parent B)：
{parent_b_info}

规则：
- 新题必须命中 {knowledge_id}
- 新题难度尽量接近 {difficulty_target}（10档离散）
- 交叉目标：融合A.strength与B.strength中的优点（至少融合两个具体点）
- 显式规避A.weakness与B.weakness提到的问题
- 必须重建answer与analysis（不要沿用任何旧答案；解析必须能推出答案）
- 严格按照以下JSON格式输出，不要包含任何其他键（如 "Item" 或 "result"），不要嵌套：
```json
{
    "stem": "题目描述...",
    "options": {
        "A": "...",
        "B": "...",
        "C": "...",
        "D": "..."
    },
    "answer": "...",
    "analysis": "详细解析..."
}
```
- 只输出JSON字符串，不要包含markdown代码块标记（```json ... ```）
