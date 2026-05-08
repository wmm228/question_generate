export const DEFAULT_CLIENT_CONFIG = {
    algorithms: ["direct", "cot", "react", "dear", "eqpr", "evoq"],
    algorithm_labels: {
        direct: "直接生成",
        cot: "分步推理",
        react: "推理行动",
        dear: "分解增强",
        eqpr: "过程校验",
        evoq: "进化优化",
    },
    question_types: ["multiple_choice", "true_false", "short_answer"],
    question_type_labels: {
        multiple_choice: "选择题",
        true_false: "判断题",
        short_answer: "简答题",
    },
    content_modes: ["text", "image"],
    content_mode_labels: {
        text: "文本题",
        image: "图片题",
    },
    image_modes: ["none", "optional", "required"],
    image_mode_labels: {
        none: "无图",
        optional: "可选配图",
        required: "必须出图",
    },
    image_placements: ["stem_image", "explanation_image", "option_image"],
    image_placement_labels: {
        stem_image: "题干配图",
        explanation_image: "解析配图",
        option_image: "选项配图",
    },
    image_targets: ["stem", "options", "solution"],
    image_target_labels: {
        stem: "题干",
        options: "选项",
        solution: "解析",
    },
};
export const IMAGE_TARGET_BY_PLACEMENT = {
    stem_image: ["stem"],
    explanation_image: ["solution"],
    option_image: ["options"],
};
export const DEFAULT_PERSISTED_STATE = {
    activePortraitId: "",
    latestKnowledgePointDraft: "",
    latestPortraitReplyDraft: "",
    requestDraft: {
        difficulty: "2",
        algorithm: "direct",
        question_type: "multiple_choice",
        content_mode: "text",
        image_mode: "none",
        image_placement: "",
        image_targets: [],
    },
    layout: {
        sidebarWidth: 280,
        chatPanelWidth: 1.5,
        sidebarCollapsed: false,
        inspectorCollapsed: false,
    },
};
