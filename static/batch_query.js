document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const queryBtn = document.getElementById('queryBtn');
    const scoreCodesTextarea = document.getElementById('scoreCodes');
    const resultsBody = document.getElementById('resultsBody');
    const showIncompleteOnlyCheckbox = document.getElementById('showIncompleteOnly');
    const fetchJianshangBtn = document.getElementById('fetchJianshangBtn');
    const favoriteFilterBtn = document.getElementById('favoriteFilterBtn');
    
    let currentResults = []; // 存储当前查询结果
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
        const scoreCodes = scoreCodesTextarea.value.trim();
        if (scoreCodes) {
            // 如果有输入内容，执行批量查询
            const codes = scoreCodes.split(/[\n,，\s]+/).filter(code => code.trim());
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
        const filteredResults = showIncompleteOnlyCheckbox.checked 
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

    // 收藏状态更新
    socket.on('favorite_update', function(data) {
        refreshResults();
    });

    // 鉴赏谱获取按钮点击事件
    fetchJianshangBtn.addEventListener('click', async function() {
        try {
            fetchJianshangBtn.disabled = true;
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
            fetchJianshangBtn.disabled = false;
            fetchJianshangBtn.textContent = '获取鉴赏谱';
        }
    });

    // 初始加载
    refreshResults();
}); 