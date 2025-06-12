document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    const queryBtn = document.getElementById('queryBtn');
    const scoreCodesTextarea = document.getElementById('scoreCodes');
    const resultsBody = document.getElementById('resultsBody');
    const showIncompleteOnlyCheckbox = document.getElementById('showIncompleteOnly');
    const fetchJianshangBtn = document.getElementById('fetchJianshangBtn');
    let currentResults = []; // 存储当前查询结果

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
    queryBtn.addEventListener('click', async function() {
        const scoreCodes = extractScoreCodes(scoreCodesTextarea.value);

        if (scoreCodes.length === 0) {
            alert('未找到有效的曲谱码！\n注意：曲谱码必须至少为5位数。');
            return;
        }

        try {
            const response = await fetch('/api/scores/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ score_codes: scoreCodes })
            });

            const data = await response.json();
            if (data.success) {
                displayResults(data.results);
            } else {
                alert('查询失败：' + data.error);
            }
        } catch (error) {
            alert('查询出错：' + error.message);
        }
    });

    // 显示查询结果
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

        filteredResults.forEach(result => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${result.score_code}</td>
                <td>${result.completion !== null ? result.completion + '%' : '未完成'}</td>
                <td><span class="favorite-star ${result.is_favorite ? 'favorited' : ''}" data-score-code="${result.score_code}">${result.is_favorite ? '★' : '☆'}</span></td>
            `;
            resultsBody.appendChild(row);
        });
    }

    // 添加复选框变化事件监听
    showIncompleteOnlyCheckbox.addEventListener('change', filterAndDisplayResults);

    // 监听完成率更新
    socket.on('clipboard_update', function(data) {
        if (data.type === 'completion' && currentResults.length > 0) {
            // 更新当前结果中的完成率
            const result = currentResults.find(r => r.score_code === data.score_code);
            if (result) {
                result.completion = data.completion;
                filterAndDisplayResults();
            }
        }
    });

    // 监听收藏状态更新
    socket.on('favorite_update', function(data) {
        const star = document.querySelector(`.favorite-star[data-score-code="${data.score_code}"]`);
        if (star) {
            star.classList.toggle('favorited', data.is_favorite);
            star.textContent = data.is_favorite ? '★' : '☆';
        }
    });

    fetchJianshangBtn.addEventListener('click', async function() {
        try {
            fetchJianshangBtn.disabled = true;
            fetchJianshangBtn.textContent = '正在获取...';
            
            const response = await fetch('/api/fetch_jianshang');
            const data = await response.json();
            
            if (data.success) {
                // 清空当前结果
                resultsBody.innerHTML = '';
                
                // 显示新结果
                data.results.forEach(result => {
                    if (!showIncompleteOnlyCheckbox.checked || result.completion === null || result.completion < 100) {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${result.score_code}</td>
                            <td>${result.completion !== null ? result.completion + '%' : '未完成'}</td>
                            <td>
                                <button class="favorite-btn ${result.is_favorite ? 'favorited' : ''}" 
                                        onclick="toggleFavorite('${result.score_code}')">
                                    ${result.is_favorite ? '★' : '☆'}
                                </button>
                            </td>
                        `;
                        resultsBody.appendChild(row);
                    }
                });
                
                // 更新输入框
                scoreCodesTextarea.value = data.results.map(r => r.score_code).join('\n');
            } else {
                alert('获取鉴赏谱失败：' + data.error);
            }
        } catch (error) {
            alert('获取鉴赏谱时发生错误：' + error.message);
        } finally {
            fetchJianshangBtn.disabled = false;
            fetchJianshangBtn.textContent = '获取鉴赏谱';
        }
    });
}); 