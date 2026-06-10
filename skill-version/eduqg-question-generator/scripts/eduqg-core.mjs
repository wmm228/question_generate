import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, '..');
const profileStorePath = path.join(skillDir, 'out', 'profiles.json');

const QUESTION_TYPE_ALIASES = new Map([
  ['选择题', 'single_choice'],
  ['单选题', 'single_choice'],
  ['single', 'single_choice'],
  ['single_choice', 'single_choice'],
  ['multiple', 'multiple_choice'],
  ['multiple_choice', 'multiple_choice'],
  ['多选题', 'multiple_choice'],
  ['判断题', 'true_false'],
  ['truefalse', 'true_false'],
  ['true_false', 'true_false'],
  ['填空题', 'fill_blank'],
  ['fillblank', 'fill_blank'],
  ['fill_blank', 'fill_blank'],
  ['简答题', 'short_answer'],
  ['short', 'short_answer'],
  ['short_answer', 'short_answer'],
]);

const CONTENT_MODE_ALIASES = new Map([
  ['text', 'text'],
  ['纯文本', 'text'],
  ['无图', 'text'],
  ['image', 'diagram_required'],
  ['图片题', 'diagram_required'],
  ['图文题', 'diagram_required'],
  ['diagram_optional', 'diagram_optional'],
  ['可选配图', 'diagram_optional'],
  ['diagram_required', 'diagram_required'],
  ['必须配图', 'diagram_required'],
  ['必需配图', 'diagram_required'],
]);

const STRATEGIES = new Set(['direct', 'cot', 'react', 'dear', 'eqpr', 'evoq']);
const QUESTION_TYPES = new Set([...QUESTION_TYPE_ALIASES.values()]);
const AGENT_NAMES = [
  'question-orchestrator',
  'spec-normalizer',
  'intent-recognizer',
  'text-question-generator',
  'visual-question-generator',
  'text-question-evaluator',
  'visual-question-evaluator',
  'student-simulator',
  'profile-evolution',
];

export const AGENT_PROMPT_TEMPLATES = {
  'question-orchestrator': [
    'You are the EDUQG question-orchestrator agent.',
    'Your job is to talk with the teacher, confirm teacher-controlled fields, and route the task to the correct EDUQG tool.',
    'Teacher-controlled fields are subject, knowledge_points or knowledge_point, difficulty, question_type, content_mode, algorithm or strategy, and image_requirement or diagram.',
    'If any required teacher-controlled field is missing, ask concise clarification questions instead of generating.',
    'Never silently change teacher-selected subject, knowledge point, question type, difficulty, content mode, algorithm, or image requirement.',
    'Return machine-readable JSON when acting as a tool-facing agent.',
  ],
  'spec-normalizer': [
    'You are the EDUQG spec-normalizer agent.',
    'Convert teacher intent into edu-question-spec.v1.',
    'Extract subject, grade_band, knowledge_points, question_type, difficulty, count, content_mode, image_requirement, algorithm, teacher_profile, student_profile, source_material, and extra_requirements.',
    'Support Chinese classroom wording and normalize aliases such as selection question to single_choice, image question to diagram_required, and medium difficulty to 3.',
    'List missing required fields instead of inventing them.',
    'Return JSON only.',
  ],
  'intent-recognizer': [
    'You are the EDUQG intent-recognizer agent.',
    'Decide whether the current teacher turn authorizes immediate question generation.',
    'Return ready only when subject, knowledge point, difficulty, question type, content mode, and algorithm are explicit or confirmed.',
    'Return needs_clarification when the teacher is still exploring, asking about options, or missing required fields.',
    'Return JSON with intent, ready, missing_fields, and reason.',
  ],
  'text-question-generator': [
    'You are the EDUQG text-question-generator agent.',
    'Generate text-only educational questions from edu-question-spec.v1.',
    'Do not include image references such as "as shown in the figure" when content_mode is text.',
    'Each item must include stem, options when applicable, answer, student-facing analysis, and metadata.',
    'Single-choice questions must have exactly four unique options A-D and exactly one answer.',
    'Keep the generated item aligned with the requested subject, knowledge points, question type, difficulty, and algorithm.',
    'Return JSON only and do not expose hidden chain-of-thought.',
  ],
  'visual-question-generator': [
    'You are the EDUQG visual-question-generator agent.',
    'Generate image-grounded educational questions from edu-question-spec.v1.',
    'The diagram must contain answer-relevant information and must match the stem, values, labels, and solution.',
    'For required diagrams, include diagram position, description, and renderable SVG or image code.',
    'Never produce decorative diagrams for required visual questions.',
    'Each item must include stem, options when applicable, answer, student-facing analysis, diagrams, and metadata.',
    'Return JSON only and do not expose hidden chain-of-thought.',
  ],
  'text-question-evaluator': [
    'You are the EDUQG text-question-evaluator agent.',
    'Evaluate text-only generated questions before display or storage.',
    'Check knowledge alignment, difficulty match, question-type compliance, answer correctness, explanation completeness, language clarity, and teaching usefulness.',
    'Reject text questions that refer to missing diagrams.',
    'Return JSON with score, status, issues, dimensions, and revision suggestions when needed.',
  ],
  'visual-question-evaluator': [
    'You are the EDUQG visual-question-evaluator agent.',
    'Evaluate image-grounded questions before display or storage.',
    'Check all text-question dimensions plus diagram relevance, diagram-stem consistency, answer-relevant visual content, SVG/render safety, and layout readability.',
    'Reject required visual questions when the diagram is missing, decorative, contradictory, or not renderable.',
    'Return JSON with score, status, issues, dimensions, and revision suggestions when needed.',
  ],
  'student-simulator': [
    'You are the EDUQG student-simulator agent.',
    'Simulate a likely student response using the student profile, item wording, difficulty, and common misconceptions.',
    'The simulated response may be correct or incorrect, but it must be plausible for the stated student level.',
    'Explain the misconception briefly without exposing hidden chain-of-thought.',
    'Return JSON with simulated_student, response, rationale, and confidence.',
  ],
  'profile-evolution': [
    'You are the EDUQG profile-evolution agent.',
    'Read and update teacher/student profile hints based on generation requests, evaluation results, and feedback.',
    'Teacher profile may include preferred style, difficulty calibration, visualization preferences, and constraints.',
    'Student profile may include level, common errors, weak knowledge points, and learning preferences.',
    'Do not override explicit teacher-controlled fields with profile hints.',
    'Return JSON with profile patch and rationale.',
  ],
};

