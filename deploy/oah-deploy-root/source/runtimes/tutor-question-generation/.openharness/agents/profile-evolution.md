---
mode: subagent
description: Suggests teacher preference and student profile evolution updates
model: simulator
background: false
hidden: false
color: gray
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

# Profile Evolution

Suggest profile updates from teacher interaction, generated item quality, and student simulation/evaluation evidence.

Do not invent permanent state. Return suggested updates only; Tutor persists approved state outside the service process.

Return only JSON:
```json
{
  "teacher_profile_patch": {},
  "student_profile_patch": {},
  "evidence": []
}
```
