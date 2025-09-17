// 深色模式切换功能
class DarkModeToggle {
    constructor() {
        this.themeToggleBtn = null;
        this.currentTheme = this.getStoredTheme() || 'dark'; // 默认使用深色模式
        this.observer = null;
        this.observerTimeout = null;
        this.init();
    }

    init() {
        this.applyTheme(this.currentTheme);
        this.createToggleButton();
        this.bindEvents();
        this.setupDOMObserver();
    }

    getStoredTheme() {
        return localStorage.getItem('theme');
    }

    setStoredTheme(theme) {
        if (theme) {
            localStorage.setItem('theme', theme);
        } else {
            localStorage.removeItem('theme');
        }
    }

    getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    applyTheme(theme) {
        const html = document.documentElement;
        
        if (theme === 'dark') {
            html.setAttribute('data-theme', 'dark');
            this.currentTheme = 'dark';
        } else {
            html.removeAttribute('data-theme');
            this.currentTheme = 'light';
        }
        
        this.setStoredTheme(theme);
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
    }

    createToggleButton() {
        const btn = document.createElement('button');
        btn.className = 'theme-toggle';
        btn.setAttribute('aria-label', '切换主题');
        btn.setAttribute('title', '切换明暗主题');
        
        btn.innerHTML = `
            <span class="sun-icon">☀️</span>
            <span class="moon-icon">🌙</span>
        `;
        
        document.body.appendChild(btn);
        this.themeToggleBtn = btn;
    }

    bindEvents() {
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => {
                this.toggleTheme();
            });
        }

        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!this.getStoredTheme()) { // 只有用户没有设置偏好时才跟随系统
                this.applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    setupDOMObserver() {
        // 监听DOM变化，确保动态生成的元素应用主题（优化版）
        this.observer = new MutationObserver((mutations) => {
            let needsUpdate = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    needsUpdate = true;
                    break;
                }
            }

            if (needsUpdate) {
                // 使用防抖避免频繁调用
                clearTimeout(this.observerTimeout);
                this.observerTimeout = setTimeout(() => {
                    this.applyThemeToDynamicElements();
                }, 50);
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    applyThemeToDynamicElements() {
        // 为动态生成的元素应用主题（优化版）
        const bgColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--bg-secondary').trim();
        const textColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-primary').trim();
        const borderColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--border-color').trim();

        const elementsToStyle = [
            '.toast',
            '.pool-card',
            '.random-info-card',
            '.completion-filter',
            '.favorite-filter',
            '.stats-info',
            '.stats-content span',
            '.completion-input'
        ];

        elementsToStyle.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const style = getComputedStyle(element);
                if (style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
                    style.backgroundColor === 'transparent') {
                    element.style.backgroundColor = bgColor;
                }
                if (style.color === 'rgb(0, 0, 0)' ||
                    style.color === 'rgba(0, 0, 0, 0)') {
                    element.style.color = textColor;
                }
                if (style.borderColor === 'rgba(0, 0, 0, 0)' ||
                    style.borderColor === 'transparent') {
                    element.style.borderColor = borderColor;
                }
            }
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    new DarkModeToggle();
});

// 导出供其他脚本使用
window.DarkModeToggle = DarkModeToggle;