export function nowIso() {
  return new Date().toISOString();
}

function cleanString(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }
  const text = cleanString(value);
  if (!text) return [];
  return text.split(/[,，;；、\n]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeDifficulty(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = cleanString(value).toLowerCase();
  const mapped = {
    easy: 2,
    简单: 2,
    medium: 3,
    中等: 3,
    normal: 3,
    hard: 5,
    困难: 5,
  }[text];
  if (mapped) return mapped;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const scaled = number > 6 ? Math.round(number / 15) : Math.round(number);
  return Math.max(1, Math.min(6, scaled));
}

function normalizeQuestionType(value) {
  const key = cleanString(value).toLowerCase();
  return QUESTION_TYPE_ALIASES.get(key) || key;
}

function normalizeContentMode(value, diagram) {
  if (diagram?.required) return 'diagram_required';
  const key = cleanString(value).toLowerCase();
  return CONTENT_MODE_ALIASES.get(key) || 'text';
}

function normalizeDiagramRequirement(value) {
  if (!value) return {};
  if (typeof value === 'object') {
    return {
      required: value.required ?? value.must_have_image ?? value.image_required,
      position: value.position || value.image_position,
      must_be_answer_relevant: value.must_be_answer_relevant ?? value.answer_relevant ?? value.required,
      style: value.style || value.render_style,
    };
  }
  const text = cleanString(value);
  if (!text) return {};
  const required = /必须|必需|required|image_only|题干配图|配图|图示/i.test(text);
  let position = 'stem';
  if (/选项|options/i.test(text)) position = 'options';
  if (/解析|explanation|solution/i.test(text)) position = 'explanation';
  return {
    required,
    position,
    must_be_answer_relevant: required,
    style: 'clean_svg',
  };
}

function pickNaturalSubject(text) {
  for (const subject of ['数学', '物理', '化学', '生物', '英语', '语文']) {
    if (text.includes(subject)) return subject;
  }
  return '';
}

function pickNaturalQuestionType(text) {
  for (const [alias, normalized] of QUESTION_TYPE_ALIASES.entries()) {
    if (text.includes(alias)) return normalized;
  }
  return '';
}

function pickNaturalDifficulty(text) {
  const explicit = text.match(/难度\s*[:：]?\s*([1-6])/);
  if (explicit) return Number(explicit[1]);
  if (text.includes('简单')) return 2;
  if (text.includes('中等')) return 3;
  if (text.includes('困难') || text.includes('较难')) return 5;
  return undefined;
}

function pickNaturalKnowledgePoints(text) {
  const patterns = [
    /知识点(?:是|为|:|：)\s*([^，。；;\n]+)/,
    /围绕\s*([^，。；;\n]+?)\s*(?:生成|出|设计)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return asArray(match[1]);
  }
  for (const keyword of ['勾股定理', '一次函数', '二次函数', '受力分析', '牛顿第二定律', '串并联电路']) {
    if (text.includes(keyword)) return [keyword];
  }
  return [];
}

export function specFromNaturalText(text) {
  const content = cleanString(text);
  return {
    subject: pickNaturalSubject(content),
    knowledge_points: pickNaturalKnowledgePoints(content),
    question_type: pickNaturalQuestionType(content),
    difficulty: pickNaturalDifficulty(content),
    count: Number(content.match(/([1-9]\d*)\s*道/)?.[1] || 1),
    content_mode: content.includes('配图') || content.includes('图示') ? 'diagram_required' : 'text',
    extra_requirements: content,
  };
}

export function normalizeSpec(payload = {}) {
  const raw = typeof payload.spec === 'object' && payload.spec !== null ? payload.spec : payload;
  const natural = raw.text || raw.prompt ? specFromNaturalText(`${raw.text || raw.prompt}`) : {};
  const merged = { ...natural, ...raw };
  const imageRequirement = normalizeDiagramRequirement(merged.image_requirement);
  const diagram = { ...imageRequirement, ...(merged.diagram || {}) };
  const contentMode = normalizeContentMode(merged.content_mode || merged.contentMode, diagram);
  diagram.required = contentMode === 'diagram_required' || diagram.required === true;
  diagram.position = diagram.position || 'stem';
  diagram.must_be_answer_relevant = diagram.must_be_answer_relevant ?? diagram.required;
  diagram.style = diagram.style || 'clean_svg';

  const strategy = cleanString(merged.strategy || merged.algorithm || 'direct').toLowerCase();
  return {
    version: 'edu-question-spec.v1',
    request_id: cleanString(merged.request_id) || crypto.randomUUID(),
    locale: cleanString(merged.locale) || 'zh-CN',
    grade_band: cleanString(merged.grade_band || merged.grade),
    subject: cleanString(merged.subject),
    knowledge_points: asArray(merged.knowledge_points || merged.knowledge_point),
    curriculum_goal: cleanString(merged.curriculum_goal),
    question_type: normalizeQuestionType(merged.question_type || merged.type),
    difficulty: normalizeDifficulty(merged.difficulty),
    count: Math.max(1, Math.min(20, Number(merged.count || 1))),
    content_mode: contentMode,
    algorithm: STRATEGIES.has(strategy) ? strategy : 'direct',
    diagram,
    strategy: STRATEGIES.has(strategy) ? strategy : 'direct',
    teacher_profile: typeof merged.teacher_profile === 'object' && merged.teacher_profile ? merged.teacher_profile : {},
    student_profile: typeof merged.student_profile === 'object' && merged.student_profile ? merged.student_profile : {},
    source_material: cleanString(merged.source_material),
    extra_requirements: cleanString(merged.extra_requirements || merged.requirements),
  };
}

export function findMissingFields(spec) {
  const missing = [];
  if (!spec.subject) missing.push('subject');
  if (!spec.knowledge_points?.length) missing.push('knowledge_points');
  if (!QUESTION_TYPES.has(spec.question_type)) missing.push('question_type');
  if (!spec.difficulty) missing.push('difficulty');
  return [...new Set(missing)];
}

export function clarificationResult(spec, missingFields) {
  const prompts = {
    subject: '请补充学科，例如数学、物理、化学或生物。',
    knowledge_points: '请补充知识点，例如勾股定理、一次函数或受力分析。',
    question_type: '请补充题型，例如 single_choice、true_false、fill_blank 或 short_answer。',
    difficulty: '请补充难度，使用 1-6 的整数。',
  };
  return {
    version: 'eduqg-generation-result.v1',
    status: 'needs_clarification',
    request_id: spec.request_id,
    missing_fields: missingFields,
    questions: missingFields.map((field) => prompts[field]).filter(Boolean),
    spec,
  };
}

function pythagoreanSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 240" width="420" height="240" role="img" aria-label="直角三角形示意图">',
    '<rect width="420" height="240" fill="#ffffff"/>',
    '<path d="M90 185 L90 55 L250 185 Z" fill="#eef2ff" stroke="#2563eb" stroke-width="4"/>',
    '<path d="M90 165 L110 165 L110 185" fill="none" stroke="#111827" stroke-width="3"/>',
    '<text x="75" y="205" font-size="18" fill="#111827">C</text>',
    '<text x="70" y="50" font-size="18" fill="#111827">A</text>',
    '<text x="255" y="205" font-size="18" fill="#111827">B</text>',
    '<text x="45" y="125" font-size="18" fill="#dc2626">6</text>',
    '<text x="160" y="210" font-size="18" fill="#dc2626">8</text>',
    '<text x="175" y="105" font-size="18" fill="#16a34a">AB = ?</text>',
    '<text x="292" y="90" font-size="16" fill="#374151">∠C = 90°</text>',
    '</svg>',
  ].join('');
}

function forceSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 240" width="420" height="240" role="img" aria-label="受力分析示意图">',
    '<rect width="420" height="240" fill="#ffffff"/>',
    '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#111827"/></marker></defs>',
    '<rect x="160" y="95" width="100" height="60" rx="8" fill="#fef3c7" stroke="#d97706" stroke-width="3"/>',
    '<line x1="210" y1="95" x2="210" y2="40" stroke="#dc2626" stroke-width="4" marker-end="url(#arrow)"/>',
    '<line x1="210" y1="155" x2="210" y2="210" stroke="#2563eb" stroke-width="4" marker-end="url(#arrow)"/>',
    '<line x1="260" y1="125" x2="350" y2="125" stroke="#16a34a" stroke-width="4" marker-end="url(#arrow)"/>',
    '<line x1="160" y1="125" x2="85" y2="125" stroke="#6b7280" stroke-width="4" marker-end="url(#arrow)"/>',
    '<text x="220" y="55" font-size="16">支持力</text><text x="220" y="205" font-size="16">重力</text>',
    '<text x="315" y="112" font-size="16">拉力</text><text x="70" y="112" font-size="16">摩擦力</text>',
    '</svg>',
  ].join('');
}

export function buildRelevantSvg(spec) {
  const text = `${spec.subject} ${spec.knowledge_points.join(' ')}`;
  if (text.includes('勾股')) return pythagoreanSvg();
  if (text.includes('受力') || text.includes('力学')) return forceSvg();
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 180" width="420" height="180" role="img" aria-label="解题关系示意图">',
    '<rect width="420" height="180" fill="#ffffff"/>',
    '<rect x="40" y="55" width="120" height="70" rx="8" fill="#eef2ff" stroke="#2563eb" stroke-width="3"/>',
    '<rect x="260" y="55" width="120" height="70" rx="8" fill="#f0fdf4" stroke="#16a34a" stroke-width="3"/>',
    '<path d="M160 90 H260" stroke="#111827" stroke-width="3"/>',
    '<text x="63" y="97" font-size="18" fill="#111827">条件</text>',
    '<text x="283" y="97" font-size="18" fill="#111827">结论</text>',
    '</svg>',
  ].join('');
}

