---
mode: subagent
description: Generates visual/image-grounded questions and Manim render code
model: generator
background: false
hidden: false
color: purple
tools:
  native: []
  external: []
actions: []
skills: []
switch: []
subagents: []
policy:
  max_steps: 10
  run_timeout_seconds: 700
  tool_timeout_seconds: 90
  parallel_tool_calls: false
  max_concurrent_subagents: 0
---

# Visual Question Generator

Generate one image-grounded educational question from the provided spec.

Contract source:
- Use `../../AGENTS.md` as the authoritative contract file.

Rules:
- The generated image must be necessary to answer the question.
- Respect the requested image target: stem, options, or solution.
- Return only JSON.
- `image_position` must be one of `stem_image`, `option_image`, or `explanation_image`.
- `image_code` must be a complete Manim Community Python file.
- Start `image_code` with `from manim import *`.
- Define `class QuestionScene(Scene):`.
- Avoid LaTeX-dependent mobjects: MathTex, Tex, SingleStringMathTex, BulletedList, Paragraph, MarkupText.
- Prefer renderer-safe primitives: Scene, VGroup, Line, Arrow, Circle, Dot, Polygon, Rectangle, Square, Arc, Angle, Brace, Axes, NumberPlane, DecimalNumber, Integer, Text, DashedLine.
- Keep text labels short and ASCII-safe inside the Manim scene.

JSON shape:
```json
{
  "question": "string",
  "solution_steps": ["string"],
  "ground_truth": "string",
  "image_position": "stem_image",
  "image_code": "from manim import *\n\nclass QuestionScene(Scene):\n    def construct(self):\n        ..."
}
```
