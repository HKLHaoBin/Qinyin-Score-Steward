console.log('batch_query.js 脚本开始加载');
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded 事件触发，开始初始化');
    const socket = io();
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
    
    let isChromeInitialized = false; // 初始状态为未初始化
    let excludeList = [];

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

    // 查询和排除统一的查询行为
    function doQuery() {
        const rawScoreCodes = scoreCodesTextarea.value.trim();
        const rawExcludeCodes = excludeCodesTextarea.value.trim();
        const codes = rawScoreCodes ? extractScoreCodes(rawScoreCodes) : [];
        const excludeCodes = rawExcludeCodes ? extractScoreCodes(rawExcludeCodes) : [];
        // 只要有"曲谱码"或"排除"有内容，就用 batch 查询
        if (codes.length > 0 || excludeCodes.length > 0) {
            fetch('/api/scores/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    score_codes: codes, 
                    exclude_codes: excludeCodes,
                    min_completion: currentFilters.minCompletion,
                    max_completion: currentFilters.maxCompletion,
                    favorite: currentFilters.favorite
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
        // 判断输入框内容
        if (scoreCodesTextarea.value.trim()) {
            doQuery();
        } else {
            refreshResults();
        }
    });

    // 收藏筛选
    favoriteFilterBtn.addEventListener('click', () => {
        const states = ['全部', '仅收藏', '仅未收藏'];
        const currentState = currentFilters.favorite;
        currentFilters.favorite = (currentState + 1) % 3;
        favoriteFilterBtn.textContent = states[currentFilters.favorite];
        favoriteFilterBtn.classList.toggle('active', currentFilters.favorite !== 0);
        // 判断输入框内容
        if (scoreCodesTextarea.value.trim()) {
            doQuery();
        } else {
            refreshResults();
        }
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
        currentResults = results; // 保存当前结果
        filterAndDisplayResults();
    }

    // 筛选并显示结果
    function filterAndDisplayResults() {
        resultsBody.innerHTML = '';
        filteredResults = showIncompleteOnlyCheckbox.checked 
            ? currentResults.filter(result => result.completion === null)
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
            let rowHtml = `<td>${result.score_code}</td>`;
            if (!hideCompletionCheckbox.checked) {
                rowHtml += `<td>${result.completion !== null ? result.completion + '%' : '-'}</td>`;
            }
            if (!hideFavoriteCheckbox.checked) {
                rowHtml += `<td><button class="favorite-btn" onclick="toggleFavorite('${result.score_code}')">${result.is_favorite ? '★' : '☆'}</button></td>`;
            }
            row.innerHTML = rowHtml;
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
            // 如果输入框有内容，则重新查询输入框中的曲谱
            const rawScoreCodes = scoreCodesTextarea.value.trim();
            if (rawScoreCodes) {
                doQuery();
            } else {
                refreshResults(); // 输入框为空，刷新所有
            }
        }
    });

    // 收藏状态更新
    socket.on('favorite_update', function(data) {
        // 重新查询以反映收藏状态的变化
        const rawScoreCodes = scoreCodesTextarea.value.trim();
        if (rawScoreCodes) {
            doQuery();
        } else {
            refreshResults(); // 输入框为空，刷新所有
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
        const completionText = scoreObj.completion !== null ? `${scoreObj.completion}%` : '未完成';
        const favoriteIcon = scoreObj.is_favorite ? '★' : '☆';
        randomCopyInfo.innerHTML = `
          <div class="random-info-card">
            <div class="score-code-row">
              <span class="score-code">${scoreObj.score_code}</span>
              <span class="favorite-icon" style="cursor:pointer;">${favoriteIcon}</span>
            </div>
            <div class="completion-row">
              完成率：<span class="completion-badge" style="cursor:pointer;">${completionText}</span>
            </div>
          </div>
        `;
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