function buildMetadata(spec, mock = false) {
  return {
    subject: spec.subject,
    grade_band: spec.grade_band,
    knowledge_points: spec.knowledge_points,
    difficulty: spec.difficulty,
    strategy: spec.strategy,
    content_mode: spec.content_mode,
    mock,
  };
}

function mockSingleChoice(spec, index) {
  const kp = spec.knowledge_points.join('、');
  if (spec.subject.includes('数学') && kp.includes('勾股')) {
    const stem = spec.diagram.required
      ? '如图，在直角三角形 ABC 中，∠C = 90°，AC = 6，BC = 8，求斜边 AB 的长度。'
      : '在直角三角形 ABC 中，∠C = 90°，AC = 6，BC = 8，求斜边 AB 的长度。';
    return {
      question_id: `q-${index + 1}`,
      type: 'single_choice',
      stem,
      options: [
        { label: 'A', text: '8' },
        { label: 'B', text: '10' },
        { label: 'C', text: '12' },
        { label: 'D', text: '14' },
      ],
      answer: 'B',
      analysis: '因为 ∠C = 90°，AC 和 BC 是两条直角边。根据勾股定理，AB² = AC² + BC² = 6² + 8² = 36 + 64 = 100，所以 AB = 10。',
    };
  }
  return {
    question_id: `q-${index + 1}`,
    type: 'single_choice',
    stem: `下列关于“${kp}”的说法，哪一项最符合${spec.subject}中的基本规律？`,
    options: [
      { label: 'A', text: '只要记住定义，不需要判断适用条件。' },
      { label: 'B', text: '应先识别适用条件，再选择对应规律或方法。' },
      { label: 'C', text: '所有题目都可以直接套同一个公式。' },
      { label: 'D', text: '题干中的条件通常可以忽略。' },
    ],
    answer: 'B',
    analysis: `解题时应先判断题目是否真正考查“${kp}”，再依据条件选择方法。B 项符合这一基本思路。`,
  };
}

function mockTrueFalse(spec, index) {
  const kp = spec.knowledge_points.join('、');
  return {
    question_id: `q-${index + 1}`,
    type: 'true_false',
    stem: `判断：解决“${kp}”相关题目时，只要看到关键词就可以直接写答案，不需要检查条件。`,
    options: [],
    answer: false,
    analysis: '该说法错误。关键词只能提示可能的考查方向，仍需检查题干条件、适用范围和推理步骤。',
  };
}

function mockShortAnswer(spec, index) {
  const kp = spec.knowledge_points.join('、');
  return {
    question_id: `q-${index + 1}`,
    type: spec.question_type,
    stem: `请简要说明在解决“${kp}”相关题目时，为什么需要先分析题干条件。`,
    options: [],
    answer: '因为题干条件决定知识点是否适用，也决定公式、方法和结论是否成立。',
    analysis: '先分析条件可以避免套错公式、忽略限制条件或得到不唯一答案，是保证解题正确性的关键步骤。',
  };
}

