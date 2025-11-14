const STORAGE_KEY_TEMPLATE = 'htmlhelper_template';
const STORAGE_KEY_VARIABLES = 'htmlhelper_variables';
const STORAGE_KEY_PREVIEW_BG = 'htmlhelper_preview_bg';
const STORAGE_KEY_EDITOR_HEIGHT = 'htmlhelper_editor_height';

function loadState() {
    const template = localStorage.getItem(STORAGE_KEY_TEMPLATE) || '';
    const variablesJson = localStorage.getItem(STORAGE_KEY_VARIABLES);
    const previewBackground = localStorage.getItem(STORAGE_KEY_PREVIEW_BG) || 'dark';
    const editorHeightRaw = localStorage.getItem(STORAGE_KEY_EDITOR_HEIGHT);
    let variables = {};
    let editorHeight = null;
    
    if (variablesJson) {
        try {
            variables = JSON.parse(variablesJson);
        } catch (e) {
            console.error('Failed to parse variables from localStorage:', e);
            variables = {};
        }
    }
    
    if (editorHeightRaw) {
        const parsed = parseInt(editorHeightRaw, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            editorHeight = parsed;
        }
    }
    
    return { template, variables, previewBackground, editorHeight };
}

function saveState(state) {
    if (Object.prototype.hasOwnProperty.call(state, 'template')) {
        localStorage.setItem(STORAGE_KEY_TEMPLATE, state.template);
    }
    if (Object.prototype.hasOwnProperty.call(state, 'variables')) {
        localStorage.setItem(STORAGE_KEY_VARIABLES, JSON.stringify(state.variables));
    }
    if (Object.prototype.hasOwnProperty.call(state, 'previewBackground')) {
        localStorage.setItem(STORAGE_KEY_PREVIEW_BG, state.previewBackground);
    }
    if (Object.prototype.hasOwnProperty.call(state, 'editorHeight')) {
        const value = state.editorHeight;
        if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
            localStorage.setItem(STORAGE_KEY_EDITOR_HEIGHT, String(value));
        } else {
            localStorage.removeItem(STORAGE_KEY_EDITOR_HEIGHT);
        }
    }
}

function resetState() {
    localStorage.removeItem(STORAGE_KEY_TEMPLATE);
    localStorage.removeItem(STORAGE_KEY_VARIABLES);
    localStorage.removeItem(STORAGE_KEY_PREVIEW_BG);
    localStorage.removeItem(STORAGE_KEY_EDITOR_HEIGHT);
}

