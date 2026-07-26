let hasInstalledIOSStandaloneWorkaround = false;
let stableStandaloneHeight = 0;
// 安全区只在旋转 / 窗口尺寸变化时才变，缓存探测结果，避免 visualViewport 滚动、聚焦时反复同步重排。
// 上下各自独立缓存：某边读到非 0 才锁定；iOS 启动早期某边可能瞬时为 0，此时该边不锁、下次继续探测，
// 避免「一边真值、一边瞬时 0」被整体锁死（否则 home 条避让会失效，直到旋转/尺寸变化才恢复）。
let cachedTopInset: number | null = null;
let cachedBottomInset: number | null = null;

// 用一个隐藏探针同时读取上下安全区：单次插入 + 单次 getComputedStyle（一次 reflow）。
// env() 在本项目 iOS 全屏 PWA 下偶发返回 0，故需 JS 探测兜底。
export const readSafeAreaInsets = (): { top: number; bottom: number } => {
    if (typeof document === 'undefined' || !document.body) {
        return { top: cachedTopInset ?? 0, bottom: cachedBottomInset ?? 0 };
    }
    // 两边都已锁定有效值，直接用缓存，不再插探针重排。
    if (cachedTopInset !== null && cachedBottomInset !== null) {
        return { top: cachedTopInset, bottom: cachedBottomInset };
    }

    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.opacity = '0';
    probe.style.paddingTop = 'env(safe-area-inset-top)';
    probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
    document.body.appendChild(probe);

    const computed = window.getComputedStyle(probe);
    const top = Math.round(parseFloat(computed.paddingTop) || 0);
    const bottom = Math.round(parseFloat(computed.paddingBottom) || 0);

    document.body.removeChild(probe);

    // 各边只在读到非 0 时锁定；仍为 0 的边保持未缓存，下次事件继续探测，读到真值再锁。
    if (cachedTopInset === null && top > 0) cachedTopInset = top;
    if (cachedBottomInset === null && bottom > 0) cachedBottomInset = bottom;

    return { top: cachedTopInset ?? top, bottom: cachedBottomInset ?? bottom };
};

export const isIOSDevice = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const isStandaloneDisplayMode = (): boolean => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches || !!(window.navigator as Navigator & { standalone?: boolean }).standalone;
};

export const isIOSStandaloneWebApp = (): boolean => isIOSDevice() && isStandaloneDisplayMode();

// 安卓机（Chrome / Edge 等）。安卓普通浏览器弹软键盘时经常不按 interactive-widget=resizes-content
// 回流，而是缩小可视区、把整页往上顶（顶栏被切、退出重进才恢复）。需要和 iOS 全屏 PWA 一样，
// 让 app 高度跟随可视区并锁死外层滚动。
export const isAndroidDevice = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent || '');
};

// 顶部时钟/电量条是否隐藏：外观「隐藏顶部时间栏」开关显式设过就听用户的；没设过(undefined)按平台默认——
// iOS 全屏 PWA 系统状态栏(真实时间/电量)删不掉，默认隐藏 SullyOS 这条避免双显。
// 必须用 ?? 而非 ||：显式 false（用户主动要显示）不能被平台默认 true 盖掉。
// 只决定时钟/电量条；错误指示器、系统调试终端等与本开关无关，始终独立显示。
export const isStatusBarHidden = (
    hideStatusBar?: boolean,
    platformDefaultHidden: boolean = isIOSStandaloneWebApp(),
): boolean => hideStatusBar ?? platformDefaultHidden;