export function generateMockItems(spec) {
  return Array.from({ length: spec.count }, (_, index) => {
    let item;
    if (spec.question_type === 'single_choice' || spec.question_type === 'multiple_choice') {
      item = mockSingleChoice(spec, index);
      if (spec.question_type === 'multiple_choice') {
        item.type = 'multiple_choice';
        item.stem = item.stem.replace('哪一项', '哪些选项');
        item.answer = ['B'];
      }
    } else if (spec.question_type === 'true_false') {
      item = mockTrueFalse(spec, index);
    } else {
      item = mockShortAnswer(spec, index);
    }

    item.diagrams = spec.diagram.required
      ? [{
          id: 'fig-1',
          position: spec.diagram.position,
          description: `与“${spec.knowledge_points.join('、')}”相关，并参与作答或解析的示意图。`,
          svg: buildRelevantSvg(spec),
        }]
      : [];
    item.metadata = buildMetadata(spec, true);
    return item;
  });
}

export function evaluateItem(item, spec) {
  const issues = [];
  if (!cleanString(item.stem)) issues.push('missing stem');
  if (item.answer === undefined || item.answer === null || item.answer === '') issues.push('missing answer');
  if (!cleanString(item.analysis)) issues.push('missing analysis');
  if (item.type !== spec.question_type) issues.push('question type changed');

  if (spec.question_type === 'single_choice') {
    const labels = (item.options || []).map((option) => option.label).sort().join('');
    const optionTexts = (item.options || []).map((option) => cleanString(option.text));
    if (labels !== 'ABCD') issues.push('single_choice must have A/B/C/D options');
    if (new Set(optionTexts).size !== optionTexts.length) issues.push('options must be unique');
    if (!['A', 'B', 'C', 'D'].includes(item.answer)) issues.push('single_choice answer must be A/B/C/D');
  }

  if (spec.question_type === 'multiple_choice' && !Array.isArray(item.answer)) {
    issues.push('multiple_choice answer must be an array');
  }

  if (!spec.diagram.required && /如图|图示|下图|见图/.test(item.stem)) {
    issues.push('text question must not reference a diagram');
  }

  if (spec.diagram.required) {
    if (!Array.isArray(item.diagrams) || item.diagrams.length === 0) {
      issues.push('required diagram missing');
    } else if (spec.diagram.must_be_answer_relevant && !cleanString(item.diagrams[0].description)) {
      issues.push('diagram must describe answer-relevant content');
    }
  }

  const score = Math.max(0, 100 - issues.length * 15);
  const status = score >= 85 && issues.length === 0 ? 'pass' : score >= 70 ? 'revise' : 'reject';
  return {
    score,
    status,
    issues,
    dimensions: {
      knowledge_alignment: issues.includes('question type changed') ? 2 : 4,
      difficulty_match: 4,
      question_type_compliance: issues.some((issue) => issue.includes('choice')) ? 2 : 5,
      answer_correctness_surface: issues.includes('missing answer') ? 1 : 5,
      explanation_completeness: issues.includes('missing analysis') ? 1 : 5,
      language_clarity: 4,
      diagram_consistency: spec.diagram.required && issues.some((issue) => issue.includes('diagram')) ? 1 : 4,
      teaching_usefulness: 4,
    },
  };
}

function promptTemplate(agentName) {
  const template = AGENT_PROMPT_TEMPLATES[agentName];
  if (!template) throw new Error(`Unknown EDUQG agent prompt template: ${agentName}`);
  return template.join('\n');
}

function generatorAgentForSpec(spec) {
  return spec.diagram.required || spec.content_mode === 'diagram_required'
    ? 'visual-question-generator'
    : 'text-question-generator';
}

export function listAgentPromptTemplates() {
  return {
    version: 'eduqg-agent-prompts.v1',
    status: 'completed',
    agents: AGENT_NAMES.map((name) => ({
      name,
      template: promptTemplate(name),
    })),
  };
}

export function buildAgentPromptMessages(agentName, context = {}) {
  const rawSpec = context.spec || context;
  const spec = rawSpec && Object.keys(rawSpec).length ? normalizeSpec(rawSpec) : undefined;
  return [
    {
      role: 'system',
      content: promptTemplate(agentName),
    },
    {
      role: 'user',
      content: JSON.stringify({
        agent: agentName,
        task: context.task || 'execute_agent_role',
        spec,
        payload: context.payload || context,
        output_rules: [
          'Return JSON only when used as an automated tool.',
          'Do not expose hidden chain-of-thought.',
          'Preserve teacher-controlled fields unless the teacher explicitly changes them.',
        ],
      }, null, 2),
    },
  ];
}

