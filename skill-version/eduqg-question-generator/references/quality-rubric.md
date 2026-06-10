# EDUQG Quality Rubric

Use this rubric after generation and before returning final items.

## Dimensions

Score each dimension from `1` to `5`.

1. Knowledge alignment
   - The item directly assesses the requested knowledge points.
   - It does not drift to unrelated or out-of-scope concepts.

2. Difficulty match
   - The reasoning depth, distractors, and computation burden match the requested `difficulty`.
   - Difficulty `1-2`: recall or one-step practice.
   - Difficulty `3-4`: classroom practice with one or two reasoning steps.
   - Difficulty `5-6`: synthesis, traps, or multi-step reasoning.

3. Question-type compliance
   - `single_choice` has four options and exactly one correct answer.
   - `multiple_choice` states that more than one option may be correct.
   - `true_false` has a clear true/false answer.
   - `fill_blank` and `short_answer` have judgeable answers.

4. Answer correctness
   - The provided answer follows from the stem and conditions.
   - The explanation reaches the same answer.

5. Explanation completeness
   - The solution steps are clear enough for a student.
   - Key formulas, assumptions, and reasoning jumps are explicit.

6. Language clarity
   - The stem is unambiguous.
   - Options are parallel and readable.
   - Wording fits the target grade band.

7. Diagram consistency
   - Required only for `diagram_optional` or `diagram_required`.
   - Diagrams must match the stem and contain useful information.
   - Decorative diagrams should fail this dimension.

8. Teaching usefulness
   - The item supports practice, diagnosis, assessment, or remediation.
   - Distractors should reflect common misconceptions when possible.

## Decision Rules

Return `pass` when:

- Overall score is at least `85`.
- No critical issue exists.
- Answer correctness is `5`.
- Knowledge alignment is at least `4`.

Return `revise` when:

- Overall score is `70-84`.
- The item is structurally valid.
- Problems are local and fixable.

Return `reject` when:

- The answer is wrong.
- The item does not assess the requested knowledge point.
- The item type is invalid.
- A required diagram is missing or contradicts the stem.
- The stem is ambiguous enough that more than one answer is plausible.

## Critical Issues

Always reject or regenerate when any of these appear:

- Incorrect answer.
- Non-unique answer for `single_choice`.
- Missing answer or missing explanation.
- Generated item changes the requested subject or knowledge point.
- Diagram is required but absent.
- Diagram is decorative when `must_be_answer_relevant` is true.
- Content is unsafe, discriminatory, or age-inappropriate.
