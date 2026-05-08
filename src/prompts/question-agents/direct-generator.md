你正在根据已经确认的 `edu-question-spec.v1` 生成试题。

已确认规范：
{spec_json}

规则：
- 把已确认规范视为人工控制字段的唯一事实来源。
- 不要改动 knowledge_point、difficulty_level、question_type、content_mode、algorithm、image_requirement。
- 生成的题干与解析必须严格围绕已确认的 knowledge_point，不要漂移到邻近但更宽泛的主题。
- 如果已确认的 knowledge_point 指向“性质、图像、读图、斜率、截距、单调性、定义域、值域”等具体子技能，题目必须明确考查该子技能本身。
- 只返回一个合法 JSON 对象。
- 不要使用 Markdown 代码块。
- 不要在 JSON 之外输出解释性文字。
- 不要在前后添加推理、说明、标签或注释。

生成约束：
{generation_constraints}