export function buildPromptMessages(spec) {
  const agentName = generatorAgentForSpec(spec);
  const schemaHint = {
    version: 'eduqg-generation-result.v1',
    status: 'completed',
    items: [{
      question_id: 'q-1',
      type: spec.question_type,
      stem: '题干',
      options: spec.question_type.includes('choice') ? [{ label: 'A', text: '选项' }] : [],
      answer: '答案',
      analysis: '学生可见解析',
      diagrams: [],
      metadata: buildMetadata(spec, false),
    }],
  };
  return [
    {
      role: 'system',
      content: [
        promptTemplate(agentName),
        '',
        'Chinese classroom context rule: Prefer Chinese output when the teacher request is Chinese.',
        'Analysis field rule: analysis must be student-facing, concise, and clear.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        agent: agentName,
        task: 'generate_edu_questions',
        spec,
        required_response_shape: schemaHint,
        quality_rules: [
          'answer must be correct and consistent with analysis',
          'single_choice must have exactly four unique options A-D and exactly one answer',
          'diagram_required means diagram content must help solve or explain the question',
          'do not change subject, knowledge points, question type, or difficulty',
        ],
      }, null, 2),
    },
  ];
}

function stripCodeFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

async function callLiveModel(spec) {
  const apiKey = process.env.EDUQG_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('EDUQG_API_KEY or OPENAI_API_KEY is required for live generation. Use --mock for offline mode.');
  }
  const apiUrl = process.env.EDUQG_API_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.EDUQG_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildPromptMessages(spec),
      temperature: Number(process.env.EDUQG_TEMPERATURE || 0.4),
      response_format: { type: 'json_object' },
    }),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${body}`);
  const parsed = JSON.parse(body);
  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM response did not contain choices[0].message.content');
  return JSON.parse(stripCodeFence(content));
}

function coerceItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.questions)) return raw.questions;
  throw new Error('Generated response must include items[].');
}

export function finalizeResult(spec, rawItems, source = 'mock') {
  const items = coerceItems(rawItems).map((item, index) => {
    const normalized = {
      question_id: cleanString(item.question_id || item.id) || `q-${index + 1}`,
      type: normalizeQuestionType(item.type || spec.question_type),
      stem: cleanString(item.stem || item.question),
      options: Array.isArray(item.options) ? item.options : [],
      answer: item.answer,
      analysis: cleanString(item.analysis || item.explanation),
      diagrams: Array.isArray(item.diagrams) ? item.diagrams : [],
      metadata: { ...buildMetadata(spec, source === 'mock'), ...(item.metadata || {}) },
    };
    normalized.evaluation = evaluateItem(normalized, spec);
    return normalized;
  });

  const avgScore = Math.round(items.reduce((sum, item) => sum + item.evaluation.score, 0) / Math.max(1, items.length));
  const status = items.every((item) => item.evaluation.status === 'pass') ? 'pass' : 'revise';
  return {
    version: 'eduqg-generation-result.v1',
    status: 'completed',
    request_id: spec.request_id,
    spec,
    items,
    evaluation_summary: {
      score: avgScore,
      status,
      needs_human_review: status !== 'pass',
      source,
    },
    events: [
      { stage: 'request', message: 'request accepted and normalized', timestamp: nowIso() },
      { stage: 'generate', message: `${source} generation completed`, timestamp: nowIso() },
      { stage: 'evaluate', message: 'quality checks completed', timestamp: nowIso() },
      { stage: 'done', message: 'result ready', timestamp: nowIso() },
    ],
  };
}

export async function generateEduqgResult(payload, options = {}) {
  const spec = normalizeSpec(payload);
  const missing = findMissingFields(spec);
  if (missing.length) return clarificationResult(spec, missing);
  if (options.emitPrompt) {
    const agentName = options.agentName || generatorAgentForSpec(spec);
    return {
      version: 'eduqg-generation-result.v1',
      status: 'completed',
      request_id: spec.request_id,
      spec,
      agent: agentName,
      prompt_messages: agentName === generatorAgentForSpec(spec)
        ? buildPromptMessages(spec)
        : buildAgentPromptMessages(agentName, { spec }),
    };
  }
  if (options.mock) return finalizeResult(spec, generateMockItems(spec), 'mock');
  const live = await callLiveModel(spec);
  return finalizeResult(spec, live, 'live');
}

export function validateQuestionSpec(payload = {}) {
  const spec = normalizeSpec(payload);
  const missing = findMissingFields(spec);
  if (missing.length) return clarificationResult(spec, missing);
  return {
    version: 'eduqg-generation-result.v1',
    status: 'completed',
    request_id: spec.request_id,
    spec,
    validation: {
      ok: true,
      missing_fields: [],
      human_controlled_fields: [
        'subject',
        'knowledge_points',
        'difficulty',
        'question_type',
        'content_mode',
        'strategy',
        'diagram',
      ],
    },
    events: [
      { stage: 'request', message: 'request accepted and normalized', timestamp: nowIso() },
      { stage: 'validate', message: 'required teacher-controlled fields are present', timestamp: nowIso() },
      { stage: 'done', message: 'spec ready for generation', timestamp: nowIso() },
    ],
  };
}

export async function generateVisualQuestion(payload = {}, options = {}) {
  const raw = typeof payload.spec === 'object' && payload.spec !== null ? payload.spec : payload;
  const visualPayload = {
    ...payload,
    spec: {
      ...raw,
      content_mode: 'diagram_required',
      image_requirement: raw.image_requirement || '题干配图，图片必须参与作答',
      diagram: {
        ...(raw.diagram || {}),
        required: true,
        position: raw.diagram?.position || 'stem',
        must_be_answer_relevant: true,
      },
    },
  };
  const result = await generateEduqgResult(visualPayload, options);
  if (result.events) {
    result.events.splice(1, 0, {
      stage: 'route',
      message: 'visual-question-generator selected for image-grounded question',
      timestamp: nowIso(),
    });
  }
  return result;
}

export async function runEvoqTextQuestion(payload = {}, options = {}) {
  const raw = typeof payload.spec === 'object' && payload.spec !== null ? payload.spec : payload;
  const evoqPayload = {
    ...payload,
    spec: {
      ...raw,
      strategy: 'evoq',
      algorithm: 'evoq',
      content_mode: 'text',
      diagram: {
        ...(raw.diagram || {}),
        required: false,
      },
    },
  };
  const result = await generateEduqgResult(evoqPayload, options);
  if (result.evaluation_summary) {
    result.evaluation_summary.algorithm = 'evoq';
    result.evaluation_summary.optimization_notes = [
      'EvoQ route selected for text question quality optimization.',
      'Current standalone runtime exposes the route and deterministic evaluation surface; live multi-candidate evolution should be attached at platform/model layer when configured.',
    ];
  }
  if (result.events) {
    result.events.splice(1, 0, {
      stage: 'plan',
      message: 'EvoQ text-question route selected',
      timestamp: nowIso(),
    });
  }
  return result;
}

export function renderQuestionImage(payload = {}) {
  const spec = normalizeSpec(payload);
  const item = payload.item || payload.items?.[0] || payload.result?.items?.[0];
  const diagrams = Array.isArray(item?.diagrams) && item.diagrams.length
    ? item.diagrams
    : [{
        id: 'fig-1',
        position: spec.diagram.position || 'stem',
        description: `与“${spec.knowledge_points.join('、') || '目标知识点'}”相关，并参与作答或解析的示意图。`,
        svg: buildRelevantSvg(spec),
      }];
  return {
    version: 'eduqg-render-result.v1',
    status: 'completed',
    request_id: spec.request_id,
    spec,
    diagrams,
    events: [
      { stage: 'render', message: 'question image rendered as SVG', timestamp: nowIso() },
      { stage: 'done', message: 'diagram ready', timestamp: nowIso() },
    ],
  };
}

function getFirstItem(payload = {}) {
  return payload.item || payload.items?.[0] || payload.result?.items?.[0] || payload.question;
}

function normalizeEvaluationItem(item, spec) {
  return {
    question_id: cleanString(item?.question_id || item?.id) || 'q-1',
    type: normalizeQuestionType(item?.type || spec.question_type),
    stem: cleanString(item?.stem || item?.question),
    options: Array.isArray(item?.options) ? item.options : [],
    answer: item?.answer ?? item?.ground_truth,
    analysis: cleanString(item?.analysis || item?.explanation || item?.solution_steps),
    diagrams: Array.isArray(item?.diagrams) ? item.diagrams : [],
    metadata: { ...buildMetadata(spec, false), ...(item?.metadata || {}) },
  };
}

export function evaluateTextQuestion(payload = {}) {
  const spec = normalizeSpec(payload.spec || payload);
  const item = getFirstItem(payload);
  if (!item) {
    return {
      version: 'eduqg-evaluation-result.v1',
      status: 'failed',
      request_id: spec.request_id,
      error: 'evaluate_text_question requires item, items[0], result.items[0], or question.',
    };
  }
  const normalized = normalizeEvaluationItem(item, spec);
  const evaluation = evaluateItem(normalized, spec);
  return {
    version: 'eduqg-evaluation-result.v1',
    status: 'completed',
    request_id: spec.request_id,
    content_mode: 'text',
    item: normalized,
    evaluation,
    evaluation_summary: {
      score: evaluation.score,
      status: evaluation.status,
      needs_human_review: evaluation.status !== 'pass',
    },
  };
}

export function evaluateVisualQuestion(payload = {}) {
  const spec = normalizeSpec({
    ...(payload.spec || payload),
    content_mode: 'diagram_required',
    diagram: {
      ...((payload.spec || payload).diagram || {}),
      required: true,
      must_be_answer_relevant: true,
    },
  });
  const item = getFirstItem(payload);
  if (!item) {
    return {
      version: 'eduqg-evaluation-result.v1',
      status: 'failed',
      request_id: spec.request_id,
      error: 'evaluate_visual_question requires item, items[0], result.items[0], or question.',
    };
  }
  const normalized = normalizeEvaluationItem(item, spec);
  const evaluation = evaluateItem(normalized, spec);
  const svgIssues = [];
  for (const diagram of normalized.diagrams || []) {
    if (!cleanString(diagram.svg).startsWith('<svg')) svgIssues.push(`diagram ${diagram.id || 'unknown'} missing SVG markup`);
  }
  if (svgIssues.length) {
    evaluation.issues.push(...svgIssues);
    evaluation.score = Math.max(0, evaluation.score - svgIssues.length * 15);
    evaluation.status = evaluation.score >= 85 && evaluation.issues.length === 0 ? 'pass' : evaluation.score >= 70 ? 'revise' : 'reject';
  }
  return {
    version: 'eduqg-evaluation-result.v1',
    status: 'completed',
    request_id: spec.request_id,
    content_mode: 'diagram_required',
    item: normalized,
    evaluation,
    evaluation_summary: {
      score: evaluation.score,
      status: evaluation.status,
      needs_human_review: evaluation.status !== 'pass',
    },
  };
}

export function simulateStudentResponse(payload = {}) {
  const spec = normalizeSpec(payload.spec || payload);
  const item = getFirstItem(payload) || generateMockItems(spec)[0];
  const normalized = normalizeEvaluationItem(item, spec);
  const misconception = spec.student_profile?.common_errors?.[0] || '可能忽略题干条件或混淆关键概念';
  let response = normalized.answer;
  if (spec.question_type === 'single_choice') {
    const labels = normalized.options.map((option) => option.label);
    response = labels.find((label) => label !== normalized.answer) || normalized.answer;
  } else if (spec.question_type === 'true_false') {
    response = !Boolean(normalized.answer);
  } else if (typeof normalized.answer === 'string') {
    response = normalized.answer.includes('10') ? '8' : normalized.answer;
  }
  return {
    version: 'eduqg-student-simulation-result.v1',
    status: 'completed',
    request_id: spec.request_id,
    simulated_student: {
      level: spec.student_profile?.level || '中等',
      common_error: misconception,
    },
    response,
    rationale: `该模拟回答体现了学生的常见错误：${misconception}。`,
    confidence: 0.62,
    item: normalized,
  };
}

async function loadProfiles() {
  try {
    const raw = await fs.readFile(profileStorePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveProfiles(profiles) {
  await fs.mkdir(path.dirname(profileStorePath), { recursive: true });
  await fs.writeFile(profileStorePath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
}

export async function readProfile(payload = {}) {
  const profileId = cleanString(payload.profile_id || payload.user_id || payload.id || 'default');
  const kind = cleanString(payload.kind || payload.profile_type || 'teacher');
  const profiles = await loadProfiles();
  const profile = profiles[kind]?.[profileId] || {};
  return {
    version: 'eduqg-profile-result.v1',
    status: 'completed',
    profile_id: profileId,
    kind,
    profile,
  };
}

export async function writeProfile(payload = {}) {
  const profileId = cleanString(payload.profile_id || payload.user_id || payload.id || 'default');
  const kind = cleanString(payload.kind || payload.profile_type || 'teacher');
  const patch = typeof payload.profile === 'object' && payload.profile ? payload.profile : {};
  const profiles = await loadProfiles();
  profiles[kind] = profiles[kind] || {};
  profiles[kind][profileId] = {
    ...(profiles[kind][profileId] || {}),
    ...patch,
    updated_at: nowIso(),
  };
  await saveProfiles(profiles);
  return {
    version: 'eduqg-profile-result.v1',
    status: 'completed',
    profile_id: profileId,
    kind,
    profile: profiles[kind][profileId],
  };
}

export async function dispatchEduqgTool(toolName, payload = {}, options = {}) {
  switch (toolName) {
    case 'validate_question_spec':
      return validateQuestionSpec(payload);
    case 'generate_eduqg_question':
      return generateEduqgResult(payload, options);
    case 'generate_visual_question':
      return generateVisualQuestion(payload, options);
    case 'run_evoq_text_question':
      return runEvoqTextQuestion(payload, options);
    case 'render_question_image':
      return renderQuestionImage(payload);
    case 'simulate_student_response':
      return simulateStudentResponse(payload);
    case 'evaluate_text_question':
      return evaluateTextQuestion(payload);
    case 'evaluate_visual_question':
      return evaluateVisualQuestion(payload);
    case 'read_profile':
      return readProfile(payload);
    case 'write_profile':
      return writeProfile(payload);
    case 'list_agent_prompt_templates':
      return listAgentPromptTemplates();
    default:
      return {
        version: 'eduqg-tool-result.v1',
        status: 'failed',
        error: `Unknown EDUQG tool: ${toolName}`,
      };
  }
}
