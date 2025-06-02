document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    const queryBtn = document.getElementById('queryBtn');
    const scoreCodesTextarea = document.getElementById('scoreCodes');
    const resultsBody = document.getElementById('resultsBody');

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
        resultsBody.innerHTML = '';
        results.forEach(result => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${result.score_code}</td>
                <td>${result.completion !== null ? result.completion + '%' : '未完成'}</td>
                <td><span class="favorite-star ${result.is_favorite ? 'favorited' : ''}">${result.is_favorite ? '★' : '☆'}</span></td>
            `;
            resultsBody.appendChild(row);
        });
    }

    // 监听收藏状态更新
    socket.on('favorite_update', function(data) {
        const star = document.querySelector(`.favorite-star[data-score-code="${data.score_code}"]`);
        if (star) {
            star.classList.toggle('favorited', data.is_favorite);
            star.textContent = data.is_favorite ? '★' : '☆';
        }
    });
}); 