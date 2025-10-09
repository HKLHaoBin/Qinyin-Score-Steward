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
    const excludeCodesTextarea = document.getElementById('excludeCodes');
    const excludeBtn = document.getElementById('excludeBtn');
    const includeRemarkInput = document.getElementById('includeRemark');
    const excludeRemarkInput = document.getElementById('excludeRemark');
    const batchRemarkBtn = document.getElementById('batchRemarkBtn');
    const remarkModal = document.getElementById('remarkModal');
    const remarkTextarea = document.getElementById('remarkTextarea');
    const remarkSaveBtn = document.getElementById('remarkSaveBtn');
    const remarkCancelBtn = document.getElementById('remarkCancelBtn');
    const remarkCloseBtn = document.getElementById('remarkCloseBtn');
    const remarkSummary = document.getElementById('remarkSummary');
    const remarkMsg = document.getElementById('remarkMsg');
    
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

    function loadData() {
        if (hasCustomQuery()) {
            doQuery();
        } else {
            refreshResults();
        }
    }

    // 查询和排除统一的查询行为
    function doQuery() {
        const rawScoreCodes = scoreCodesTextarea.value.trim();
        const rawExcludeCodes = excludeCodesTextarea.value.trim();
        const codes = rawScoreCodes ? extractScoreCodes(rawScoreCodes) : [];
        const excludeCodes = rawExcludeCodes ? extractScoreCodes(rawExcludeCodes) : [];
        const includeRemarkRaw = includeRemarkInput ? includeRemarkInput.value.trim() : '';
        const excludeRemarkRaw = excludeRemarkInput ? excludeRemarkInput.value.trim() : '';
        const hasRemarkFilter = includeRemarkRaw.length > 0 || excludeRemarkRaw.length > 0;
        // 只要有曲谱码、排除或备注筛选，就使用批量接口
        if (codes.length > 0 || excludeCodes.length > 0 || hasRemarkFilter) {
            fetch('/api/scores/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    score_codes: codes, 
                    exclude_codes: excludeCodes,
                    min_completion: currentFilters.minCompletion,
                    max_completion: currentFilters.maxCompletion,
                    favorite: currentFilters.favorite,
                    include_remark: includeRemarkRaw,
                    exclude_remark: excludeRemarkRaw
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    displayResults(data.results);
                } else {
                    alert(data.error || '查询失败');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('查询失败');
            });
        } else {
            refreshResults(); // 全部无内容时才全量
        }
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
    batchRemarkBtn?.addEventListener('click', () => {
        if (!filteredResults.length) {
            showToast('当前表格没有可备注的谱子');
            return;
        }
        const codes = unique(filteredResults.map(item => item.score_code));
        const filledRemarks = unique(filteredResults
            .map(item => (item.remark || '').toString().trim())
            .filter(Boolean));
        const initialRemark = filledRemarks.length === 1
            ? filteredResults.find(item => (item.remark || '').toString().trim() === filledRemarks[0])?.remark || ''
            : '';
        openRemarkModal({
            mode: 'batch',
            codes,
            initialRemark,
            source: 'batch',
            onSaved: (newRemark) => {
                let updated = false;
                codes.forEach(code => {
                    if (updateRemarkInResults(code, newRemark)) {
                        updated = true;
                    }
                });
                if (updated) {
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

    // 刷新结果
    function refreshResults() {
        const params = new URLSearchParams();
        if (currentFilters.minCompletion !== null) {
            params.append('min_completion', currentFilters.minCompletion);
        }
        if (currentFilters.maxCompletion !== null) {
            params.append('max_completion', currentFilters.maxCompletion);
        }
        if (currentFilters.favorite !== 0) {
            params.append('favorite', currentFilters.favorite);
        }

        // 显示加载状态
        resultsBody.innerHTML = '<tr><td colspan="3" class="loading">加载中...</td></tr>';

        fetch(`/api/scores?${params.toString()}`)
            .then(response => response.json())
            .then(scores => {
                displayResults(scores);
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('获取数据失败');
                resultsBody.innerHTML = '<tr><td colspan="3" class="error">加载失败，请重试</td></tr>';
            });
    }

    // 显示结果
    function displayResults(results) {
        const safeResults = Array.isArray(results) ? results : [];
        currentResults = safeResults.map(item => ({
            ...item,
            remark: item && item.remark != null ? item.remark : ''
        }));
        filterAndDisplayResults();
        if (lastRandomScore) {
            const latest = currentResults.find(item => item.score_code === lastRandomScore.score_code);
            if (latest) {
                lastRandomScore = latest;
                updateRandomCopyCard(lastRandomScore);
            }
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
                summaryText = `将为 ${pickedCodes.length} 个谱子更新备注（当前筛选结果）。保存后会覆盖这些谱子的备注。`;
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
        const remarkValue = remarkTextarea.value || '';
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
                        let updated = false;
                        remarkModalState.codes.forEach(code => {
                            if (updateRemarkInResults(code, remarkValue)) {
                                updated = true;
                            }
                        });
                        if (updated) {
                            filterAndDisplayResults();
                        }
                        if (typeof remarkModalState.onSaved === 'function') {
                            remarkModalState.onSaved(remarkValue);
                        }
                        closeRemarkModal();
                        showToast('批量备注已更新');
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
    function filterAndDisplayResults() {
        resultsBody.innerHTML = '';
        filteredResults = showIncompleteOnlyCheckbox.checked 
            ? currentResults.filter(result => result.completion == null)
            : currentResults;
        // 后端已排除，无需前端再排除

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
        let colCount = 1;
        if (!hideCompletionCheckbox.checked) colCount++;
        if (!hideFavoriteCheckbox.checked) colCount++;

        if (filteredResults.length === 0) {
            resultsBody.innerHTML = `<tr><td colspan="${colCount}" class="no-results">没有找到符合条件的记录</td></tr>`;
            return;
        }

        filteredResults.forEach(result => {
            const row = document.createElement('tr');

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

                const remarkText = (result.remark || '').toString();
                const remarkExists = remarkText.trim().length > 0;
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

                if (result.has_review) {
                    const heartBtn = document.createElement('button');
                    heartBtn.className = 'heart-btn';
                    heartBtn.dataset.code = result.score_code;
                    heartBtn.title = '查看评价';
                    heartBtn.textContent = '❤️';
                    heartBtn.addEventListener('click', async () => {
                        await openReviewModal('view', result.score_code);
                    });
                    actionWrap.appendChild(heartBtn);
                }

                actionsCell.appendChild(actionWrap);
                row.appendChild(actionsCell);
            }

            resultsBody.appendChild(row);
        });

        // 更新曲谱数量显示
        const scoreCountSpan = document.getElementById('scoreCount');
        if (scoreCountSpan) {
            scoreCountSpan.textContent = `（共${filteredResults.length}个）`;
        }
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
    showIncompleteOnlyCheckbox.addEventListener('change', filterAndDisplayResults);
    hideCompletionCheckbox.addEventListener('change', filterAndDisplayResults);
    hideFavoriteCheckbox.addEventListener('change', filterAndDisplayResults);

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
    randomCopyBtn.addEventListener('click', () => {
        console.log('随机复制按钮被点击！');
        if (filteredResults.length > 0) {
            let randomIndex;
            if (filteredResults.length === 1) {
                randomIndex = 0;
            } else {
                let attempts = 0;
                do {
                    randomIndex = Math.floor(Math.random() * filteredResults.length);
                    attempts++;
                } while (randomIndex === lastRandomIndex && attempts < filteredResults.length);
            }
            lastRandomIndex = randomIndex;
            const randomScore = filteredResults[randomIndex];
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
              <button class="like-btn">${hasReview ? '查看评价 ❤️' : '添加喜欢 ❤️'}</button>
              <button class="remark-btn random-remark-btn ${hasRemark ? 'has-remark' : ''}">备注</button>
            </div>
            <div class="remark-text">${remarkDisplay}</div>
          </div>
        `;

        randomCopyInfo.querySelector('.like-btn').onclick = async function () {
          if (hasReview) {
            await openReviewModal('view', scoreObj.score_code);
          } else {
            await openReviewModal('create', scoreObj.score_code);
            // 保存成功后刷新本卡片与表格
            // openReviewModal 内部会在成功时触发 refreshResults()
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
                displayResults(data.results);
                // 更新输入框
                scoreCodesTextarea.value = data.results.map(r => r.score_code).join('\n');
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
    refreshResults();
});

// —— 评价弹窗（批量页复用） ——
const reviewModal = document.getElementById('reviewModal');
const reviewCloseBtn = document.getElementById('reviewCloseBtn');
const reviewCancelBtn = document.getElementById('reviewCancelBtn');
const reviewSubmitBtn = document.getElementById('reviewSubmitBtn');
const reviewMsg = document.getElementById('reviewMsg');
const starGroup = document.getElementById('starGroup');
const ratingInput = document.getElementById('reviewRating');
const commentInput = document.getElementById('reviewComment');
const videoInput = document.getElementById('reviewVideo');
const videoFileName = document.getElementById('videoFileName');
const fileRow = document.getElementById('reviewFileRow');
const prevRow = document.getElementById('reviewPreviewRow');
const prevVideo = document.getElementById('reviewVideoPreview');
const titleEl = document.getElementById('reviewTitle');

// 星星渲染
function paintStars(n) {
  [...starGroup.querySelectorAll('.qyj-star')].forEach(btn => {
    const v = Number(btn.dataset.val);
    const active = v <= n;
    btn.textContent = active ? '★' : '☆';
    btn.setAttribute('aria-checked', String(v === n));
    btn.classList.toggle('is-active', active);
  });
}
paintStars(Number(ratingInput.value || 5));

// 星星交互
starGroup.addEventListener('click', (e) => {
  const v = Number(e.target?.dataset?.val || 0);
  if (v >= 1 && v <= 5) {
    ratingInput.value = String(v);
    paintStars(v);
  }
});

// 文件名显示
videoInput?.addEventListener('change', () => {
  videoFileName.textContent = videoInput.files[0] ? videoInput.files[0].name : '未选择文件';
});

// 打开弹窗
async function openReviewModal(mode, scoreCode) {
  if (reviewMsg) reviewMsg.textContent = '';
  titleEl.textContent = mode === 'view' ? '查看评价' : '添加评价';

  // 控制显示/隐藏
  fileRow.style.display = mode === 'view' ? 'none' : 'block';
  prevRow.style.display = mode === 'view' ? 'block' : 'none';

  if (mode === 'view') {
    // 查看模式：获取数据并只读展示
    try {
      const resp = await fetch(`/api/reviews/${scoreCode}`);
      const data = await resp.json();
      if (!data.success || !data.has_review) {
        reviewMsg.textContent = '未找到评价数据';
        return;
      }

      // 设置只读状态
      ratingInput.value = data.rating;
      paintStars(data.rating);
      starGroup.setAttribute('aria-disabled', 'true');

      commentInput.value = data.comment || '';
      commentInput.setAttribute('readonly', 'readonly');

      // 显示视频预览
      if (data.video_url) {
        prevVideo.src = data.video_url;
      }

      // 隐藏提交按钮
      reviewSubmitBtn.style.display = 'none';
    } catch (e) {
      reviewMsg.textContent = '加载失败：' + e.message;
      return;
    }
  } else {
    // 创建模式：清空并可编辑
    ratingInput.value = '5';
    paintStars(5);
    starGroup.removeAttribute('aria-disabled');

    commentInput.value = '';
    commentInput.removeAttribute('readonly');

    videoInput.value = '';
    videoFileName.textContent = '未选择文件';

    // 显示提交按钮并设置数据
    reviewSubmitBtn.style.display = 'block';
    reviewSubmitBtn.dataset.code = scoreCode;
  }

  reviewModal.classList.add('is-open');
  reviewModal.setAttribute('aria-hidden', 'false');
}

// 关闭弹窗
function closeReviewModal() {
  reviewModal.classList.remove('is-open');
  reviewModal.setAttribute('aria-hidden', 'true');
}

reviewCancelBtn?.addEventListener('click', closeReviewModal);
reviewCloseBtn?.addEventListener('click', closeReviewModal);
reviewModal?.addEventListener('click', (e) => {
  if (e.target.matches('[data-close-modal]')) closeReviewModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && reviewModal.classList.contains('is-open')) closeReviewModal();
});

// 提交新增评价（批量页：后端当前要求"评语+视频"为必填）
reviewSubmitBtn?.addEventListener('click', async () => {
  const code = reviewSubmitBtn.dataset.code;
  const rating = Number(ratingInput.value || 5);
  if (!(rating >= 1 && rating <= 5)) {
    reviewMsg.textContent = '评分必须是 1-5';
    return;
  }

  const comment = commentInput.value.trim();
  if (!comment) {
    reviewMsg.textContent = '评语不能为空';
    return;
  }

  if (!videoInput.files[0]) {
    reviewMsg.textContent = '请选择视频文件';
    return;
  }

  const fd = new FormData();
  fd.append('score_code', code);
  fd.append('rating', String(rating));
  fd.append('comment', comment);
  fd.append('video', videoInput.files[0]);

  reviewSubmitBtn.disabled = true;
  reviewMsg.textContent = '正在保存...';

  try {
    const resp = await fetch('/api/reviews', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || '保存失败');

    reviewMsg.textContent = '保存成功！';
    // 刷新数据（更新红心状态）
    loadData();
    setTimeout(closeReviewModal, 500);
  } catch (e) {
    reviewMsg.textContent = '保存失败：' + e.message;
  } finally {
    reviewSubmitBtn.disabled = false;
  }
});

document.getElementById('createPoolFromBatchBtn').onclick = function() {
        // 获取当前筛选条件
        const minCompletion = document.getElementById('minCompletion').value;
        const maxCompletion = document.getElementById('maxCompletion').value;
        const favorite = document.getElementById('favoriteFilterBtn') ? document.getElementById('favoriteFilterBtn').dataset.state : null;
        // 获取当前曲谱码
        const codes = [];
        const resultsBody = document.getElementById('resultsBody');
        for (const row of resultsBody.querySelectorAll('tr')) {
            const codeCell = row.querySelector('td');
            if (codeCell && codeCell.textContent && /^\d{5,}$/.test(codeCell.textContent.trim())) {
                codes.push(codeCell.textContent.trim());
            }
        }
        // 构造数据
        const filter = {};
        if (minCompletion) filter.min_completion = parseInt(minCompletion);
        if (maxCompletion) filter.max_completion = parseInt(maxCompletion);
        if (favorite) filter.favorite = parseInt(favorite);
        // 存到localStorage
        localStorage.setItem('batch_pool_filter', JSON.stringify(filter));
        localStorage.setItem('batch_pool_codes', JSON.stringify(codes));
        // 跳转
        window.location.href = '/random_pool';
    };