const isTextEntryElement = (target: EventTarget | null): target is HTMLElement => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const setViewportVars = () => {
    if (typeof document === 'undefined') return;
    const shouldStabilizeHeight = isIOSStandaloneWebApp();
    const innerHeight = Math.round(window.innerHeight);
    const viewportHeight = Math.round(window.visualViewport?.height || innerHeight);
    const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop || 0);
    // 单次探针读取上下安全区。顶部 env 偶发返回 0，探测不到时退回 44px（约状态栏/刘海高度），避免顶栏内容怼进刘海。
    const safeInsets = shouldStabilizeHeight ? readSafeAreaInsets() : { top: 0, bottom: 0 };
    const bottomSafeInset = safeInsets.bottom;
    const topSafeInset = shouldStabilizeHeight ? (safeInsets.top > 0 ? safeInsets.top : 44) : 0;

    let fullAppHeight: number;
    let keyboardInset: number;

    if (shouldStabilizeHeight) {
        // 全屏 PWA 没有地址栏，可视高度只在软键盘弹出时变矮。基线取「见过的最大可视高度」。
        if (!stableStandaloneHeight || viewportHeight > stableStandaloneHeight) {
            stableStandaloneHeight = viewportHeight;
        }
        // 键盘态判据用「可视高度变矮」而非 obscuredHeight：iOS 26 起 standalone 会把 layout viewport 也一起缩，
        // innerHeight 跟着变矮，obscuredHeight 算出来是 0 而失效。viewportHeight > 150 是对 iOS 偶发脏值的护栏——
        // 键盘动画期 visualViewport 偶尔报错值，此时退化成「无键盘态」，宁可不避让也不要把布局撑崩成满屏白。
        const keyboardOpen = viewportHeight > 150 && viewportHeight < stableStandaloneHeight - 100;
        // 键盘态：app 高度收到当前可视区（home 条已被键盘盖，不再叠加 safe）；无键盘态：基线 + safe（底部给 home 条留位）。
        fullAppHeight = keyboardOpen ? viewportHeight : stableStandaloneHeight + bottomSafeInset;
        // standalone 下键盘避让改由「app 高度跟随可视区」统一处理，keyboard-inset 置 0，避免 CallApp 等再叠一层 padding。
        keyboardInset = 0;
        // iOS 26 键盘弹出会把整页顶上去（visualViewport.offsetTop > 0），拉回顶部对齐可视区；
        // 配合 ios-keyboard-open 下的 touchmove 拦截（见 installIOSStandaloneWorkaround），把外层滚动彻底锁死。
        if (keyboardOpen && viewportOffsetTop > 0) {
            window.scrollTo(0, 0);
        }
    } else {
        stableStandaloneHeight = 0;
        // obscuredHeight = 被软键盘盖住的高度。安卓浏览器若按 resizes-content 回流，
        // innerHeight 会跟着缩，obscuredHeight ≈ 0（走无键盘分支，布局自行回流，什么都不用做）；
        // 若不回流而是缩小可视区/顶起整页，obscuredHeight > 120，进入键盘分支统一避让。
        const obscuredHeight = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
        const keyboardOpen = obscuredHeight > 120;
        // 键盘避让统一用「app 高度跟随可视区」，不再靠 keyboard-inset 让各 App 自己叠 padding。
        keyboardInset = 0;
        if (keyboardOpen) {
            // 安卓 Chrome/Edge：app 高度收到键盘上方的可视区，输入框自然落在可视区内；
            // 再把被浏览器顶起的外层滚动拉回顶部（配合 body.ios-keyboard-open 的 touchmove 锁定），
            // 界面不再整体上移、退出重进才恢复。
            fullAppHeight = viewportHeight;
            if (viewportOffsetTop > 0) window.scrollTo(0, 0);
        } else {
            fullAppHeight = Math.max(innerHeight, viewportHeight + viewportOffsetTop);
        }
    }

    document.documentElement.style.setProperty('--app-height', `${fullAppHeight}px`);
    document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
    document.documentElement.style.setProperty('--standalone-safe-area-bottom', `${bottomSafeInset}px`);
    document.documentElement.style.setProperty('--standalone-safe-area-top', `${topSafeInset}px`);
};

export const installIOSStandaloneWorkaround = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (hasInstalledIOSStandaloneWorkaround) return;

    hasInstalledIOSStandaloneWorkaround = true;
    const useStandaloneFixes = isIOSStandaloneWebApp();
    // iOS 全屏 PWA 与安卓浏览器都需要「聚焦挂 keyboard 类 + 锁外层滚动」这套键盘避让。
    // 安卓 Chrome/Edge 弹键盘时会把整页顶起，同样靠这套压回去。
    const useKeyboardFixes = useStandaloneFixes || isAndroidDevice();
    if (useStandaloneFixes) {
        document.documentElement.classList.add('ios-standalone');
        document.body.classList.add('ios-standalone');
    }

    const handleViewportChange = () => {
        setViewportVars();
    };

    // 只有旋转 / 窗口尺寸变化才真的改变安全区：让缓存失效后重新探测（滚动、聚焦走缓存，不再重排）。
    const handleSafeAreaChange = () => {
        cachedTopInset = null;
        cachedBottomInset = null;
        setViewportVars();
    };

    const handleFocusIn = (event: FocusEvent) => {
        if (!isTextEntryElement(event.target)) return;
        document.body.classList.add('ios-keyboard-open');
        setViewportVars();

        const target = event.target;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (document.activeElement !== target) return;
                try {
                    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } catch {
                    // Ignore scroll failures on older iOS builds.
                }
            });
        });
    };

    const handleFocusOut = () => {
        window.setTimeout(() => {
            if (!isTextEntryElement(document.activeElement)) {
                document.body.classList.remove('ios-keyboard-open');
            }
            setViewportVars();
        }, 180);
    };

    // 键盘弹出时锁死外层滚动：只放行可滚区（消息列表等 .overflow-y-auto）内部滚动，其余 touchmove 一律拦掉。
    // 不锁的话 iOS 会在输入框聚焦时随手势把整页顶飞（visualViewport.offsetTop 漂移、露出底层色块、闪烁）。
    const handleTouchMove = (event: TouchEvent) => {
        if (!document.body.classList.contains('ios-keyboard-open')) return;
        const target = event.target as Element | null;
        if (target?.closest('.overflow-y-auto')) return;
        event.preventDefault();
    };

    window.addEventListener('resize', handleSafeAreaChange);
    window.addEventListener('orientationchange', handleSafeAreaChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    if (useKeyboardFixes) {
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('focusout', handleFocusOut);
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
    }
    setViewportVars();

    // iOS standalone 冷启动时 env() / JS probe 偶发都给 0；resize / orientationchange 整场可能都不触发，
    // 缓存就会被锁在 0，底部控件整场贴 home 条。这里在启动后阶梯式重探几次，遇到任一边还没锁定就再试。
    if (useStandaloneFixes) {
        const RETRY_DELAYS_MS = [120, 500, 1500, 3000];
        for (const delay of RETRY_DELAYS_MS) {
            window.setTimeout(() => {
                if (cachedTopInset !== null && cachedBottomInset !== null) return; // 两边都已锁定，无需再试
                setViewportVars();
            }, delay);
        }
    }
};
