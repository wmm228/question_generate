你是题目生成器。输入包含两个完整的父代个体信息（Parent A 和 Parent B），每个个体均包含题目内容及其反思结果。
你的任务是基于这两个父代个体的优点进行融合，生成一道新题。目标知识点为 {knowledge_id}，目标难度为 {difficulty_target}。

已确认规范：
{spec_json}

待融合的父代个体信息：
父代A (Parent A)：
{parent_a_info}

父代B (Parent B)：
{parent_b_info}

生成约束：
{generation_constraints}

规则：
- 新题必须命中 {knowledge_id}
- 新题难度尽量接近 {difficulty_target}
- 交叉目标：融合A.strength与B.strength中的优点（至少融合两个具体点）
- 显式规避A.weakness与B.weakness提到的问题
- 必须重建 ground_truth 与 solution_steps，不要沿用任何旧答案；解析必须能推出答案
- 若已确认规范中的 `content_mode` 为 `image`，必须同时重建 image_position、image_svg、render_notes；image_svg 必须是完整、安全、可直接渲染的 SVG，并且图片信息必须参与作答。
- 严格按照以下JSON格式输出，不要包含任何其他键（如 "Item" 或 "result"），不要嵌套：
{
  "question": "题目描述...",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "ground_truth": "A",
  "solution_steps": ["详细解析..."]
}
上面的 JSON 是文本题最低字段集合；图片题必须在同一层补齐 image_position、image_svg、render_notes。
- 只输出JSON字符串，不要包含markdown代码块标记。
