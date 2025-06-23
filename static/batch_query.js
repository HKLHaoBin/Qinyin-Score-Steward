document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const queryBtn = document.getElementById('queryBtn');
    const scoreCodesTextarea = document.getElementById('scoreCodes');
    const resultsBody = document.getElementById('resultsBody');
    const showIncompleteOnlyCheckbox = document.getElementById('showIncompleteOnly');
    const fetchJianshangBtn = document.getElementById('fetchJianshangBtn');
    const favoriteFilterBtn = document.getElementById('favoriteFilterBtn');
    const randomCopyBtn = document.getElementById('randomCopyBtn');
    const initialChromeInitializedElement = document.getElementById('initialChromeInitialized');
    
    let isChromeInitialized = false; // 初始状态为未初始化

    // 初始设置按钮样式和文本
    if (initialChromeInitializedElement) {
        isChromeInitialized = JSON.parse(initialChromeInitializedElement.value); // 从隐藏字段获取初始状态
    }

    if (isChromeInitialized) {
        fetchJianshangBtn.classList.remove('disabled-look');
        fetchJianshangBtn.textContent = '获取鉴赏谱';
    } else {
        fetchJianshangBtn.classList.add('disabled-look');
        fetchJianshangBtn.textContent = '获取鉴赏谱 (初始化中)';
    }

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

    // 查询按钮点击事件
    queryBtn.addEventListener('click', () => {
        const rawScoreCodes = scoreCodesTextarea.value.trim();
        if (rawScoreCodes) {
            // 如果有输入内容，执行批量查询
            const codes = extractScoreCodes(rawScoreCodes); // 使用 extractScoreCodes 进行验证和提取
            if (codes.length === 0) {
                showToast('未找到有效的曲谱码');
                return;
            }
            fetch('/api/scores/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ score_codes: codes })
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
            // 如果输入框为空，显示所有历史记录
            refreshResults();
        }
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
        refreshResults();
    });

    // 收藏筛选
    favoriteFilterBtn.addEventListener('click', () => {
        const states = ['全部', '仅收藏', '仅未收藏'];
        const currentState = currentFilters.favorite;
        currentFilters.favorite = (currentState + 1) % 3;
        favoriteFilterBtn.textContent = states[currentFilters.favorite];
        favoriteFilterBtn.classList.toggle('active', currentFilters.favorite !== 0);
        refreshResults();
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

        if (filteredResults.length === 0) {
            resultsBody.innerHTML = '<tr><td colspan="3" class="no-results">没有找到符合条件的记录</td></tr>';
            return;
        }

        filteredResults.forEach(result => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${result.score_code}</td>
                <td>${result.completion !== null ? result.completion + '%' : '-'}</td>
                <td>
                    <button class="favorite-btn" onclick="toggleFavorite('${result.score_code}')">
                        ${result.is_favorite ? '★' : '☆'}
                    </button>
                </td>
            `;
            resultsBody.appendChild(row);
        });
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

    // 剪贴板更新（来自主页的完成率保存）
    socket.on('clipboard_update', function(data) {
        // 只有当类型是 'completion' 并且有 score_code 时才触发更新
        if (data.type === 'completion' && data.score_code) {
            // 如果输入框有内容，则重新查询输入框中的曲谱
            const rawScoreCodes = scoreCodesTextarea.value.trim();
            if (rawScoreCodes) {
                const codes = extractScoreCodes(rawScoreCodes);
                if (codes.length > 0) {
                    fetch('/api/scores/batch', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ score_codes: codes })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            displayResults(data.results);
                        }
                    })
                    .catch(error => console.error('Error refreshing batch query on clipboard update:', error));
                } else {
                    refreshResults(); // 输入框无有效码，刷新所有
                }
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
            const codes = extractScoreCodes(rawScoreCodes);
            if (codes.length > 0) {
                fetch('/api/scores/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ score_codes: codes })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        displayResults(data.results);
                    }
                })
                .catch(error => console.error('Error refreshing batch query on favorite update:', error));
            } else {
                refreshResults(); // 输入框无有效码，刷新所有
            }
        } else {
            refreshResults(); // 输入框为空，刷新所有
        }
    });

    // 随机复制按钮点击事件
    randomCopyBtn.addEventListener('click', () => {
        console.log('随机复制按钮被点击！');
        if (filteredResults.length > 0) {
            const randomIndex = Math.floor(Math.random() * filteredResults.length);
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

    // 鉴赏谱获取按钮点击事件
    fetchJianshangBtn.addEventListener('click', async function() {
        // 如果Chrome未初始化完成，则弹出提示并阻止后续操作
        if (!isChromeInitialized) {
            showToast('该功能初始化未完成，可能需要较长时间。');
            return;
        }

        try {
            fetchJianshangBtn.disabled = true; // 临时禁用，防止重复点击
            fetchJianshangBtn.textContent = '正在获取...';
            
            const response = await fetch('/api/fetch_jianshang');
            const data = await response.json();
            
            if (data.success) {
                displayResults(data.results);
                // 更新输入框
                scoreCodesTextarea.value = data.results.map(r => r.score_code).join('\n');
                showToast(`成功获取 ${data.results.length} 个曲谱码`);
            } else {
                showToast('获取鉴赏谱失败：' + data.error);
            }
        } catch (error) {
            showToast('获取鉴赏谱时发生错误：' + error.message);
        } finally {
            // 只有当初始化成功时，才在获取鉴赏谱后恢复按钮状态
            if (fetchJianshangBtn.dataset.initialized === 'true') {
                fetchJianshangBtn.disabled = false;
                fetchJianshangBtn.textContent = '获取鉴赏谱';
            }
        }
    });

    // 监听Chrome初始化状态
    socket.on('chrome_init_status', function(data) {
        isChromeInitialized = data.success; // 更新初始化状态
        if (data.success) {
            fetchJianshangBtn.textContent = '获取鉴赏谱';
            fetchJianshangBtn.classList.remove('disabled-look'); // 移除禁用样式
            showToast(data.message);
        } else {
            fetchJianshangBtn.textContent = '获取鉴赏谱 (初始化失败)';
            fetchJianshangBtn.classList.add('disabled-look'); // 添加禁用样式
            showToast(data.message + '，可能需要较长时间，请稍后重试。');
        }
    });

    // 初始加载
    refreshResults();
}); 