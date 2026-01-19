console.log('batch_query.js 脚本开始加载');
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded 事件触发，开始初始化');
    const socket = io();
    const escapeHtml = (str = '') => str
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const sanitizeTooltip = (text) => (text || '').toString().replace(/\s+/g, ' ').trim();
    const unique = (arr = []) => Array.from(new Set(arr));
    const queryBtn = document.getElementById('queryBtn');
    const scoreCodesTextarea = document.getElementById('scoreCodes');
    const resultsBody = document.getElementById('resultsBody');
    const showIncompleteOnlyCheckbox = document.getElementById('showIncompleteOnly');
    const fetchJianshangBtn = document.getElementById('fetchJianshangBtn');
    console.log('获取到按钮元素:', fetchJianshangBtn);
    if (fetchJianshangBtn) {
        console.log('按钮当前文本:', fetchJianshangBtn.textContent);
    }
    const favoriteFilterBtn = document.getElementById('favoriteFilterBtn');
    const randomCopyBtn = document.getElementById('randomCopyBtn');
    const initialChromeInitializedElement = document.getElementById('initialChromeInitialized');
    const hideCompletionCheckbox = document.getElementById('hideCompletion');
    const hideFavoriteCheckbox = document.getElementById('hideFavorite');
    const showAllRemarksCheckbox = document.getElementById('showAllRemarks');
    const excludeCodesTextarea = document.getElementById('excludeCodes');
    const excludeBtn = document.getElementById('excludeBtn');
    const includeRemarkInput = document.getElementById('includeRemark');
    const excludeRemarkInput = document.getElementById('excludeRemark');
    const batchRemarkBtn = document.getElementById('batchRemarkBtn');
    const createPoolFromBatchBtn = document.getElementById('createPoolFromBatchBtn');
    const remarkModal = document.getElementById('remarkModal');
    const remarkTextarea = document.getElementById('remarkTextarea');
    const remarkSaveBtn = document.getElementById('remarkSaveBtn');
    const remarkCancelBtn = document.getElementById('remarkCancelBtn');
    const remarkCloseBtn = document.getElementById('remarkCloseBtn');
    const remarkSummary = document.getElementById('remarkSummary');
    const remarkMsg = document.getElementById('remarkMsg');

    // 初始化DraftPanel
    let draftPanel = null;
    async function initDraftPanel() {
        try {
            console.log('[DraftPanel] 批量查询页 - 开始初始化DraftPanel...');
            // 获取session_id
            const sessionResp = await fetch('/api/session');
            const sessionData = await sessionResp.json();
            const sessionId = sessionData.session_id;
            console.log('[DraftPanel] 批量查询页 - 获取到session_id:', sessionId);

            // 创建DraftPanel实例
            draftPanel = new DraftPanel({
                sessionId: sessionId,
                socket: socket,
                onSelectDraft: (draft) => {
                    // 打开评价弹窗并预填充暂存数据
                    reviewModalInstance.open({
                        scoreCode: draft.score_code,
                        mode: 'create',
                        prefill: {
                            rating: draft.rating,
                            comment: draft.comment,
                            video_source: draft.video_source,
                            video_url: draft.video_url
                        }
                    });
                }
            });
            console.log('[DraftPanel] 批量查询页 - DraftPanel初始化完成');
        } catch (error) {
            console.error('DraftPanel初始化失败:', error);
        }
    }

    // 等待DraftPanel初始化完成
    await initDraftPanel();

    console.log('[ReviewModal] 批量查询页 - DraftPanel已初始化，值为:', draftPanel);

    // 初始化ReviewModal，传入draftPanel
    const reviewModalInstance = new ReviewModal({
        draftPanel: draftPanel
    });
    if (!reviewModalInstance.isReady()) {
        console.warn('ReviewModal: 批量查询页弹窗初始化失败');
    }
    
    let isChromeInitialized = false; // 初始状态为未初始化
    let excludeList = [];
    let lastRandomScore = null;
    let remarkModalState = {
        mode: 'single',
        scoreCode: null,
        codes: [],
        onSaved: null
    };

    // 直接启用获取鉴赏谱按钮（不再需要Chrome初始化）
    fetchJianshangBtn.classList.remove('disabled-look');
    fetchJianshangBtn.textContent = '获取鉴赏谱';

    let currentResults = []; // 存储当前查询结果
    let filteredResults = []; // 存储当前筛选后的结果
    let currentFilters = {
        minCompletion: null,
        maxCompletion: null,
        favorite: 0  // 0: 全部, 1: 收藏, 2: 未收藏
    };
    const RESULTS_PAGE_SIZE = 200;
    let resultsOffset = 0;
    let resultsTotal = 0;
    let resultsHasMore = true;
    let resultsLoading = false;
    let resultsObserver = null;
    let resultsFetchController = null;
    let activeQuery = { mode: 'all', payload: {} };

    // 从文本中提取曲谱码
    function extractScoreCodes(text) {
        // 按行分割文本
        const lines = text.split('\n');
        const scoreCodes = new Set(); // 使用Set去重

        lines.forEach(line => {
            // 使用正则表达式匹配行中的数字
            const matches = line.match(/\d+/g);
            if (matches) {
                matches.forEach(match => {
                    // 只添加纯数字且长度大于等于5的匹配结果
                    if (/^\d+$/.test(match) && match.length >= 5) {
                        scoreCodes.add(match);
                    }
                });
            }
        });

        return Array.from(scoreCodes);
    }

    function hasCustomQuery() {
        return Boolean(
            scoreCodesTextarea.value.trim() ||
            excludeCodesTextarea.value.trim() ||
            (includeRemarkInput && includeRemarkInput.value.trim()) ||
            (excludeRemarkInput && excludeRemarkInput.value.trim())
        );
    }

    function resetResultsState() {
        currentResults = [];
        filteredResults = [];
        resultsOffset = 0;
        resultsTotal = 0;
        resultsHasMore = true;
        resultsLoading = false;
        if (resultsObserver) {
            resultsObserver.disconnect();
            resultsObserver = null;
        }
    }

    function buildActiveQuery() {
        const rawScoreCodes = scoreCodesTextarea.value.trim();
        const rawExcludeCodes = excludeCodesTextarea.value.trim();
        const codes = rawScoreCodes ? extractScoreCodes(rawScoreCodes) : [];
        const excludeCodes = rawExcludeCodes ? extractScoreCodes(rawExcludeCodes) : [];
        const includeRemarkRaw = includeRemarkInput ? includeRemarkInput.value.trim() : '';
        const excludeRemarkRaw = excludeRemarkInput ? excludeRemarkInput.value.trim() : '';
        const hasRemarkFilter = includeRemarkRaw.length > 0 || excludeRemarkRaw.length > 0;
        if (codes.length > 0 || excludeCodes.length > 0 || hasRemarkFilter) {
            return {
                mode: 'batch',
                payload: {
                    score_codes: codes,
                    exclude_codes: excludeCodes,
                    include_remark: includeRemarkRaw,
                    exclude_remark: excludeRemarkRaw
                }
            };
        }
        return { mode: 'all', payload: {} };
    }

    function getCommonFilters() {
        return {
            min_completion: currentFilters.minCompletion,
            max_completion: currentFilters.maxCompletion,
            favorite: currentFilters.favorite,
            incomplete_only: showIncompleteOnlyCheckbox.checked ? 1 : 0
        };
    }

    async function fetchResultsPage({ offset, limit, signal }) {
        const filters = getCommonFilters();
        if (activeQuery.mode === 'batch') {
            const payload = {
                ...activeQuery.payload,
                ...filters,
                limit,
                offset
            };
            const response = await fetch('/api/scores/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal
            });
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || '查询失败');
            }
            return {
                items: Array.isArray(data.results) ? data.results : [],
                total: Number.isFinite(data.total) ? data.total : 0
            };
        }
        const params = new URLSearchParams();
        params.append('limit', limit);
        params.append('offset', offset);
        if (filters.min_completion !== null) {
            params.append('min_completion', filters.min_completion);
        }
        if (filters.max_completion !== null) {
            params.append('max_completion', filters.max_completion);
        }
        if (filters.favorite !== null) {
            params.append('favorite', filters.favorite);
        }
        if (filters.incomplete_only) {
            params.append('incomplete_only', '1');
        }
        const response = await fetch(`/api/scores?${params.toString()}`, { signal });
        const data = await response.json();
        if (Array.isArray(data)) {
            return { items: data, total: data.length };
        }
        return {
            items: Array.isArray(data.items) ? data.items : [],
            total: Number.isFinite(data.total) ? data.total : 0
        };
    }

    async function loadNextResultsPage(options = {}) {
        if (resultsLoading || !resultsHasMore) return;
        resultsLoading = true;
        try {
            const result = await fetchResultsPage({
                offset: resultsOffset,
                limit: RESULTS_PAGE_SIZE,
                signal: options.signal
            });
            if (options.signal && options.signal.aborted) return;
            const items = Array.isArray(result.items) ? result.items : [];
            const normalized = items.map(item => ({
                ...item,
                remark: item && item.remark != null ? item.remark : ''
            }));
            if (Number.isFinite(result.total)) {
                resultsTotal = result.total;
            }
            currentResults = currentResults.concat(normalized);
            resultsOffset += normalized.length;
            if (Number.isFinite(resultsTotal) && resultsTotal > 0) {
                resultsHasMore = resultsOffset < resultsTotal;
            } else {
                resultsHasMore = normalized.length >= RESULTS_PAGE_SIZE;
            }
            resultsLoading = false;
            filterAndDisplayResults();
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }
            console.error('Error:', error);
            showToast(error.message || '获取数据失败');
            const colCount = getColumnCount();
            resultsBody.innerHTML = `<tr><td colspan="${colCount}" class="error">加载失败，请重试</td></tr>`;
        } finally {
            resultsLoading = false;
        }
    }

    async function loadData() {
        activeQuery = buildActiveQuery();
        resetResultsState();
        if (resultsFetchController) {
            resultsFetchController.abort();
        }
        resultsFetchController = new AbortController();
        const colCount = getColumnCount();
        resultsBody.innerHTML = `<tr><td colspan="${colCount}" class="loading">加载中...</td></tr>`;
        await loadNextResultsPage({ signal: resultsFetchController.signal });
    }

    // 查询和排除统一的查询行为
    function doQuery() {
        loadData();
    }
    queryBtn.addEventListener('click', doQuery);
    excludeBtn.addEventListener('click', doQuery);
    [includeRemarkInput, excludeRemarkInput].forEach(input => {
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loadData();
            }
        });
    });
    batchRemarkBtn?.addEventListener('click', async () => {
        if (!filteredResults.length && !resultsHasMore) {
            showToast('当前表格没有可备注的谱子');
            return;
        }
        if (resultsHasMore) {
            showToast('正在准备完整结果，请稍候…');
        }
        const sourceResults = resultsHasMore ? await fetchAllResultsForAction() : filteredResults;
        if (!sourceResults.length) {
            showToast('当前表格没有可备注的谱子');
            return;
        }
        const codes = unique(sourceResults.map(item => item.score_code));
        const filledRemarks = unique(sourceResults
            .map(item => (item.remark || '').toString().trim())
            .filter(Boolean));
        const initialRemark = filledRemarks.length === 1
            ? sourceResults.find(item => (item.remark || '').toString().trim() === filledRemarks[0])?.remark || ''
            : '';
        openRemarkModal({
            mode: 'batch',
            codes,
            initialRemark,
            source: 'batch',
            onSaved: (result) => {
                const updates = Array.isArray(result?.updates)
                    ? result.updates
                    : [];
                let changed = false;
                if (updates.length) {
                    updates.forEach(item => {
                        if (item && updateRemarkInResults(item.score_code, item.remark)) {
                            changed = true;
                        }
                    });
                } else if (typeof result?.remark === 'string') {
                    codes.forEach(code => {
                        if (updateRemarkInResults(code, result.remark)) {
                            changed = true;
                        }
                    });
                }
                if (changed) {
                    filterAndDisplayResults();
                }
            }
        });
    });

    // 完成率筛选
    const completionHeader = document.querySelector('.completion-header');
    const completionFilter = document.querySelector('.completion-filter');
    const minCompletion = document.getElementById('minCompletion');
    const maxCompletion = document.getElementById('maxCompletion');
    const applyCompletionFilter = document.getElementById('applyCompletionFilter');

    // 应用完成率筛选
    applyCompletionFilter.addEventListener('click', () => {
        const min = parseInt(minCompletion.value);
        const max = parseInt(maxCompletion.value);
        
        if (minCompletion.value && (isNaN(min) || min < 0 || min > 100)) {
            showToast('请输入0-100之间的最小完成率');
            return;
        }
        if (maxCompletion.value && (isNaN(max) || max < 0 || max > 100)) {
            showToast('请输入0-100之间的最大完成率');
            return;
        }
        if (minCompletion.value && maxCompletion.value && min > max) {
            showToast('最小完成率不能大于最大完成率');
            return;
        }
        
        currentFilters.minCompletion = minCompletion.value ? min : null;
        currentFilters.maxCompletion = maxCompletion.value ? max : null;
        loadData();
    });

    // 收藏筛选
    favoriteFilterBtn.addEventListener('click', () => {
        const states = ['全部', '仅收藏', '仅未收藏'];
        const currentState = currentFilters.favorite;
        currentFilters.favorite = (currentState + 1) % 3;
        favoriteFilterBtn.textContent = states[currentFilters.favorite];
        favoriteFilterBtn.classList.toggle('active', currentFilters.favorite !== 0);
        loadData();
    });

    function refreshRandomCard() {
        if (!lastRandomScore) return;
        const latest = currentResults.find(item => item.score_code === lastRandomScore.score_code);
        if (latest) {
            lastRandomScore = latest;
            updateRandomCopyCard(lastRandomScore);
        }
    }

    function updateRemarkInResults(scoreCode, remarkValue) {
        let changed = false;
        currentResults.forEach(item => {
            if (item.score_code === scoreCode) {
                if (item.remark !== remarkValue) {
                    item.remark = remarkValue;
                    changed = true;
                }
            }
        });
        filteredResults.forEach(item => {
            if (item.score_code === scoreCode) {
                item.remark = remarkValue;
            }
        });
        if (lastRandomScore && lastRandomScore.score_code === scoreCode) {
            lastRandomScore.remark = remarkValue;
            updateRandomCopyCard(lastRandomScore);
        }
        return changed;
    }

    async function fetchAllResultsForAction() {
        const collected = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
            const result = await fetchResultsPage({ offset, limit: RESULTS_PAGE_SIZE });
            const items = Array.isArray(result.items) ? result.items : [];
            const normalized = items.map(item => ({
                ...item,
                remark: item && item.remark != null ? item.remark : ''
            }));
            collected.push(...normalized);
            if (Number.isFinite(result.total)) {
                total = result.total;
            }
            if (!normalized.length || normalized.length < RESULTS_PAGE_SIZE) {
                break;
            }
            offset += normalized.length;
        }
        return collected;
    }

    async function openRemarkModal(options = {}) {
        if (!remarkModal || !remarkTextarea || !remarkSaveBtn) {
            return;
        }
        const {
            mode = 'single',
            scoreCode = null,
            codes = [],
            initialRemark = '',
            onSaved = null
        } = options;
        const pickedCodes = unique(codes);
        remarkModalState = {
            mode,
            scoreCode,
            codes: pickedCodes,
            onSaved
        };

        remarkMsg.textContent = '';
        remarkSaveBtn.disabled = false;
        remarkSaveBtn.textContent = '保存备注';

        if (remarkSummary) {
            let summaryText = '';
            if (mode === 'batch') {
                summaryText = `将为 ${pickedCodes.length} 个谱子补充备注（当前筛选结果）。已包含目标信息的备注不会被覆盖。`;
            } else if (scoreCode) {
                summaryText = `当前曲谱：${scoreCode}`;
            }
            remarkSummary.textContent = summaryText;
            remarkSummary.style.display = summaryText ? 'block' : 'none';
        }

        remarkTextarea.value = initialRemark || '';
        remarkModal.classList.add('is-open');
        remarkModal.setAttribute('aria-hidden', 'false');
        setTimeout(() => remarkTextarea.focus(), 40);

        if (mode === 'single' && scoreCode) {
            try {
                const resp = await fetch(`/api/scores/${scoreCode}/remark`);
                const data = await resp.json();
                if (data.success && typeof data.remark === 'string') {
                    remarkTextarea.value = data.remark;
                }
            } catch (error) {
                console.warn('备注加载失败', error);
            }
        }
        return remarkModalState;
    }

    function closeRemarkModal() {
        if (!remarkModal) return;
        remarkModal.classList.remove('is-open');
        remarkModal.setAttribute('aria-hidden', 'true');
    }

    async function saveRemarkModal() {
        if (!remarkModal || !remarkTextarea || !remarkSaveBtn) {
            return;
        }
        const remarkValue = (remarkTextarea.value || '').trim();
        remarkSaveBtn.disabled = true;
        remarkSaveBtn.textContent = '保存中...';
        remarkMsg.textContent = '';
        try {
            if (remarkModalState.mode === 'batch') {
                if (!remarkModalState.codes.length) {
                    remarkMsg.textContent = '没有可更新的谱子';
                } else {
                    const resp = await fetch('/api/scores/remarks/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            score_codes: remarkModalState.codes,
                            remark: remarkValue
                        })
                    });
                    const data = await resp.json();
                    if (data.success) {
                        const updates = Array.isArray(data.updates) ? data.updates : [];
                        if (typeof remarkModalState.onSaved === 'function') {
                            remarkModalState.onSaved(data);
                        } else if (updates.length) {
                            let changed = false;
                            updates.forEach(item => {
                                if (item && updateRemarkInResults(item.score_code, item.remark)) {
                                    changed = true;
                                }
                            });
                            if (changed) {
                                filterAndDisplayResults();
                            }
                        } else {
                            // 无变化时刷新以确保状态一致
                            filterAndDisplayResults();
                        }
                        const updatedCount = data.updated_count ?? updates.length;
                        const skippedCount = data.unchanged_count ?? (Array.isArray(data.skipped) ? data.skipped.length : 0);
                        const summary = `批量备注已更新：更新 ${updatedCount} 条，保留 ${skippedCount} 条`;
                        closeRemarkModal();
                        showToast(summary);
                    } else {
                        remarkMsg.textContent = data.error || '批量备注失败';
                    }
                }
            } else if (remarkModalState.scoreCode) {
                const resp = await fetch(`/api/scores/${remarkModalState.scoreCode}/remark`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ remark: remarkValue })
                });
                const data = await resp.json();
                if (data.success) {
                    const savedRemark = data.remark != null ? data.remark : remarkValue;
                    if (updateRemarkInResults(remarkModalState.scoreCode, savedRemark)) {
                            filterAndDisplayResults();
                        }
                    if (typeof remarkModalState.onSaved === 'function') {
                        remarkModalState.onSaved(savedRemark);
                    }
                    closeRemarkModal();
                    showToast('备注已更新');
                } else {
                    remarkMsg.textContent = data.error || '保存备注失败';
                }
            }
        } catch (error) {
            console.error('保存备注失败', error);
            remarkMsg.textContent = '保存失败，请稍后重试';
        } finally {
            remarkSaveBtn.disabled = false;
            remarkSaveBtn.textContent = '保存备注';
        }
    }

    remarkCancelBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        closeRemarkModal();
    });

    remarkCloseBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        closeRemarkModal();
    });

    remarkModal?.addEventListener('click', (event) => {
        if (event.target && event.target.dataset && Object.prototype.hasOwnProperty.call(event.target.dataset, 'closeRemark')) {
            closeRemarkModal();
        }
    });

    remarkSaveBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        saveRemarkModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && remarkModal && remarkModal.classList.contains('is-open')) {
            closeRemarkModal();
        }
    });

    // 筛选并显示结果
    function getColumnCount() {
        let colCount = 1;
        if (!hideCompletionCheckbox.checked) colCount++;
        if (!hideFavoriteCheckbox.checked) colCount++;
        return colCount;
    }

    function filterAndDisplayResults() {
        resultsBody.innerHTML = '';
        filteredResults = currentResults;
        // 后端已筛选，无需前端再排除

        // 控制表头和表格列的显示
        const completionHeader = document.querySelector('.completion-header');
        const favoriteHeader = document.querySelector('.favorite-header');
        if (hideCompletionCheckbox.checked) {
            completionHeader.style.display = 'none';
        } else {
            completionHeader.style.display = '';
        }
        if (hideFavoriteCheckbox.checked) {
            favoriteHeader.style.display = 'none';
        } else {
            favoriteHeader.style.display = '';
        }

        // 统计显示的列数
        const colCount = getColumnCount();

        if (filteredResults.length === 0) {
            resultsBody.innerHTML = `<tr><td colspan="${colCount}" class="no-results">没有找到符合条件的记录</td></tr>`;
            updateScoreCount();
            return;
        }

        filteredResults.forEach(result => {
            const row = document.createElement('tr');
            const remarkText = (result.remark || '').toString();
            const remarkExists = remarkText.trim().length > 0;

            const codeCell = document.createElement('td');
            codeCell.textContent = result.score_code;
            row.appendChild(codeCell);

            if (!hideCompletionCheckbox.checked) {
                const completionCell = document.createElement('td');
                completionCell.textContent = (result.completion !== null && result.completion !== undefined)
                    ? `${result.completion}%`
                    : '-';
                row.appendChild(completionCell);
            }

            if (!hideFavoriteCheckbox.checked) {
                const actionsCell = document.createElement('td');
                const actionWrap = document.createElement('div');
                actionWrap.className = 'table-action-wrap';

                const favoriteIndicator = document.createElement('span');
                favoriteIndicator.className = 'favorite-indicator';
                favoriteIndicator.textContent = result.is_favorite ? '★' : '☆';
                favoriteIndicator.title = result.is_favorite ? '已收藏' : '未收藏';
                actionWrap.appendChild(favoriteIndicator);

                const remarkBtnEl = document.createElement('button');
                remarkBtnEl.className = 'remark-btn table-remark-btn';
                if (remarkExists) {
                    remarkBtnEl.classList.add('has-remark');
                }
                remarkBtnEl.innerHTML = '📝';
                remarkBtnEl.title = remarkExists ? sanitizeTooltip(remarkText) : '添加备注';
                remarkBtnEl.addEventListener('click', () => {
                    openRemarkModal({
                        mode: 'single',
                        scoreCode: result.score_code,
                        initialRemark: remarkText,
                        source: 'table',
                        onSaved: (newRemark) => {
                            if (updateRemarkInResults(result.score_code, newRemark)) {
                                filterAndDisplayResults();
                            }
                        }
                    });
                });
                actionWrap.appendChild(remarkBtnEl);

                const heartBtn = document.createElement('button');
                heartBtn.className = 'heart-btn';
                heartBtn.dataset.code = result.score_code;
                let hasReview = !!result.has_review;
                heartBtn.title = hasReview ? '查看评价' : '添加评价';
                heartBtn.textContent = hasReview ? '❤️' : '🩶';
                heartBtn.addEventListener('click', async () => {
                    if (!reviewModalInstance.isReady()) {
                        showToast('评价弹窗未初始化');
                        return;
                    }
                    const preferredMode = hasReview ? 'view' : 'create';
                    const { mode } = await reviewModalInstance.open({
                        scoreCode: result.score_code,
                        mode: preferredMode,
                        onSaved: () => {
                            hasReview = true;
                            result.has_review = true;
                            heartBtn.textContent = '❤️';
                            heartBtn.title = '查看评价';
                            loadData();
                        }
                    });
                    if (mode === 'view') {
                        hasReview = true;
                        heartBtn.textContent = '❤️';
                        heartBtn.title = '查看评价';
                    } else if (preferredMode === 'view' && mode === 'create') {
                        hasReview = false;
                        result.has_review = false;
                        heartBtn.textContent = '🩶';
                        heartBtn.title = '添加评价';
                    }
                });
                actionWrap.appendChild(heartBtn);

                actionsCell.appendChild(actionWrap);
                row.appendChild(actionsCell);
            }

            resultsBody.appendChild(row);
            if (showAllRemarksCheckbox && showAllRemarksCheckbox.checked && remarkExists) {
                const remarkRow = document.createElement('tr');
                remarkRow.className = 'remark-row';
                const remarkCell = document.createElement('td');
                remarkCell.colSpan = row.children.length;
                remarkCell.className = 'remark-cell';

                const remarkWrap = document.createElement('div');
                remarkWrap.className = 'remark-cell-wrap';

                const remarkLabel = document.createElement('span');
                remarkLabel.className = 'remark-cell-label';
                remarkLabel.textContent = '备注：';
                remarkWrap.appendChild(remarkLabel);

                const remarkContent = document.createElement('span');
                remarkContent.className = 'remark-cell-content';
                remarkContent.textContent = remarkText;
                remarkWrap.appendChild(remarkContent);

                remarkCell.appendChild(remarkWrap);

                remarkRow.appendChild(remarkCell);
                resultsBody.appendChild(remarkRow);
            }
        });

        appendResultsOverflow(colCount);
        updateScoreCount();

        // 更新曲谱数量显示
        refreshRandomCard();
    }

    function updateScoreCount() {
        const scoreCountSpan = document.getElementById('scoreCount');
        if (!scoreCountSpan) return;
        const total = Number.isFinite(resultsTotal) && resultsTotal >= 0
            ? resultsTotal
            : filteredResults.length;
        scoreCountSpan.textContent = `（共${total}个）`;
    }

    function setupResultsObserver(triggerEl) {
        if (!triggerEl || !('IntersectionObserver' in window)) return;
        if (resultsObserver) {
            resultsObserver.disconnect();
        }
        resultsObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry && entry.isIntersecting) {
                loadNextResultsPage({ signal: resultsFetchController?.signal });
            }
        }, { rootMargin: '300px 0px' });
        resultsObserver.observe(triggerEl);
    }

    function appendResultsOverflow(colCount) {
        if (!resultsHasMore && !resultsLoading) {
            return;
        }
        const row = document.createElement('tr');
        row.className = 'results-load-more';
        const cell = document.createElement('td');
        cell.colSpan = colCount;

        const wrap = document.createElement('div');
        wrap.className = 'results-load-more__wrap';

        const info = document.createElement('div');
        info.className = 'results-load-more__info';
        const total = Number.isFinite(resultsTotal) ? resultsTotal : filteredResults.length;
        info.textContent = `已加载 ${filteredResults.length} 条 / 共 ${total} 条`;
        wrap.appendChild(info);

        if (resultsHasMore) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'results-load-more__btn';
            btn.textContent = resultsLoading ? '加载中...' : '加载更多';
            btn.disabled = resultsLoading;
            btn.addEventListener('click', () => {
                loadNextResultsPage({ signal: resultsFetchController?.signal });
            });
            wrap.appendChild(btn);

            const trigger = document.createElement('div');
            trigger.className = 'results-load-trigger';
            trigger.setAttribute('aria-hidden', 'true');
            wrap.appendChild(trigger);
            setupResultsObserver(trigger);
        }

        cell.appendChild(wrap);
        row.appendChild(cell);
        resultsBody.appendChild(row);
    }

    // 显示提示信息
    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // 触发重排以启用动画
        toast.offsetHeight;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    // 添加复选框变化事件监听
    showIncompleteOnlyCheckbox.addEventListener('change', loadData);
    hideCompletionCheckbox.addEventListener('change', filterAndDisplayResults);
    hideFavoriteCheckbox.addEventListener('change', filterAndDisplayResults);
    showAllRemarksCheckbox?.addEventListener('change', filterAndDisplayResults);

    // 剪贴板更新（来自主页的完成率保存）
    socket.on('clipboard_update', function(data) {
        // 只有当类型是 'completion' 并且有 score_code 时才触发更新
        if (data.type === 'completion' && data.score_code) {
            loadData();
        }
    });

    // 收藏状态更新
    socket.on('favorite_update', function(data) {
        // 重新查询以反映收藏状态的变化
        loadData();
    });

    socket.on('remark_update', function(data) {
        if (!data || !data.score_code) return;
        const changed = updateRemarkInResults(data.score_code, data.remark || '');
        if (changed) {
            filterAndDisplayResults();
        }
    });

    // 随机复制按钮点击事件
    let lastRandomIndex = null; // 记录上一次随机的 index
    randomCopyBtn.addEventListener('click', async () => {
        console.log('随机复制按钮被点击！');
        const sourceResults = resultsHasMore ? await fetchAllResultsForAction() : filteredResults;
        if (sourceResults.length > 0) {
            let randomIndex;
            if (sourceResults.length === 1) {
                randomIndex = 0;
            } else {
                let attempts = 0;
                do {
                    randomIndex = Math.floor(Math.random() * sourceResults.length);
                    attempts++;
                } while (randomIndex === lastRandomIndex && attempts < sourceResults.length);
            }
            lastRandomIndex = randomIndex;
            const randomScore = sourceResults[randomIndex];
            const randomScoreCode = randomScore.score_code;
            lastRandomScore = randomScore;
            // 使用兼容性更好的复制方法
            const tempInput = document.createElement('textarea');
            tempInput.value = randomScoreCode;
            document.body.appendChild(tempInput);
            tempInput.select();
            try {
                document.execCommand('copy');
                showToast(`已复制: ${randomScoreCode}`);
                updateRandomCopyCard(randomScore);
            } catch (err) {
                console.error('复制失败:', err);
                showToast('复制失败，请手动复制');
            } finally {
                document.body.removeChild(tempInput);
            }
        } else {
            showToast('没有可供复制的曲谱码');
        }
    });

    createPoolFromBatchBtn?.addEventListener('click', async () => {
        const sourceResults = resultsHasMore ? await fetchAllResultsForAction() : filteredResults;
        const codes = unique(sourceResults.map(item => item.score_code));
        const filter = {};
        if (currentFilters.minCompletion !== null) filter.min_completion = currentFilters.minCompletion;
        if (currentFilters.maxCompletion !== null) filter.max_completion = currentFilters.maxCompletion;
        if (currentFilters.favorite) filter.favorite = currentFilters.favorite;
        if (showIncompleteOnlyCheckbox.checked) filter.incomplete_only = 1;
        localStorage.setItem('batch_pool_filter', JSON.stringify(filter));
        localStorage.setItem('batch_pool_codes', JSON.stringify(codes));
        window.location.href = '/random_pool';
    });

    // 卡片渲染和事件绑定
    function updateRandomCopyCard(scoreObj) {
        const randomCopyInfo = document.getElementById('randomCopyInfo');
        if (!randomCopyInfo) return;
        const completionText = (scoreObj.completion !== null && scoreObj.completion !== undefined)
            ? `${scoreObj.completion}%`
            : '未完成';
        const favoriteIcon = scoreObj.is_favorite ? '★' : '☆';
        const hasReview = !!scoreObj.has_review;
        const remarkContent = scoreObj.remark && scoreObj.remark.toString().trim();
        const hasRemark = Boolean(remarkContent);
        const remarkDisplay = hasRemark ? escapeHtml(scoreObj.remark) : '暂无备注';
        randomCopyInfo.innerHTML = `
          <div class="random-info-card">
            <div class="score-code-row">
              <span class="score-code">${scoreObj.score_code}</span>
              <span class="favorite-icon" style="cursor:pointer;">${favoriteIcon}</span>
            </div>
            <div class="completion-row">
              完成率：<span class="completion-badge" style="cursor:pointer;">${completionText}</span>
            </div>
            <div class="actions-row" style="margin-top:8px; display:flex; gap:8px;">
              <button class="like-btn">${hasReview ? '❤️' : '🩶'}</button>
              <button class="remark-btn random-remark-btn ${hasRemark ? 'has-remark' : ''}">备注</button>
            </div>
            <div class="remark-text">${remarkDisplay}</div>
          </div>
        `;

        randomCopyInfo.querySelector('.like-btn').onclick = async () => {
          if (!reviewModalInstance.isReady()) {
            showToast('评价弹窗未初始化');
            return;
          }
          const preferredMode = hasReview ? 'view' : 'create';
          const { mode } = await reviewModalInstance.open({
            scoreCode: scoreObj.score_code,
            mode: preferredMode,
            onSaved: () => {
              scoreObj.has_review = true;
              loadData();
              updateRandomCopyCard(scoreObj);
            }
          });
          if (mode === 'view') {
            scoreObj.has_review = true;
          } else if (preferredMode === 'view' && mode === 'create') {
            scoreObj.has_review = false;
            updateRandomCopyCard(scoreObj);
          }
        };
        randomCopyInfo.querySelector('.random-remark-btn').onclick = () => {
            openRemarkModal({
                mode: 'single',
                scoreCode: scoreObj.score_code,
                initialRemark: scoreObj.remark || '',
                source: 'random',
                onSaved: (newRemark) => {
                    scoreObj.remark = newRemark;
                    updateRandomCopyCard(scoreObj);
                }
            });
        };
        // 绑定完成率编辑事件
        randomCopyInfo.querySelector('.completion-badge').onclick = async function() {
            const newValue = prompt('请输入新的完成率（0-100）', scoreObj.completion !== null ? scoreObj.completion : '');
            if (newValue === null) return;
            const num = parseInt(newValue);
            if (isNaN(num) || num < 0 || num > 100) {
                showToast('请输入0-100之间的数字');
                return;
            }
            // 提交到后端（适配 /api/scores/save）
            try {
                const resp = await fetch('/api/scores/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ score_code: scoreObj.score_code, completion: num })
                });
                const data = await resp.json();
                if (data.success) {
                    scoreObj.completion = num;
                    updateRandomCopyCard(scoreObj);
                    showToast('完成率已更新');
                } else {
                    showToast('更新失败');
                }
            } catch (e) {
                showToast('网络错误，更新失败');
            }
        };
        // 绑定收藏切换事件（适配 /api/scores/{score_code}/favorite）
        randomCopyInfo.querySelector('.favorite-icon').onclick = async function() {
            try {
                const resp = await fetch(`/api/scores/${scoreObj.score_code}/favorite`, {
                    method: 'POST'
                });
                const data = await resp.json();
                if (data.success) {
                    scoreObj.is_favorite = !scoreObj.is_favorite;
                    updateRandomCopyCard(scoreObj);
                    showToast(scoreObj.is_favorite ? '已收藏' : '已取消收藏');
                } else {
                    showToast('操作失败');
                }
            } catch (e) {
                showToast('网络错误，操作失败');
            }
        };
    }

    // 获取最新的鉴赏码并添加到排除列表
    async function loadLatestJianshangCodes() {
        console.log('loadLatestJianshangCodes 函数被调用');
        try {
            const response = await fetch('/api/latest_jianshang_codes');
            const data = await response.json();
            console.log('获取最新鉴赏码响应:', data);
            
            if (data.success) {
                // 将获取到的码添加到排除列表
                const currentExcludeCodes = excludeCodesTextarea.value.trim();
                const newExcludeCodes = currentExcludeCodes ?
                    currentExcludeCodes + '\n' + data.codes.join('\n') :
                    data.codes.join('\n');
                excludeCodesTextarea.value = newExcludeCodes;
                
                // 自动触发查询
                doQuery();
                
                const filename = data.filename || '未知文件';
                const extractedCount = data.extracted_count || 0;
                showToast(`已从文件 ${filename} 中提取 ${extractedCount} 个鉴赏码，并已添加到排除列表并自动查询`);
            } else {
                showToast('获取最新鉴赏码失败：' + data.error);
            }
        } catch (error) {
            console.error('获取最新鉴赏码时发生错误:', error);
            showToast('获取最新鉴赏码时发生错误：' + error.message);
        }
    }

    // 鉴赏谱获取按钮点击事件
    console.log('开始绑定按钮点击事件');
    fetchJianshangBtn.addEventListener('click', async function() {
        console.log('按钮点击事件被触发');
        console.log('点击了获取鉴赏谱按钮，当前文本:', fetchJianshangBtn.textContent);
        
        // 检查当前按钮状态 - 使用includes而不是精确匹配，因为文本可能包含其他内容
        if (fetchJianshangBtn.textContent.trim().includes('新鉴赏码')) {
            console.log('检测到新鉴赏码按钮状态，执行新鉴赏码逻辑');
            // 如果是新鉴赏码按钮，执行新鉴赏码逻辑
            loadLatestJianshangCodes();
            return;
        }
        console.log('当前按钮状态不是新鉴赏码，执行获取鉴赏谱逻辑');

        try {
            fetchJianshangBtn.disabled = true; // 临时禁用，防止重复点击
            fetchJianshangBtn.textContent = '正在获取...';
            
            const response = await fetch('/api/fetch_jianshang');
            const data = await response.json();
            
            if (data.success) {
                // 更新输入框并触发懒加载查询
                scoreCodesTextarea.value = data.results.map(r => r.score_code).join('\n');
                loadData();
                // 将按钮文本更改为"新鉴赏码"
                fetchJianshangBtn.textContent = '新鉴赏码';
                console.log('按钮文本已更改为: 新鉴赏码');
                const filename = data.filename || '未知文件';
                const extractedCount = data.extracted_count || 0;
                showToast(`成功获取 ${extractedCount} 个曲谱码。文件：${filename}`);
            } else {
                showToast('获取鉴赏谱失败：' + data.error);
            }
        } catch (error) {
            showToast('获取鉴赏谱时发生错误：' + error.message);
        } finally {
            // 恢复按钮可点击状态
            fetchJianshangBtn.disabled = false;
        }
    });

    // Chrome初始化状态监听已移除（不再需要浏览器初始化）

    // 初始加载
    loadData();
});
