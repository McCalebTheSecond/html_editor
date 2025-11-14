(function() {
    'use strict';

    const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const DEBOUNCE_MS = 200;

    const templateEl = document.getElementById('template');
    const variablesTbody = document.getElementById('variables-tbody');
    const variablesTable = document.getElementById('variables-table');
    const addVariableBtn = document.getElementById('add-variable');
    const resetBtn = document.getElementById('reset');
    const copyPreviewBtn = document.getElementById('copy-preview');
    const previewEl = document.getElementById('preview');
    const previewOverlay = document.getElementById('preview-overlay');
    const divider = document.getElementById('divider');
    const leftPanel = document.querySelector('.left-panel');
    const editorSection = document.querySelector('.editor-section');
    const variablesSection = document.querySelector('.variables-section');
    const editorResizeHandle = document.getElementById('editor-resize-handle');
    const previewBackgroundToggle = document.getElementById('preview-background-toggle');
    const container = document.querySelector('.container');
    const mobileViewToolbar = document.querySelector('.mobile-view-toolbar');
    const mobileViewButtons = mobileViewToolbar ? Array.from(mobileViewToolbar.querySelectorAll('.mobile-view-button')) : [];

    function getPreviewBaseStyles(bodyBackground) {
        return `
        <style>
            html {
                background: transparent;
                color: inherit;
                margin: 0;
            }
            body {
                background: ${bodyBackground};
                color: inherit;
                margin: 0;
                padding: 0.5rem;
            }
        </style>
    `;
    }
    const PREVIEW_BG_ICON = {
        dark: '<svg class="moon-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/></svg>',
        light: '<svg class="sun-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    };
    const COPY_LABEL = 'Copy';
    const COPIED_LABEL = 'Copied!';
    const COPY_PREVIEW_LABEL = 'Copy preview';
    const COPY_PREVIEW_COPIED_LABEL = 'Copied!';

    let variableRows = [];
    let lastValidRender = '';
    let previewBackground = 'dark';
    let editor = null;
    let viewMode = 'split';

    const CLIPBOARD_FRAGMENT_START = '<!--StartFragment-->';
    const CLIPBOARD_FRAGMENT_END = '<!--EndFragment-->';
    const HTML_TAG_REGEX = /<\s*\/?\s*([a-z0-9-]+)(?:\s+[^>]*)?>/i;
    const VOID_HTML_ELEMENTS = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'
    ]);
    const PRESERVE_WHITESPACE_TAGS = new Set(['pre', 'code', 'textarea']);
    const HTML_INDENT = '    ';
    const DEFAULT_TAB_SIZE = 4;
    const VIEW_MODES = new Set(['edit', 'split', 'preview']);

    const TRIPLE_VAR_PATTERN = /\{\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}\}/;
    const DOUBLE_VAR_PATTERN = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/;
    
    const templateVariableOverlay = {
        token(stream) {
            if (stream.match(TRIPLE_VAR_PATTERN)) {
                return 'template-variable';
            }
            if (stream.match(DOUBLE_VAR_PATTERN)) {
                return 'template-variable';
            }
            stream.next();
            return null;
        }
    };

    function extractClipboardHtml(html) {
        if (!html || typeof html !== 'string') {
            return '';
        }

        let fragment = html;
        const startIdx = fragment.indexOf(CLIPBOARD_FRAGMENT_START);
        const endIdx = fragment.indexOf(CLIPBOARD_FRAGMENT_END);
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            fragment = fragment.slice(startIdx + CLIPBOARD_FRAGMENT_START.length, endIdx);
        }

        fragment = fragment.trim();
        if (!fragment) {
            return '';
        }

        if (typeof DOMParser !== 'undefined') {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(fragment, 'text/html');
                if (doc && doc.body) {
                    const bodyContent = doc.body.innerHTML.trim();
                    if (bodyContent) {
                        return bodyContent;
                    }
                }
            } catch (err) {
                console.warn('Failed to parse clipboard HTML fragment', err);
            }
        }

        return fragment;
    }

    function looksLikeHtmlMarkup(text) {
        if (!text || typeof text !== 'string') {
            return false;
        }
        return HTML_TAG_REGEX.test(text.trim());
    }

    function buildAttributeString(node) {
        if (!node || !node.attributes || node.attributes.length === 0) {
            return '';
        }

        const attrs = [];
        for (let i = 0; i < node.attributes.length; i++) {
            const attr = node.attributes[i];
            if (!attr || !attr.name) continue;
            if (attr.value === '') {
                attrs.push(attr.name);
            } else {
                const safeValue = attr.value.replace(/"/g, '&quot;');
                attrs.push(`${attr.name}="${safeValue}"`);
            }
        }
        return attrs.join(' ');
    }

    function formatNode(node, depth, preserveWhitespace, lines) {
        if (!node) {
            return;
        }

        const indent = HTML_INDENT.repeat(depth);
        const nodeType = node.nodeType;

        if (nodeType === Node.TEXT_NODE) {
            const rawText = node.textContent || '';
            const textValue = preserveWhitespace ? rawText : rawText.trim();
            if (textValue) {
                if (preserveWhitespace) {
                    lines.push(textValue);
                } else {
                    lines.push(`${indent}${textValue}`);
                }
            }
            return;
        }

        if (nodeType === Node.COMMENT_NODE) {
            const commentValue = node.textContent;
            if (commentValue && commentValue.trim()) {
                lines.push(`${indent}<!-- ${commentValue.trim()} -->`);
            }
            return;
        }

        if (nodeType !== Node.ELEMENT_NODE) {
            const fallback = node.textContent && node.textContent.trim();
            if (fallback) {
                lines.push(`${indent}${fallback}`);
            }
            return;
        }

        const tag = node.tagName.toLowerCase();
        const attrs = buildAttributeString(node);
        const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
        const isVoid = VOID_HTML_ELEMENTS.has(tag);
        const isPreserve = PRESERVE_WHITESPACE_TAGS.has(tag);
        const childPreserve = preserveWhitespace || isPreserve;

        lines.push(`${indent}${openTag}`);

        if (isVoid) {
            return;
        }

        if (isPreserve) {
            const innerContent = node.innerHTML;
            if (innerContent) {
                lines.push(innerContent);
            }
            lines.push(`${indent}</${tag}>`);
            return;
        }

        const childNodes = Array.from(node.childNodes || []);
        if (childNodes.length === 0) {
            lines.push(`${indent}</${tag}>`);
            return;
        }

        childNodes.forEach(child => formatNode(child, depth + 1, childPreserve, lines));
        lines.push(`${indent}</${tag}>`);
    }

    function formatHtmlContent(html) {
        if (!html || !looksLikeHtmlMarkup(html) || typeof document === 'undefined') {
            return html;
        }

        try {
            const container = document.createElement('div');
            container.innerHTML = html.trim();
            const lines = [];
            Array.from(container.childNodes || []).forEach(node => {
                formatNode(node, 0, false, lines);
            });
            const formatted = lines.join('\n').trim();
            return formatted || html;
        } catch (err) {
            console.warn('Failed to format HTML content', err);
            return html;
        }
    }

    function getPastedContent(event) {
        if (!event || !event.clipboardData) {
            return null;
        }

        const plainText = event.clipboardData.getData('text/plain') || event.clipboardData.getData('Text') || '';
        const htmlData = event.clipboardData.getData('text/html');

        const plainTextLooksLikeHtml = looksLikeHtmlMarkup(plainText);
        const htmlFragment = extractClipboardHtml(htmlData);
        const formattedHtml = htmlFragment ? formatHtmlContent(htmlFragment) : '';

        if (formattedHtml && !plainTextLooksLikeHtml) {
            return formattedHtml;
        }

        if (plainText) {
            return plainText;
        }

        if (formattedHtml) {
            return formattedHtml;
        }

        return null;
    }

    function handleCodeMirrorPaste(cm, event) {
        const content = getPastedContent(event);
        if (!content) {
            return;
        }

        event.preventDefault();
        cm.replaceSelection(content, 'around', 'paste');
    }

    function handleTextareaPaste(event) {
        const content = getPastedContent(event);
        if (!content) {
            return;
        }

        event.preventDefault();

        const target = event.target;
        if (!target || typeof target.value !== 'string') {
            return;
        }

        const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
        const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
        const before = target.value.slice(0, start);
        const after = target.value.slice(end);
        target.value = before + content + after;
        const cursorPos = before.length + content.length;

        if (typeof target.setSelectionRange === 'function') {
            target.setSelectionRange(cursorPos, cursorPos);
        }

        handleTemplateChange();
    }

    function measureIndentColumns(text, tabSize = DEFAULT_TAB_SIZE) {
        if (!text) return 0;
        const effectiveTab = typeof tabSize === 'number' && tabSize > 0 ? tabSize : DEFAULT_TAB_SIZE;
        let columns = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === ' ') {
                columns += 1;
            } else if (char === '\t') {
                columns += effectiveTab;
            } else {
                break;
            }
        }
        return columns;
    }

    function getTemplateValue() {
        return editor ? editor.getValue() : templateEl.value;
    }

    function setTemplateValue(value) {
        if (editor) {
            editor.setValue(value || '');
        } else {
            templateEl.value = value || '';
        }
    }

    function syncVariablesHeaderOffset() {
        if (!variablesTable || !variablesTbody) return;
        const scrollWidth = variablesTbody.offsetWidth - variablesTbody.clientWidth;
        const value = scrollWidth > 0 ? `${scrollWidth}px` : '0px';
        variablesTable.style.setProperty('--variables-scrollbar-offset', value);
    }

    function debounce(fn, wait) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    }

    function validateKey(key) {
        const trimmed = key.trim();
        if (!trimmed) {
            return { valid: false, reason: 'empty' };
        }
        if (!KEY_PATTERN.test(trimmed)) {
            return { valid: false, reason: 'invalid' };
        }
        return { valid: true, trimmed };
    }

    function checkDuplicates() {
        const keyCounts = {};
        const trimmedKeys = {};
        
        variableRows.forEach((row, idx) => {
            const input = row.keyInput;
            const trimmed = input.value.trim();
            trimmedKeys[idx] = trimmed;
            if (trimmed && KEY_PATTERN.test(trimmed)) {
                keyCounts[trimmed] = (keyCounts[trimmed] || 0) + 1;
            }
        });

        const duplicates = new Set();
        Object.entries(keyCounts).forEach(([key, count]) => {
            if (count > 1) {
                duplicates.add(key);
            }
        });

        variableRows.forEach((row, idx) => {
            const trimmed = trimmedKeys[idx];
            if (trimmed && duplicates.has(trimmed)) {
                row.keyInput.classList.add('duplicate');
            } else {
                row.keyInput.classList.remove('duplicate');
            }
        });

        return duplicates.size === 0;
    }

    function validateAll() {
        let allValid = true;
        
        variableRows.forEach(row => {
            const input = row.keyInput;
            const trimmed = input.value.trim();
            
            input.classList.remove('invalid', 'duplicate');
            
            if (trimmed) {
                const validation = validateKey(trimmed);
                if (!validation.valid) {
                    input.classList.add('invalid');
                    allValid = false;
                }
            }
        });

        const noDuplicates = checkDuplicates();
        return allValid && noDuplicates;
    }

    function buildVariablesObject() {
        const vars = {};
        variableRows.forEach(row => {
            const key = row.keyInput.value.trim();
            const value = row.valueInput.value;
            if (key && KEY_PATTERN.test(key)) {
                vars[key] = value;
            }
        });
        return vars;
    }

    function saveCurrentState() {
        saveState({
            template: getTemplateValue(),
            variables: buildVariablesObject(),
            previewBackground,
            editorHeight: getEditorHeightPreference(),
            viewMode
        });
    }

    function setPreviewBackground(mode, { persist = false, refresh = false } = {}) {
        const normalized = mode === 'light' ? 'light' : 'dark';
        previewBackground = normalized;
        previewEl.classList.toggle('preview-light', normalized === 'light');

        if (previewBackgroundToggle) {
            const icon = PREVIEW_BG_ICON[normalized] || PREVIEW_BG_ICON.dark;
            const targetLabel = normalized === 'light' ? 'Switch to dark background' : 'Switch to white background';
            previewBackgroundToggle.innerHTML = icon;
            previewBackgroundToggle.setAttribute('aria-label', targetLabel);
            previewBackgroundToggle.setAttribute('title', targetLabel);
        }

        if (persist) {
            saveState({ previewBackground: normalized });
        }

        if (refresh) {
            updatePreview();
        }
    }

    function applyPreviewShell(content) {
        const trimmed = content.trim();
        const hasHtmlTag = /<\s*html[\s>]/i.test(trimmed);
        const hasBodyTag = /<\s*body[\s>]/i.test(trimmed);

        if (hasHtmlTag || hasBodyTag) {
            return content || '';
        }

        const bodyBackground = previewBackground === 'light' ? 'transparent' : '#141414';
        const previewStyles = getPreviewBaseStyles(bodyBackground);
        return `<!DOCTYPE html><html><head>${previewStyles}</head><body>${content || ''}</body></html>`;
    }

    function updatePreview() {
        if (!validateAll()) {
            previewOverlay.classList.remove('hidden');
            updateCopyPreviewButtonState();
            return;
        }

        previewOverlay.classList.add('hidden');
        
        const template = getTemplateValue();
        const vars = buildVariablesObject();
        const rendered = renderTemplate(template, vars);
        
        const previewMarkup = applyPreviewShell(rendered);

        previewEl.setAttribute('srcdoc', previewMarkup);
        lastValidRender = previewMarkup;
        updateCopyPreviewButtonState();
    }

    const debouncedUpdatePreview = debounce(updatePreview, DEBOUNCE_MS);

    function updateCopyPreviewButtonState() {
        if (!copyPreviewBtn) return;
        const hasValidRender = !!lastValidRender && previewOverlay.classList.contains('hidden');
        copyPreviewBtn.disabled = !hasValidRender;
    }

    function applyViewModeClass(mode) {
        if (!container) return;
        container.classList.remove('mode-edit', 'mode-split', 'mode-preview');
        container.classList.add(`mode-${mode}`);
    }

    function updateMobileToolbar(mode) {
        if (!mobileViewButtons || mobileViewButtons.length === 0) return;
        mobileViewButtons.forEach(button => {
            const buttonMode = button.dataset.viewMode;
            const isActive = buttonMode === mode;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    function setViewMode(mode, { persist = true } = {}) {
        const nextMode = VIEW_MODES.has(mode) ? mode : 'split';
        viewMode = nextMode;
        applyViewModeClass(nextMode);
        updateMobileToolbar(nextMode);
        if (persist) {
            saveState({ viewMode: nextMode });
        }
        if (editor && nextMode !== 'preview') {
            setTimeout(() => editor.refresh(), 50);
        }
    }

    let copyPreviewResetTimer = null;

    function indicateCopySuccess() {
        clearTimeout(copyPreviewResetTimer);
        copyPreviewBtn.textContent = COPY_PREVIEW_COPIED_LABEL;
        copyPreviewResetTimer = setTimeout(() => {
            copyPreviewBtn.textContent = COPY_PREVIEW_LABEL;
        }, 1500);
    }

    async function copyPreviewContent() {
        if (!lastValidRender || copyPreviewBtn.disabled) return;

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(lastValidRender, 'text/html');
            const bodyContent = doc.body ? doc.body.innerHTML : '';

            if (!bodyContent) {
                console.warn('No body content to copy');
                return;
            }

            const tempDiv = document.createElement('div');
            tempDiv.contentEditable = 'true';
            tempDiv.style.position = 'fixed';
            tempDiv.style.left = '-9999px';
            tempDiv.style.top = '-9999px';
            tempDiv.innerHTML = bodyContent;
            document.body.appendChild(tempDiv);

            const range = document.createRange();
            range.selectNodeContents(tempDiv);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            let copySuccess = false;
            try {
                copySuccess = document.execCommand('copy');
            } catch (err) {
                console.warn('execCommand copy failed, trying clipboard API', err);
            }

            selection.removeAllRanges();
            document.body.removeChild(tempDiv);

            if (!copySuccess && navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    const tempDiv2 = document.createElement('div');
                    tempDiv2.innerHTML = bodyContent;
                    const plainText = tempDiv2.textContent || tempDiv2.innerText || '';
                    await navigator.clipboard.writeText(plainText);
                    copySuccess = true;
                } catch (err) {
                    console.error('Clipboard API copy failed', err);
                }
            }

            if (copySuccess) {
                indicateCopySuccess();
            }
        } catch (err) {
            console.error('Failed to copy preview content', err);
        }
    }

    if (typeof ResizeObserver !== 'undefined' && variablesTbody) {
        const variablesResizeObserver = new ResizeObserver(syncVariablesHeaderOffset);
        variablesResizeObserver.observe(variablesTbody);
    }
    window.addEventListener('resize', syncVariablesHeaderOffset);

    function createVariableRow(key = '', value = '') {
        const tr = document.createElement('tr');
        
        const keyTd = document.createElement('td');
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.value = key;
        keyInput.placeholder = 'variable_name';
        keyTd.appendChild(keyInput);
        
        const valueTd = document.createElement('td');
        const valueInput = document.createElement('textarea');
        valueInput.value = value;
        valueInput.placeholder = 'Value';
        valueTd.appendChild(valueInput);
        
        const actionsTd = document.createElement('td');
        actionsTd.className = 'actions-cell';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy';
        copyBtn.textContent = COPY_LABEL;
        copyBtn.disabled = true;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove';
        removeBtn.textContent = 'Remove';
        actionsTd.appendChild(copyBtn);
        actionsTd.appendChild(removeBtn);
        
        tr.appendChild(keyTd);
        tr.appendChild(valueTd);
        tr.appendChild(actionsTd);
        
        const row = {
            element: tr,
            keyInput: keyInput,
            valueInput: valueInput,
            removeBtn: removeBtn,
            copyBtn: copyBtn,
            copyResetTimer: null
        };

        function updateCopyState() {
            const hasKey = !!row.keyInput.value.trim();
            const hasValue = !!row.valueInput.value.trim();
            row.copyBtn.disabled = !(hasKey && hasValue);
            if (row.copyBtn.disabled) {
                row.copyBtn.textContent = COPY_LABEL;
                clearTimeout(row.copyResetTimer);
            }
        }

        function indicateCopySuccess() {
            clearTimeout(row.copyResetTimer);
            row.copyBtn.textContent = COPIED_LABEL;
            row.copyResetTimer = setTimeout(() => {
                row.copyBtn.textContent = COPY_LABEL;
            }, 1500);
        }
        
        keyInput.addEventListener('input', () => {
            validateAll();
            updateCopyState();
            debouncedUpdatePreview();
            saveCurrentState();
        });
        
        valueInput.addEventListener('input', () => {
            updateCopyState();
            debouncedUpdatePreview();
            saveCurrentState();
        });

        copyBtn.addEventListener('click', async () => {
            if (copyBtn.disabled) return;
            const key = row.keyInput.value.trim();
            const snippet = `{{ ${key} }}`;
            try {
                await navigator.clipboard.writeText(snippet);
                indicateCopySuccess();
            } catch (err) {
                console.error('Clipboard copy failed', err);
            }
        });

        updateCopyState();
        
        removeBtn.addEventListener('click', () => {
            const idx = variableRows.indexOf(row);
            if (idx > -1) {
                clearTimeout(row.copyResetTimer);
                variableRows.splice(idx, 1);
                tr.remove();
                validateAll();
                debouncedUpdatePreview();
                saveCurrentState();
                syncVariablesHeaderOffset();
            }
        });
        
        return row;
    }

    function addVariableRow(key = '', value = '') {
        const row = createVariableRow(key, value);
        variableRows.push(row);
        variablesTbody.appendChild(row.element);
        syncVariablesHeaderOffset();
        return row;
    }

    function loadVariablesIntoUI(vars) {
        variableRows = [];
        variablesTbody.innerHTML = '';
        
        const entries = Object.entries(vars);
        if (entries.length === 0) {
            addVariableRow();
        } else {
            entries.forEach(([key, value]) => {
                addVariableRow(key, value);
            });
        }
        syncVariablesHeaderOffset();
    }

    function applyEditorHeightPreference(height) {
        if (!editorSection || !variablesSection) return;

        if (typeof height === 'number' && !Number.isNaN(height) && height > 0) {
            editorSection.style.flex = '0 0 auto';
            editorSection.style.height = `${height}px`;
            variablesSection.style.flex = '1 1 auto';
        } else {
            editorSection.style.flex = '';
            editorSection.style.height = '';
            variablesSection.style.flex = '';
        }
        
        if (editor) {
            editor.refresh();
        }
    }

    function getEditorHeightPreference() {
        if (!editorSection) return null;
        const value = parseInt(editorSection.style.height, 10);
        if (!Number.isNaN(value) && value > 0) {
            return value;
        }
        return null;
    }

    function initializeEditorResize() {
        if (!editorResizeHandle || !editorSection || !variablesSection) return;

        let isDragging = false;
        let startY = 0;
        let startHeight = 0;
        let totalFlexibleHeight = 0;
        const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;

        function startDrag(e) {
            if (isMobileViewport()) {
                return;
            }
            isDragging = true;
            startY = (e.touches && e.touches[0].clientY) || e.clientY;
            const editorRect = editorSection.getBoundingClientRect();
            const variablesRect = variablesSection.getBoundingClientRect();
            startHeight = editorRect.height;
            totalFlexibleHeight = editorRect.height + variablesRect.height;
            editorResizeHandle.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        }

        function drag(e) {
            if (!isDragging) return;
            const currentY = (e.touches && e.touches[0].clientY) || e.clientY;
            const diff = currentY - startY;
            const desiredHeight = startHeight + diff;
            const MIN_EDITOR = 120;
            const MIN_VARIABLES = 180;
            const maxEditor = Math.max(MIN_EDITOR, totalFlexibleHeight - MIN_VARIABLES);
            const clampedHeight = Math.max(MIN_EDITOR, Math.min(maxEditor, desiredHeight));

            applyEditorHeightPreference(clampedHeight);
            e.preventDefault();
        }

        function stopDrag() {
            if (!isDragging) return;
            isDragging = false;
            editorResizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const height = getEditorHeightPreference();
            saveState({ editorHeight: height });
            syncVariablesHeaderOffset();
        }

        editorResizeHandle.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDrag);

        editorResizeHandle.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', stopDrag);

        editorResizeHandle.addEventListener('dblclick', () => {
            applyEditorHeightPreference(null);
            saveState({ editorHeight: null });
            syncVariablesHeaderOffset();
        });
    }

    function initializeDivider() {
        let isDragging = false;
        let startX = 0;
        let startWidth = 0;

        function startDrag(e) {
            isDragging = true;
            startX = e.clientX || (e.touches && e.touches[0].clientX);
            startWidth = leftPanel.offsetWidth;
            divider.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        }

        function drag(e) {
            if (!isDragging) return;
            const currentX = e.clientX || (e.touches && e.touches[0].clientX);
            const diff = currentX - startX;
            const containerWidth = document.querySelector('.container').offsetWidth;
            const newWidth = startWidth + diff;
            
            // Get computed minimum width from CSS (400px)
            const computedStyle = window.getComputedStyle(leftPanel);
            const minWidth = parseInt(computedStyle.minWidth) || 400;
            const maxWidth = containerWidth * 0.8; // 80% max-width
            
            // Clamp the width between min and max
            const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            const percentage = (clampedWidth / containerWidth) * 100;
            
            leftPanel.style.flexBasis = percentage + '%';
            e.preventDefault();
        }

        function stopDrag() {
            if (!isDragging) return;
            isDragging = false;
            divider.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (editor) {
                editor.refresh();
            }
        }

        divider.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDrag);
        
        divider.addEventListener('touchstart', startDrag);
        document.addEventListener('touchmove', drag);
        document.addEventListener('touchend', stopDrag);
    }

    addVariableBtn.addEventListener('click', () => {
        addVariableRow();
        const lastRow = variableRows[variableRows.length - 1];
        lastRow.keyInput.focus();
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('Reset all data? This will clear the template and all variables.')) {
            resetState();
            setTemplateValue('');
            loadVariablesIntoUI({});
            setPreviewBackground('dark', { persist: true });
            applyEditorHeightPreference(null);
            updatePreview();
        }
    });

    if (copyPreviewBtn) {
        copyPreviewBtn.addEventListener('click', copyPreviewContent);
    }

    if (previewBackgroundToggle) {
        previewBackgroundToggle.addEventListener('click', () => {
            const nextMode = previewBackground === 'light' ? 'dark' : 'light';
            setPreviewBackground(nextMode, { persist: true, refresh: true });
        });
    }

    if (mobileViewButtons && mobileViewButtons.length) {
        mobileViewButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetMode = button.dataset.viewMode || 'split';
                setViewMode(targetMode);
            });
        });
    }

    function handleTemplateChange() {
        debouncedUpdatePreview();
        saveCurrentState();
    }

    function init() {
        const state = loadState();
        setTemplateValue(state.template || '');
        
        if (window.CodeMirror) {
            editor = CodeMirror.fromTextArea(templateEl, {
                mode: 'text/html',
                htmlMode: true,
                lineNumbers: true,
                lineWrapping: true,
                theme: 'twilight',
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                extraKeys: {
                    'Tab': function(cm) {
                        if (cm.somethingSelected()) {
                            cm.indentSelection('add');
                        } else {
                            cm.replaceSelection('    ', 'end', '+input');
                        }
                    },
                    'Shift-Tab': function(cm) {
                        cm.indentSelection('subtract');
                    }
                }
            });
            editor.addOverlay(templateVariableOverlay);
            editor.on('change', handleTemplateChange);
            editor.on('paste', handleCodeMirrorPaste);
            editor.on('renderLine', (cm, line, element) => {
                const tabSize = cm.getOption('tabSize') || DEFAULT_TAB_SIZE;
                const indentColumns = measureIndentColumns(line.text, tabSize);
                if (indentColumns > 0) {
                    const indentCh = `${indentColumns}ch`;
                    element.style.paddingLeft = indentCh;
                    element.style.textIndent = `-${indentCh}`;
                } else {
                    element.style.paddingLeft = '';
                    element.style.textIndent = '';
                }
            });
            editor.refresh();
        } else {
            templateEl.addEventListener('input', handleTemplateChange);
            templateEl.addEventListener('paste', handleTextareaPaste);
        }
        
        loadVariablesIntoUI(state.variables);
        setPreviewBackground(state.previewBackground || 'dark');
        setViewMode(state.viewMode || 'split', { persist: false });
        applyEditorHeightPreference(state.editorHeight);
        initializeDivider();
        initializeEditorResize();
        syncVariablesHeaderOffset();
        updatePreview();
        updateCopyPreviewButtonState();
        
        if (editor) {
            editor.refresh();
        }
    }

    init();
})();

