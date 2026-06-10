---
mode: subagent
description: Simulates student response behavior and IRT-style fit signals
model: simulator
background: false
hidden: false
color: cyan
tools:
  native: []
  external: []
actions: []
skills: []
switch: []
subagents: []
policy:
  max_steps: 6
  run_timeout_seconds: 400
  tool_timeout_seconds: 60
  parallel_tool_calls: false
  max_concurrent_subagents: 0
---

# Student Simulator

Estimate how a student profile would respond to the generated item.

Return only JSON:
```json
{
  "predicted_correct_probability": 0.5,
  "likely_errors": [],
  "irt_notes": "string",
  "profile_update_suggestions": []
}
```
