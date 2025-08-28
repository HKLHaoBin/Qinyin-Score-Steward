document.addEventListener('DOMContentLoaded', () => {
    if (typeof io === 'undefined') {
        console.error('Socket.IO 库未正确加载，请检查网络连接或刷新页面');
        alert('Socket.IO 库加载失败，部分功能可能无法正常使用。请检查网络连接后刷新页面。');
        return;
    }
    
    const socket = io();
    const historyList = document.getElementById('historyList');
    const messageDisplay = document.getElementById('message');
    const favoriteBtn = document.getElementById('favoriteBtn');
    const completionInput = document.getElementById('completionInput');
    const saveBtn = document.getElementById('saveBtn');
    const currentScoreCodeDisplay = document.getElementById('currentScoreCode');
    const statusBox = document.querySelector('.status-box');
    let currentScoreCode = null;
    let showFavoritesOnly = false;  // 显示收藏的标志
    let showScoreCodeOnly = false;  // 仅显示曲谱码的标志
    
    // 创建统计信息显示元素
    const statsDiv = document.createElement('div');
    statsDiv.className = 'stats-info';
    historyList.parentNode.insertBefore(statsDiv, historyList);

    // 创建过滤按钮
    const filterDiv = document.createElement('div');
    filterDiv.className = 'filter-controls';
    filterDiv.innerHTML = `
        <button id="filterBtn" class="filter-btn">显示所有</button>
        <button id="scoreCodeFilterBtn" class="filter-btn">显示完整信息</button>
    `;
    historyList.parentNode.insertBefore(filterDiv, historyList);

    // 收藏过滤按钮点击事件
    document.getElementById('filterBtn').addEventListener('click', function() {
        showFavoritesOnly = !showFavoritesOnly;
        this.textContent = showFavoritesOnly ? '显示所有' : '仅显示收藏';
        refreshHistory();
    });

    // 曲谱码过滤按钮点击事件
    document.getElementById('scoreCodeFilterBtn').addEventListener('click', function() {
        showScoreCodeOnly = !showScoreCodeOnly;
        this.textContent = showScoreCodeOnly ? '显示完整信息' : '仅显示曲谱码';
        refreshHistory();
    });

    // 更新统计信息
    function updateStats() {
        fetch('/api/scores/stats')
            .then(response => response.json())
            .then(stats => {
                statsDiv.innerHTML = `
                    <div class="stats-content">
                        <span>总记录数：${stats.total_records} 条</span>
                        <span>不同歌曲：${stats.unique_songs} 首</span>
                        <span>收藏歌曲：${stats.favorite_songs} 首</span>
                    </div>
                `;
            })
            .catch(error => console.error('获取统计信息失败:', error));
    }

    // 初始加载统计信息
    updateStats();

    // 更新当前状态
    socket.on('clipboard_update', function(data) {
        if (data.type === 'score_code') {
            currentScoreCode = data.score_code;
            document.getElementById('currentStatus').textContent = '正在游玩中...';
            currentScoreCodeDisplay.textContent = data.score_code;
            document.getElementById('currentCompletion').textContent = '-';
            completionInput.value = '';
            messageDisplay.textContent = '';
            saveBtn.disabled = false;
            
            // 显示收藏按钮并重置状态
            favoriteBtn.style.display = 'inline-block';
            if (data.exists) {
                statusBox.className = 'status-box exists';
                document.getElementById('currentCompletion').textContent = data.completion + '%';
                completionInput.value = data.completion;
                favoriteBtn.textContent = data.is_favorite ? '★' : '☆';
            } else {
                statusBox.className = 'status-box not-exists';
                favoriteBtn.textContent = '☆';  // 新曲谱码时重置为未收藏状态
            }
        } else if (data.type === 'completion') {
            document.getElementById('currentStatus').textContent = '已完成';
            document.getElementById('currentCompletion').textContent = data.completion + '%';
            completionInput.value = data.completion;
            messageDisplay.textContent = data.message;
            saveBtn.disabled = true;
            // 添加到历史记录
            addToHistory(data);
            updateStats();
        }
    });

    // 保存按钮点击事件
    saveBtn.addEventListener('click', function() {
        const completion = parseInt(completionInput.value);
        if (completion >= 0 && completion <= 100 && currentScoreCode) {
            fetch('/api/scores/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    score_code: currentScoreCode,
                    completion: completion
                })
            }).then(() => {
                // 保存成功后刷新历史记录
                refreshHistory();
            });
        }
    });

    // 输入框变化事件
    completionInput.addEventListener('input', function() {
        const value = parseInt(this.value);
        saveBtn.disabled = !(value >= 0 && value <= 100);
    });

    // 更新收藏状态
    socket.on('favorite_update', function(data) {
        if (data.score_code === currentScoreCode) {
            favoriteBtn.textContent = data.is_favorite ? '★' : '☆';
        }
        // 更新历史记录中的收藏状态
        updateHistoryFavorite(data.score_code, data.is_favorite);
        updateStats();
    });

    // 收藏按钮点击事件
    favoriteBtn.addEventListener('click', function() {
        if (currentScoreCode) {
            // 先保存完成率
            const completion = parseInt(completionInput.value);
            if (completion >= 0 && completion <= 100) {
                fetch('/api/scores/save', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        score_code: currentScoreCode,
                        completion: completion
                    })
                });
            }
            
            // 然后更新收藏状态
            fetch(`/api/scores/${currentScoreCode}/favorite`, {
                method: 'POST'
            }).then(() => {
                // 收藏状态更新后刷新历史记录
                refreshHistory();
            });
        }
    });

    // 添加历史记录
    function addToHistory(data) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.id = `history-${data.score_code}`;
        const now = new Date().toLocaleString();
        item.innerHTML = `
            <div class="history-content">
                <div>曲谱码：<span class="score-code">${data.score_code}</span></div>
                <div>完成率：<span class="completion">${data.completion}%</span></div>
                <div class="timestamp">${now}</div>
            </div>
            <span class="favorite-btn">${data.is_favorite ? '★' : '☆'}</span>
        `;
        historyList.insertBefore(item, historyList.firstChild);
    }

    // 更新历史记录中的收藏状态
    function updateHistoryFavorite(scoreCode, isFavorite) {
        const item = document.getElementById(`history-${scoreCode}`);
        if (item) {
            const btn = item.querySelector('.favorite-btn');
            if (btn) {
                btn.textContent = isFavorite ? '★' : '☆';
            }
        }
    }

    // 切换收藏状态
    window.toggleFavorite = function(scoreCode) {
        fetch(`/api/scores/${scoreCode}/favorite`, {
            method: 'POST'
        });
    };

    // 刷新历史记录
    function refreshHistory() {
        fetch('/api/scores')
            .then(response => response.json())
            .then(scores => {
                // 清空现有历史记录
                historyList.innerHTML = '';
                // 过滤并添加记录
                scores
                    .filter(score => !showFavoritesOnly || score.is_favorite)
                    .forEach(score => {
                        const item = document.createElement('div');
                        item.className = 'history-item';
                        item.id = `history-${score.score_code}`;
                        const date = new Date(score.created_at).toLocaleString();
                        
                        if (showScoreCodeOnly) {
                            item.innerHTML = `
                                <div class="history-content">
                                    <div>曲谱码：<span class="score-code">${score.score_code}</span></div>
                                </div>
                                <span class="favorite-btn">${score.is_favorite ? '★' : '☆'}</span>
                            `;
                        } else {
                            item.innerHTML = `
                                <div class="history-content">
                                    <div>曲谱码：<span class="score-code">${score.score_code}</span></div>
                                    <div>完成率：<span class="completion">${score.completion}%</span></div>
                                    <div class="timestamp">${date}</div>
                                </div>
                                <span class="favorite-btn">${score.is_favorite ? '★' : '☆'}</span>
                            `;
                        }
                        historyList.appendChild(item);
                    });
            });
    }

    // 加载历史记录
    refreshHistory();
}); 

