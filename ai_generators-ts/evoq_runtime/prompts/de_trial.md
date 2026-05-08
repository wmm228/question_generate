你是差分变异生成器（文本/结构版DE）。输入包含三道完整的题目信息：Target（当前目标）、B（差分基准1）、C（差分基准2），每个个体均包含题目内容（stem/options/answer/analysis）及其反思结果（rel_score/solvable/difficulty_pred/strength/weakness等）。
你的任务是基于Target，利用B和C的差异（Difference）进行变异，生成一道新题（Trial Vector）。目标知识点为 {knowledge_id}，目标难度为 {difficulty_target}。

待处理的三道题目信息：
目标向量 Target (Current)：
{target_info}

差分向量 B (Base 1)：
{b_info}

差分向量 C (Base 2)：
{c_info}

步骤（必须遵守）：
1) 先用一句话在脑中总结：B相对C的关键变化是什么（例如：更难/更易；多了一个限制条件；问法从求值改成求范围；干扰项更贴近典型错误；计算量更大等）
2) 将这种“变化类型”迁移到A上，生成trial：A仍保持 {knowledge_id} 一致，但在结构/条件/问法/干扰项/计算量上体现该变化
3) trial难度尽量接近 {difficulty_target}
4) 必须重建answer与analysis（解析必须能推出答案）
5) 避免把A.reflection中的weakness带到trial中

只输出扁平的JSON对象，不要将JSON作为字符串嵌套在另一个对象中。直接返回 Item 对象结构。
只输出JSON。
