// 暂存面板组件
(function (window, document) {
    class DraftPanel {
        constructor(options = {}) {
            this.sessionId = options.sessionId || '';
            this.socket = options.socket || null;
            this.onSelectDraft = options.onSelectDraft || null;

            // DOM元素
            this.fab = document.getElementById('draftFab');
            this.badge = document.getElementById('draftBadge');
            this.panel = document.getElementById('draftPanel');
            this.list = document.getElementById('draftList');
            this.clearBtn = document.getElementById('draftClearBtn');

            // 状态
            this.drafts = [];
            this.isOpen = false;

            // 本地存储key
            this.storageKey = 'review_drafts';

            this.init();
        }

        init() {
            if (!this.fab || !this.panel) {
                console.warn('DraftPanel: 缺少必要DOM元素');
                return;
            }

            // 加载本地暂存
            this.loadFromStorage();

            // 绑定事件
            this.bindEvents();

            // 更新UI
            this.updateBadge();
            this.renderList();

            // 监听WebSocket同步
            if (this.socket) {
                this.setupSocketListeners();
            }
        }

        bindEvents() {
            // 悬浮按钮点击
            this.fab?.addEventListener('click', () => this.toggle());

            // 清空按钮
            this.clearBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearAll();
            });

            // 点击外部关闭面板
            document.addEventListener('click', (e) => {
                if (this.isOpen && !this.panel?.contains(e.target) && !this.fab?.contains(e.target)) {
                    this.close();
                }
            });

            // ESC键关闭
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            });
        }

        setupSocketListeners() {
            console.log('[DraftPanel] setupSocketListeners - this.socket:', this.socket);
            console.log('[DraftPanel] setupSocketListeners - this.socket类型:', typeof this.socket);
            console.log('[DraftPanel] setupSocketListeners - this.socket.on是否存在:', typeof this.socket.on);

            if (!this.socket || typeof this.socket.on !== 'function') {
                console.error('[DraftPanel] socket 对象无效或缺少 on 方法');
                return;
            }

            // 接收其他设备的暂存更新
            this.socket.on('draft_update', (draft) => {
                this.syncDraft(draft);
            });

            // 接收其他设备的暂存删除
            this.socket.on('draft_delete', (data) => {
                this.removeDraft(data.draft_id);
            });
        }

        loadFromStorage() {
            try {
                const data = localStorage.getItem(this.storageKey);
                if (data) {
                    this.drafts = JSON.parse(data);
                    // 按更新时间降序排序
                    this.drafts.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                }
            } catch (error) {
                console.error('加载暂存数据失败:', error);
                this.drafts = [];
            }
        }

        saveToStorage() {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.drafts));
            } catch (error) {
                console.error('保存暂存数据失败:', error);
            }
        }

        // 添加或更新暂存
        upsertDraft(draftData) {
            console.log('[DraftPanel] upsertDraft 被调用，当前drafts数量:', this.drafts.length);
            console.log('[DraftPanel] 接收到的draftData:', draftData);

            const existingIndex = this.drafts.findIndex(d => d.draft_id === draftData.draft_id);

            const draft = {
                draft_id: draftData.draft_id,
                score_code: draftData.score_code,
                rating: draftData.rating || 5,
                comment: draftData.comment || '',
                video_source: draftData.video_source || 'upload',
                video_url: draftData.video_url || '',
                updated_at: draftData.updated_at || new Date().toISOString()
            };

            if (existingIndex >= 0) {
                console.log('[DraftPanel] 更新现有暂存，索引:', existingIndex);
                this.drafts[existingIndex] = draft;
            } else {
                console.log('[DraftPanel] 添加新暂存');
                this.drafts.unshift(draft);
            }

            // 按更新时间排序
            this.drafts.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

            console.log('[DraftPanel] 更新后drafts数量:', this.drafts.length);
            console.log('[DraftPanel] 当前drafts数组:', this.drafts);

            this.saveToStorage();
            this.updateBadge();
            this.renderList();

            // 通过WebSocket同步到其他设备
            this.broadcastDraft(draft);
        }

        // 删除暂存
        removeDraft(draftId) {
            const index = this.drafts.findIndex(d => d.draft_id === draftId);
            if (index >= 0) {
                this.drafts.splice(index, 1);
                this.saveToStorage();
                this.updateBadge();
                this.renderList();

                // 通过WebSocket同步到其他设备
                this.broadcastDelete(draftId);
            }
        }

        // 清空所有暂存
        clearAll() {
            if (this.drafts.length === 0) return;

            if (confirm('确定要清空所有暂存的评价吗？')) {
                const draftIds = this.drafts.map(d => d.draft_id);
                this.drafts = [];
                this.saveToStorage();
                this.updateBadge();
                this.renderList();

                // 广播删除
                draftIds.forEach(id => this.broadcastDelete(id));
            }
        }

        // 获取指定曲谱码的暂存
        getDraft(scoreCode) {
            return this.drafts.find(d => d.score_code === scoreCode);
        }

        // 同步其他设备的暂存
        syncDraft(draft) {
            const existingIndex = this.drafts.findIndex(d => d.draft_id === draft.draft_id);

            if (existingIndex >= 0) {
                // 比较时间戳，保留最新的
                const existing = this.drafts[existingIndex];
                if (new Date(draft.updated_at) > new Date(existing.updated_at)) {
                    this.drafts[existingIndex] = draft;
                    this.drafts.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                    this.saveToStorage();
                    this.updateBadge();
                    this.renderList();
                }
            } else {
                // 新增暂存
                this.drafts.unshift(draft);
                this.drafts.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                this.saveToStorage();
                this.updateBadge();
                this.renderList();
            }
        }

        // 广播暂存更新
        broadcastDraft(draft) {
            if (this.socket && this.sessionId) {
                this.socket.emit('draft_update', {
                    session_id: this.sessionId,
                    draft: draft
                });
            }
        }

        // 广播暂存删除
        broadcastDelete(draftId) {
            if (this.socket && this.sessionId) {
                this.socket.emit('draft_delete', {
                    session_id: this.sessionId,
                    draft_id: draftId
                });
            }
        }

        // 更新徽章
        updateBadge() {
            if (!this.badge) return;

            const count = this.drafts.length;
            if (count > 0) {
                this.badge.textContent = count > 99 ? '99+' : count;
                this.badge.classList.remove('hidden');
            } else {
                this.badge.classList.add('hidden');
            }
        }

        // 渲染列表
        renderList() {
            console.log('[DraftPanel] renderList 被调用，this.list:', this.list);
            console.log('[DraftPanel] renderList - drafts数组:', this.drafts);

            if (!this.list) {
                console.error('[DraftPanel] renderList - this.list 不存在！');
                return;
            }

            if (this.drafts.length === 0) {
                console.log('[DraftPanel] renderList - drafts为空，显示空状态');
                this.list.innerHTML = '<div class="qyj-draft-panel__empty">暂无暂存的评价</div>';
                return;
            }

            const html = this.drafts.map(draft => {
                const stars = '★'.repeat(draft.rating) + '☆'.repeat(5 - draft.rating);
                const preview = draft.comment || '（无评语）';
                const time = this.formatTime(draft.updated_at);

                return `
                    <div class="qyj-draft-item" data-draft-id="${draft.draft_id}">
                        <div class="qyj-draft-item__code">${draft.score_code}</div>
                        <div class="qyj-draft-item__preview">${preview}</div>
                        <div class="qyj-draft-item__meta">
                            <span class="qyj-draft-item__stars">${stars}</span>
                            <span>${time}</span>
                        </div>
                        <button class="qyj-draft-item__delete" title="删除暂存" data-delete-id="${draft.draft_id}">✕</button>
                    </div>
                `;
            }).join('');

            console.log('[DraftPanel] renderList - 生成的HTML:', html);
            this.list.innerHTML = html;

            // 绑定列表项事件
            this.list.querySelectorAll('.qyj-draft-item').forEach(item => {
                // 点击打开暂存
                item.addEventListener('click', (e) => {
                    if (!e.target.matches('.qyj-draft-item__delete')) {
                        const draftId = item.dataset.draftId;
                        const draft = this.drafts.find(d => d.draft_id === draftId);
                        if (draft && typeof this.onSelectDraft === 'function') {
                            this.onSelectDraft(draft);
                            this.close();
                        }
                    }
                });

                // 删除按钮
                const deleteBtn = item.querySelector('.qyj-draft-item__delete');
                deleteBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const draftId = deleteBtn.dataset.deleteId;
                    this.removeDraft(draftId);
                });
            });
        }

        // 格式化时间
        formatTime(isoString) {
            const date = new Date(isoString);
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) {
                return '刚刚';
            } else if (diff < 3600000) {
                return `${Math.floor(diff / 60000)}分钟前`;
            } else if (diff < 86400000) {
                return `${Math.floor(diff / 3600000)}小时前`;
            } else {
                return date.toLocaleDateString();
            }
        }

        // 打开面板
        open() {
            if (!this.panel) return;
            this.isOpen = true;
            this.panel.classList.add('is-open');
        }

        // 关闭面板
        close() {
            if (!this.panel) return;
            this.isOpen = false;
            this.panel.classList.remove('is-open');
        }

        // 切换面板
        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        }
    }

    window.DraftPanel = DraftPanel;
})(window, document);