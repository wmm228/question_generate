import { DEFAULT_PERSISTED_STATE } from "./question-agent-workbench-types.js";
const STORAGE_PREFIX = "tutor_question_workbench_";
const STORAGE_VERSION = 12;
const STORAGE_KEY = `${STORAGE_PREFIX}state`;
const GUEST_AUTH_KEY = `${STORAGE_PREFIX}guest_auth`;
function canUseStorage() {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}
export function loadWorkbenchState() {
    if (!canUseStorage()) {
        return structuredClone(DEFAULT_PERSISTED_STATE);
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return structuredClone(DEFAULT_PERSISTED_STATE);
        }
        const wrapper = JSON.parse(raw);
        if (wrapper.version !== STORAGE_VERSION) {
            return structuredClone(DEFAULT_PERSISTED_STATE);
        }
        return {
            ...structuredClone(DEFAULT_PERSISTED_STATE),
            ...wrapper.data,
            requestDraft: {
                ...structuredClone(DEFAULT_PERSISTED_STATE.requestDraft),
                ...(wrapper.data.requestDraft || {}),
            },
            layout: {
                ...structuredClone(DEFAULT_PERSISTED_STATE.layout),
                ...(wrapper.data.layout || {}),
            },
        };
    }
    catch {
        return structuredClone(DEFAULT_PERSISTED_STATE);
    }
}
export function saveWorkbenchState(state) {
    if (!canUseStorage()) {
        return;
    }
    try {
        const wrapper = {
            version: STORAGE_VERSION,
            data: state,
            timestamp: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapper));
    }
    catch {
        return;
    }
}
export function loadSessionToken() {
    if (!canUseStorage()) {
        return "";
    }
    return localStorage.getItem("session_token") || "";
}
export function saveSessionToken(token) {
    if (!canUseStorage()) {
        return;
    }
    localStorage.setItem("session_token", token);
}
export function clearSessionToken() {
    if (!canUseStorage()) {
        return;
    }
    localStorage.removeItem("session_token");
}
export function clearGuestAuth() {
    if (!canUseStorage()) {
        return;
    }
    try {
        localStorage.removeItem(GUEST_AUTH_KEY);
    }
    catch {
        return;
    }
}
