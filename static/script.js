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
            // 刷新历史记录和统计信息
            refreshHistory();
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

    // 防抖函数
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 自动保存函数
    const autoSave = debounce(function() {
        const value = parseInt(completionInput.value);
        if (!isNaN(value) && value >= 0 && value <= 100 && currentScoreCode) {
            fetch('/api/scores/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    score_code: currentScoreCode,
                    completion: value
                })
            }).then(() => {
                // 保存成功后更新显示
                document.getElementById('currentCompletion').textContent = value + '%';
                // 刷新历史记录
                refreshHistory();
            });
        }
    }, 1000);

    // 输入框变化事件
    completionInput.addEventListener('input', function() {
        const value = parseInt(this.value);
        saveBtn.disabled = !(value >= 0 && value <= 100);
        // 触发自动保存
        autoSave();
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
    favoriteBtn.addEventListener('click', async function() {
        if (currentScoreCode) {
            // 先保存完成率（如果有有效值）
            const completion = parseInt(completionInput.value);
            if (!isNaN(completion) && completion >= 0 && completion <= 100) {
                await fetch('/api/scores/save', {
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
            const response = await fetch(`/api/scores/${currentScoreCode}/favorite`, {
                method: 'POST'
            });
            
            if (response.ok) {
                const result = await response.json();
                // 立即更新按钮状态
                favoriteBtn.textContent = result.is_favorite ? '★' : '☆';
                // 刷新历史记录
                refreshHistory();
            }
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

    // 等待 DOM 加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initReviewModal);
    } else {
      initReviewModal();
    }

    function initReviewModal() {
      const reviewBtn = document.getElementById('reviewBtn');
      const favoriteBtn = document.getElementById('favoriteBtn');
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
      const currentScoreEl = document.getElementById('currentScoreCode');
      const reviewTitle = document.getElementById('reviewTitle');
      const reviewFileRow = document.getElementById('reviewFileRow');
      const reviewPreviewRow = document.getElementById('reviewPreviewRow');
      const reviewVideoPreview = document.getElementById('reviewVideoPreview');

      // 检查必要的元素是否存在
      if (!reviewBtn || !reviewModal || !starGroup || !ratingInput) {
        console.warn('评价弹窗所需的部分元素未找到');
        return;
      }

      let currentScoreCode = '-';

      // —— 工具函数 ——
      const isValidScore = (v) => /^\d{5,}$/.test(String(v || '').trim());
      const isVisible = (el) => !!el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;

      // —— 同步“爱心”按钮的显示时机：与“收藏”按钮一致 ——
      function syncReviewButtonVisibility() {
        // 检查 favoriteBtn 是否存在
        if (!favoriteBtn) {
          if (reviewBtn) reviewBtn.style.display = 'none';
          return;
        }

        // 只要“收藏”按钮出现，“爱心”也出现；否则隐藏
        if (isVisible(favoriteBtn)) {
          reviewBtn.style.display = 'inline-flex';
        } else {
          reviewBtn.style.display = 'none';
          closeModal(); // 若收藏隐藏了，弹窗也一并收起
        }
      }

      // 初始同步一次
      syncReviewButtonVisibility();

      // 监听收藏按钮的显示变化（如果元素存在）
      if (favoriteBtn) {
        const favObserver = new MutationObserver(syncReviewButtonVisibility);
        favObserver.observe(favoriteBtn, { attributes: true, attributeFilter: ['style', 'class'] });
      }

      // 让星星“点亮”
      function paintStars(n) {
        [...starGroup.querySelectorAll('.qyj-star')].forEach(btn => {
          const v = Number(btn.dataset.val);
          const active = v <= n;
          btn.textContent = active ? '★' : '☆';
          btn.setAttribute('aria-checked', String(v === n));
          btn.classList.toggle('is-active', active);
        });
      }
      paintStars(Number(ratingInput.value) || 5);

      // 星星交互：点击/键盘
      starGroup.addEventListener('click', (e) => {
        const v = Number(e.target?.dataset?.val || 0);
        if (v >= 1 && v <= 5) {
          ratingInput.value = String(v);
          paintStars(v);
        }
      });

      starGroup.addEventListener('keydown', (e) => {
        const cur = Number(ratingInput.value) || 5;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          const v = Math.max(1, cur - 1);
          ratingInput.value = String(v);
          paintStars(v);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          const v = Math.min(5, cur + 1);
          ratingInput.value = String(v);
          paintStars(v);
        }
      });

      // 视频文件名展示
      if (videoInput) {
        videoInput.addEventListener('change', () => {
          videoFileName.textContent = videoInput.files[0] ? videoInput.files[0].name : '未选择文件';
        });
      }

      // 渲染查看模式
      function renderViewMode(reviewData) {
        if (reviewTitle) reviewTitle.textContent = '查看评价';
        if (reviewFileRow) reviewFileRow.style.display = 'none';
        if (reviewPreviewRow) reviewPreviewRow.style.display = 'block';

        // 设置只读状态
        if (ratingInput) {
          ratingInput.value = reviewData.rating;
          paintStars(reviewData.rating);
          starGroup.setAttribute('aria-disabled', 'true');
        }
        if (commentInput) {
          commentInput.value = reviewData.comment || '';
          commentInput.setAttribute('readonly', 'readonly');
        }

        // 显示视频预览
        if (reviewData.video_url && reviewVideoPreview) {
          reviewVideoPreview.src = reviewData.video_url;
          if (reviewPreviewRow) reviewPreviewRow.style.display = 'block';
        } else if (reviewPreviewRow) {
          reviewPreviewRow.style.display = 'none';
        }

        // 隐藏提交按钮
        if (reviewSubmitBtn) reviewSubmitBtn.style.display = 'none';
      }

      // 渲染创建模式
      function renderCreateMode() {
        if (reviewTitle) reviewTitle.textContent = '添加评价';
        if (reviewFileRow) reviewFileRow.style.display = 'block';
        if (reviewPreviewRow) reviewPreviewRow.style.display = 'none';

        // 清空并恢复可编辑状态
        if (ratingInput) {
          ratingInput.value = '5';
          paintStars(5);
          starGroup.removeAttribute('aria-disabled');
        }
        if (commentInput) {
          commentInput.value = '';
          commentInput.removeAttribute('readonly');
        }
        if (videoInput) videoInput.value = '';
        if (videoFileName) videoFileName.textContent = '未选择文件';

        // 显示提交按钮
        if (reviewSubmitBtn) reviewSubmitBtn.style.display = 'block';
      }

      // 打开/关闭弹窗
      async function openModal(mode = 'create') {
        if (reviewMsg) reviewMsg.textContent = '';
        if (!isValidScore(currentScoreCode)) {
          // 不弹空壳，直接给出提示
          toast('请先复制有效曲谱码（纯数字 5 位以上）');
          return;
        }

        if (mode === 'view') {
          // 获取评价数据
          try {
            const resp = await fetch(`/api/reviews/${currentScoreCode}`);
            const data = await resp.json();
            if (data.success && data.has_review) {
              renderViewMode(data);
            } else {
              // 如果没有找到评价，切换到创建模式
              renderCreateMode();
            }
          } catch (error) {
            console.error('获取评价数据失败:', error);
            toast('获取评价数据失败');
            return;
          }
        } else {
          renderCreateMode();
        }

        reviewModal.classList.add('is-open');
        reviewModal.setAttribute('aria-hidden', 'false');
      }

      function closeModal() {
        reviewModal.classList.remove('is-open');
        reviewModal.setAttribute('aria-hidden', 'true');
      }

      // 绑定按钮事件（检查元素是否存在）
      if (reviewBtn) {
        reviewBtn.addEventListener('click', () => {
          // 根据按钮当前显示的图标决定打开哪种模式
          if (reviewBtn.textContent === '❤️') {
            openModal('view');  // 已评价，打开查看模式
          } else {
            openModal('create');  // 未评价，打开创建模式
          }
        });
      }
      if (reviewCancelBtn) reviewCancelBtn.addEventListener('click', closeModal);
      if (reviewCloseBtn) reviewCloseBtn.addEventListener('click', closeModal);

      // 点击空白关闭
      reviewModal.addEventListener('click', (e) => {
        if (e.target.matches('[data-close-modal]')) closeModal();
      });

      // ESC 关闭
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && reviewModal.classList.contains('is-open')) closeModal();
      });

      // 与后端 socket 同步当前曲谱码（已在项目中使用 socket.io）
      const socket = window.io?.();
      if (socket) {
        socket.on('clipboard_update', (data) => {
          if (data?.type === 'score_code' && data?.score_code) {
            currentScoreCode = data.score_code;
            syncReviewButtonVisibility();
            // 同步心形状态
            if (reviewBtn) {
              if (data.has_review) {
                reviewBtn.textContent = '❤️';  // 已评价显示实心心形
              } else {
                reviewBtn.textContent = '🩶';  // 未评价显示空心心形
              }
            }
          }
        });
      }

      // 检查曲谱评价状态
      async function checkReviewStatus(scoreCode) {
        if (!reviewBtn || !scoreCode) return;

        try {
          // 这里需要调用后端API检查该曲谱是否有评价
          // 由于目前没有专门的API检查评价状态，我们暂时将按钮设置为默认状态
          // 当有相应的API时，可以在这里实现检查逻辑
          reviewBtn.textContent = '🩶';
        } catch (error) {
          console.warn('检查评价状态失败:', error);
          // 出错时保持默认状态
          reviewBtn.textContent = '🩶';
        }
      }

      // 兜底：监视页面上的曲谱码变化
      if (currentScoreEl) {
        const codeObserver = new MutationObserver(() => {
          const v = currentScoreEl?.textContent?.trim();
          if (isValidScore(v)) {
            currentScoreCode = v;
            syncReviewButtonVisibility();
          }
        });
        codeObserver.observe(currentScoreEl, { childList: true, subtree: true });
      }

      // 提交创建评价（严格 4 个信息：打分/评语/视频/曲谱码；不再上传 is_top）
      if (reviewSubmitBtn) {
        reviewSubmitBtn.addEventListener('click', async () => {
          if (!isValidScore(currentScoreCode)) {
            if (reviewMsg) reviewMsg.textContent = '曲谱码无效';
            return;
          }

          // 检查评语是否为空
          const comment = commentInput.value.trim();
          if (!comment) {
            if (reviewMsg) reviewMsg.textContent = '评语不能为空';
            return;
          }

          const rating = Number(ratingInput.value || 5);
          if (!(rating >= 1 && rating <= 5)) {
            if (reviewMsg) reviewMsg.textContent = '评分必须是 1-5';
            return;
          }

          // 检查视频是否已选择
          if (!videoInput || !videoInput.files || !videoInput.files[0]) {
            if (reviewMsg) reviewMsg.textContent = '请选择要上传的视频文件';
            return;
          }

          const fd = new FormData();
          fd.append('score_code', currentScoreCode);
          fd.append('rating', String(rating));
          fd.append('comment', comment);
          fd.append('video', videoInput.files[0]);

          reviewSubmitBtn.disabled = true;
          if (reviewMsg) reviewMsg.textContent = '正在保存...';

          try {
            const resp = await fetch('/api/reviews', { method: 'POST', body: fd });
            const data = await resp.json();
            if (!resp.ok || !data.success) throw new Error(data.error || '保存失败');

            if (reviewMsg) reviewMsg.textContent = '保存成功！';
            toast('评价已保存');
            // 更新评价按钮状态为实心心形
            if (reviewBtn) {
              reviewBtn.textContent = '❤️';
            }
            // 更新当前曲谱码的评价状态（如果需要的话，可以触发一个事件来更新主界面的状态）
            setTimeout(closeModal, 500);
          } catch (e) {
            const errorMsg = '保存失败：' + e.message;
            if (reviewMsg) reviewMsg.textContent = errorMsg;
            toast(errorMsg);
          } finally {
            reviewSubmitBtn.disabled = false;
          }
        });
      }

      // 轻量吐司
      let toastTimer = null;
      function toast(text) {
        let t = document.querySelector('.qyj-toast');
        if (!t) {
          t = document.createElement('div');
          t.className = 'qyj-toast';
          document.body.appendChild(t);
        }
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
      }
    }