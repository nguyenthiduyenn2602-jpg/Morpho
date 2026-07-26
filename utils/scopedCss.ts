// 限定作用域的用户自定义 CSS 校验 —— 气泡工坊（.sully-bubble-*）与心象卡片（.sully-psyche*）共用。
// 注意：这是编辑期软校验（语法检查 + 选择器作用域白名单），不做 XSS 级安全过滤；
// 注入端仍是原样 <style>，作用域白名单只为防止用户样式外溢污染整个应用。

export type CssValidationResult = {
    isValid: boolean;
    errors: string[];
    errorLines: number[];
    importantCount: number;
};

export const findLineNumberByIndex = (input: string, index: number) => input.slice(0, index).split('\n').length;

const extractLineFromErrorMessage = (message: string) => {
    const lineMatch = message.match(/line\s*(\d+)/i);
    return lineMatch ? parseInt(lineMatch[1], 10) : null;
};

/**
 * @param selectorRegex 非 @ 规则的每个选择器必须命中的白名单正则（如 /^\.sully-bubble-(user|ai)\b/）
 * @param scopeHint     报错文案里展示给用户看的作用域说明（如「.sully-bubble-user / .sully-bubble-ai」）
 */
export const validateScopedCss = (css: string, selectorRegex: RegExp, scopeHint: string): CssValidationResult => {
    const source = css || '';
    const errors: string[] = [];
    const errorLines: number[] = [];
    const pushError = (message: string, line?: number | null) => {
        errors.push(message);
        if (line && !Number.isNaN(line)) {
            errorLines.push(line);
        }
    };

    const importantCount = (source.match(/!important/g) || []).length;
    if (!source.trim()) {
        return { isValid: true, errors: [], errorLines: [], importantCount };
    }

    // Minimal syntax check 1: browser parser
    try {
        if (typeof CSSStyleSheet !== 'undefined') {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(source);
        }
    } catch (error: any) {
        pushError(`CSS 语法错误：${error?.message || '请检查语法。'}`, extractLineFromErrorMessage(error?.message || ''));
    }

    // Minimal syntax check 2: brace balance
    const braceStack: number[] = [];
    [...source].forEach((char, index) => {
        if (char === '{') braceStack.push(index);
        if (char === '}') {
            if (braceStack.length === 0) {
                pushError('发现多余的 `}`，请检查大括号闭合。', findLineNumberByIndex(source, index));
            } else {
                braceStack.pop();
            }
        }
    });
    braceStack.forEach(index => pushError('存在未闭合的 `{`，请补全规则块。', findLineNumberByIndex(source, index)));

    // Scope check（先去掉注释，避免 /* comment */ .selector 误报）
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRegex = /([^{}]+)\{/g;
    let selectorMatch = ruleRegex.exec(sourceWithoutComments);
    while (selectorMatch) {
        const selectorGroup = selectorMatch[1].trim();
        if (!selectorGroup.startsWith('@')) {
            const selectorList = selectorGroup.split(',').map(item => item.trim()).filter(Boolean);
            selectorList.forEach(selector => {
                if (!selectorRegex.test(selector)) {
                    pushError(
                        `选择器 \`${selector}\` 超出限定范围，仅允许以 ${scopeHint} 开头。`,
                        findLineNumberByIndex(sourceWithoutComments, selectorMatch!.index)
                    );
                }
            });
        }
        selectorMatch = ruleRegex.exec(sourceWithoutComments);
    }

    return {
        isValid: errors.length === 0,
        errors,
        errorLines,
        importantCount
    };
};

/** 把 CSS 真插进 <style> 数 cssRules，验证浏览器确实能渲染出规则 */
export const runCssRenderabilityCheck = (css: string, validation: CssValidationResult) => {
    if (!validation.isValid) {
        return {
            ok: false,
            message: `CSS 不可渲染：第 ${validation.errorLines[0] || '?'} 行附近存在错误，请先修复。`
        };
    }

    if (!css.trim()) {
        return { ok: true, message: '' };
    }

    try {
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
        const ruleCount = styleEl.sheet?.cssRules?.length ?? 0;
        styleEl.remove();
        if (ruleCount === 0) {
            return { ok: false, message: 'CSS 未生成有效规则，请确认语法和选择器。' };
        }
    } catch (error: any) {
        return { ok: false, message: `CSS 渲染检查失败：${error?.message || '未知错误。'}` };
    }

    return { ok: true, message: '' };
};
