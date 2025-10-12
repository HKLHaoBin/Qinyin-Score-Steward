// 通用评价弹窗逻辑，供首页与批量页共用
(function (window, document) {
  class ReviewModal {
    constructor(options = {}) {
      this.modalId = options.modalId || 'reviewModal';
      this.modal = document.getElementById(this.modalId);
      if (!this.modal) {
        console.warn(`ReviewModal: 未找到 id 为 ${this.modalId} 的弹窗节点`);
        this.ready = false;
        return;
      }

      this.fetchReviewFn = typeof options.fetchReview === 'function'
        ? options.fetchReview
        : this.defaultFetchReview.bind(this);
      this.createReviewFn = typeof options.createReview === 'function'
        ? options.createReview
        : this.defaultCreateReview.bind(this);
      this.toastDuration = options.toastDuration || 1800;

      // 缓存常用节点
      this.reviewCloseBtn = document.getElementById('reviewCloseBtn');
      this.reviewCancelBtn = document.getElementById('reviewCancelBtn');
      this.reviewSubmitBtn = document.getElementById('reviewSubmitBtn');
      this.reviewMsg = document.getElementById('reviewMsg');
      this.starGroup = document.getElementById('starGroup');
      this.ratingInput = document.getElementById('reviewRating');
      this.commentInput = document.getElementById('reviewComment');
      this.videoInput = document.getElementById('reviewVideo');
      this.videoFileName = document.getElementById('videoFileName');
      this.reviewTitle = document.getElementById('reviewTitle');
      this.reviewVideoSourceField = document.getElementById('reviewVideoSourceField');
      this.videoSourceRadios = Array.from(document.querySelectorAll('input[name="reviewVideoSource"]'));
      this.reviewFileRow = document.getElementById('reviewFileRow');
      this.reviewUrlRow = document.getElementById('reviewUrlRow');
      this.videoUrlInput = document.getElementById('reviewVideoUrl');
      this.reviewPreviewRow = document.getElementById('reviewPreviewRow');
      this.reviewVideoPreview = document.getElementById('reviewVideoPreview');
      this.reviewEmbedPreview = document.getElementById('reviewEmbedPreview');

      this.scoreCode = null;
      this.mode = 'create';
      this.onSaved = null;
      this.toastEl = null;
      this.toastTimer = null;
      this.ready = true;

      this.bindBaseEvents();
      this.paintStars(Number(this.ratingInput?.value) || 5);
      this.updateVideoSourceUI('upload');
    }

    isReady() {
      return this.ready;
    }

    async open(options = {}) {
      if (!this.ready) return { mode: null };

      const scoreCode = (options.scoreCode || '').toString().trim();
      if (!this.isValidScore(scoreCode)) {
        this.toast(options.invalidMessage || '请先复制有效曲谱码（纯数字 5 位以上）');
        return { mode: null };
      }

      this.scoreCode = scoreCode;
      this.onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
      this.setMessage('');

      const preferredMode = options.mode || 'auto';
      const fallbackToCreate = options.fallbackToCreate !== false;

      if (preferredMode === 'create') {
        this.renderCreateMode(options.prefill || {});
        this.show();
        return { mode: this.mode };
      }

      try {
        const data = await this.fetchReviewFn(scoreCode);
        if (data && data.success && data.has_review) {
          this.renderViewMode(data);
          this.show();
          return { mode: this.mode };
        }
        if (!fallbackToCreate) {
          this.setMessage('未找到评价数据');
          this.show();
          return { mode: this.mode };
        }
      } catch (error) {
        if (!fallbackToCreate) {
          this.setMessage(error.message || '获取评价数据失败');
          this.show();
          return { mode: this.mode };
        }
        this.toast('获取评价数据失败，切换到创建模式');
      }

      this.renderCreateMode(options.prefill || {});
      this.show();
      return { mode: this.mode };
    }

    close() {
      if (!this.ready) return;
      this.resetPreview();
      if (this.modal) {
        this.modal.classList.remove('is-open');
        this.modal.setAttribute('aria-hidden', 'true');
      }
      this.setMessage('');
      this.setSubmitDisabled(false);
    }

    // —— 内部逻辑 ——
    bindBaseEvents() {
      this.boundHandleSubmit = this.handleSubmit.bind(this);
      this.boundClose = this.close.bind(this);
      this.boundHandleStarClick = (e) => this.handleStarClick(e);
      this.boundHandleStarKeydown = (e) => this.handleStarKeydown(e);
      this.boundHandleFileChange = () => this.updateFileName();
      this.boundHandleEsc = (e) => {
        if (e.key === 'Escape' && this.modal.classList.contains('is-open')) {
          this.close();
        }
      };

      this.reviewSubmitBtn?.addEventListener('click', this.boundHandleSubmit);
      this.reviewCancelBtn?.addEventListener('click', this.boundClose);
      this.reviewCloseBtn?.addEventListener('click', this.boundClose);
      this.modal?.addEventListener('click', (e) => {
        if (e.target.matches('[data-close-modal]')) {
          this.close();
        }
      });
      document.addEventListener('keydown', this.boundHandleEsc);

      if (this.starGroup) {
        this.starGroup.addEventListener('click', this.boundHandleStarClick);
        this.starGroup.addEventListener('keydown', this.boundHandleStarKeydown);
      }
      this.videoInput?.addEventListener('change', this.boundHandleFileChange);

      if (this.videoSourceRadios.length) {
        this.videoSourceRadios.forEach(radio => {
          radio.addEventListener('change', () => {
            this.updateVideoSourceUI(this.getSelectedVideoSource());
          });
        });
      }
    }

    handleSubmit() {
      if (this.mode !== 'create' || !this.ready) return;
      const scoreCode = this.scoreCode;
      if (!this.isValidScore(scoreCode)) {
        this.setMessage('曲谱码无效');
        return;
      }

      const rating = Number(this.ratingInput?.value || 5);
      if (!(rating >= 1 && rating <= 5)) {
        this.setMessage('评分必须是 1-5');
        return;
      }

      const comment = (this.commentInput?.value || '').trim();
      if (!comment) {
        this.setMessage('评语不能为空');
        return;
      }

      const videoSource = this.getSelectedVideoSource();
      const fd = new FormData();
      fd.append('score_code', scoreCode);
      fd.append('rating', String(rating));
      fd.append('comment', comment);
      fd.append('video_source', videoSource);

      if (videoSource === 'external') {
        const externalValue = (this.videoUrlInput?.value || '').trim();
        if (!externalValue) {
          this.setMessage('请填写视频链接或嵌入代码');
          return;
        }
        fd.append('video_url', externalValue);
      } else {
        if (!this.videoInput || !this.videoInput.files || !this.videoInput.files[0]) {
          this.setMessage('请选择要上传的视频文件');
          return;
        }
        fd.append('video', this.videoInput.files[0]);
      }

      this.setSubmitDisabled(true);
      this.setMessage('正在保存...');

      this.createReviewFn(fd)
        .then((data) => {
          this.setMessage('保存成功！');
          this.toast('评价已保存');
          if (typeof this.onSaved === 'function') {
            try {
              this.onSaved(data);
            } catch (cbError) {
              console.error('ReviewModal onSaved 回调执行失败:', cbError);
            }
          }
          setTimeout(() => this.close(), 500);
        })
        .catch((error) => {
          const msg = error.message || '保存失败';
          this.setMessage(`保存失败：${msg}`);
          this.toast(`保存失败：${msg}`);
        })
        .finally(() => {
          this.setSubmitDisabled(false);
        });
    }

    handleStarClick(event) {
      const value = Number(event.target?.dataset?.val || 0);
      if (value >= 1 && value <= 5) {
        this.ratingInput.value = String(value);
        this.paintStars(value);
      }
    }

    handleStarKeydown(event) {
      const current = Number(this.ratingInput?.value) || 5;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.max(1, current - 1);
        this.ratingInput.value = String(next);
        this.paintStars(next);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.min(5, current + 1);
        this.ratingInput.value = String(next);
        this.paintStars(next);
      }
    }

    renderViewMode(data) {
      this.mode = 'view';
      if (this.reviewTitle) this.reviewTitle.textContent = '查看评价';
      this.reviewVideoSourceField && (this.reviewVideoSourceField.style.display = 'none');
      this.reviewFileRow && (this.reviewFileRow.style.display = 'none');
      this.reviewUrlRow && (this.reviewUrlRow.style.display = 'none');
      this.reviewSubmitBtn && (this.reviewSubmitBtn.style.display = 'none');

      if (this.ratingInput) {
        this.ratingInput.value = data.rating || '5';
        this.paintStars(Number(data.rating) || 5);
        this.starGroup?.setAttribute('aria-disabled', 'true');
      }
      if (this.commentInput) {
        this.commentInput.value = data.comment || '';
        this.commentInput.setAttribute('readonly', 'readonly');
      }

      const videoType = data.video_type || this.detectClientVideoType(data.video_url);
      this.showPreview(videoType, data.video_url);
    }

    renderCreateMode(prefill = {}) {
      this.mode = 'create';
      if (this.reviewTitle) this.reviewTitle.textContent = '添加评价';
      this.reviewVideoSourceField && (this.reviewVideoSourceField.style.display = 'block');
      this.reviewSubmitBtn && (this.reviewSubmitBtn.style.display = 'block');

      if (this.ratingInput) {
        const rating = Number(prefill.rating) || 5;
        this.ratingInput.value = String(rating);
        this.paintStars(rating);
        this.starGroup?.removeAttribute('aria-disabled');
      }

      if (this.commentInput) {
        this.commentInput.value = prefill.comment || '';
        this.commentInput.removeAttribute('readonly');
      }

      if (this.videoInput) {
        this.videoInput.value = '';
      }
      if (this.videoFileName) {
        this.videoFileName.textContent = '未选择文件';
      }
      if (this.videoUrlInput) {
        this.videoUrlInput.value = prefill.video_url || '';
      }

      const source = prefill.video_source || 'upload';
      this.selectVideoSource(source);
      this.resetPreview();
    }

    show() {
      if (!this.modal) return;
      this.modal.classList.add('is-open');
      this.modal.setAttribute('aria-hidden', 'false');
    }

    setMessage(text) {
      if (this.reviewMsg) {
        this.reviewMsg.textContent = text || '';
      }
    }

    setSubmitDisabled(disabled) {
      if (this.reviewSubmitBtn) {
        this.reviewSubmitBtn.disabled = !!disabled;
      }
    }

    updateFileName() {
      if (!this.videoInput || !this.videoFileName) return;
      const name = this.videoInput.files && this.videoInput.files[0]
        ? this.videoInput.files[0].name
        : '未选择文件';
      this.videoFileName.textContent = name;
    }

    updateVideoSourceUI(source) {
      const mode = source === 'external' ? 'external' : 'upload';
      if (this.reviewFileRow) {
        this.reviewFileRow.style.display = mode === 'upload' ? 'block' : 'none';
      }
      if (this.reviewUrlRow) {
        this.reviewUrlRow.style.display = mode === 'external' ? 'block' : 'none';
      }
    }

    selectVideoSource(value) {
      if (!this.videoSourceRadios.length) {
        this.updateVideoSourceUI(value);
        return;
      }
      this.videoSourceRadios.forEach(radio => {
        radio.checked = radio.value === value;
      });
      this.updateVideoSourceUI(value);
    }

    getSelectedVideoSource() {
      const radio = this.videoSourceRadios.find(r => r.checked);
      return radio ? radio.value : 'upload';
    }

    resetPreview() {
      if (this.reviewVideoPreview) {
        try {
          this.reviewVideoPreview.pause();
        } catch (e) {
          // ignore
        }
        this.reviewVideoPreview.removeAttribute('src');
        this.reviewVideoPreview.style.display = 'none';
      }
      if (this.reviewEmbedPreview) {
        this.reviewEmbedPreview.innerHTML = '';
        this.reviewEmbedPreview.style.display = 'none';
      }
      if (this.reviewPreviewRow) {
        this.reviewPreviewRow.style.display = 'none';
      }
    }

    showPreview(videoType, videoValue) {
      this.resetPreview();
      if (!videoType || !videoValue) return;
      if (this.reviewPreviewRow) {
        this.reviewPreviewRow.style.display = 'block';
      }
      if (videoType === 'embed') {
        if (this.reviewEmbedPreview) {
          this.reviewEmbedPreview.innerHTML = videoValue;
          this.reviewEmbedPreview.style.display = 'block';
        }
      } else if (this.reviewVideoPreview) {
        this.reviewVideoPreview.src = videoValue;
        this.reviewVideoPreview.style.display = 'block';
      }
    }

    paintStars(n) {
      if (!this.starGroup) return;
      const buttons = this.starGroup.querySelectorAll('.qyj-star');
      buttons.forEach((btn) => {
        const value = Number(btn.dataset.val);
        const active = value <= n;
        btn.textContent = active ? '★' : '☆';
        btn.setAttribute('aria-checked', String(value === n));
        btn.classList.toggle('is-active', active);
      });
    }

    detectClientVideoType(value, fallback = 'none') {
      if (!value) return fallback;
      const trimmed = String(value).trim();
      if (!trimmed) return fallback;
      if (trimmed.toLowerCase().startsWith('<iframe')) return 'embed';
      if (/^https?:\/\//i.test(trimmed)) return 'url';
      return fallback;
    }

    isValidScore(value) {
      return /^\d{5,}$/.test(String(value || '').trim());
    }

    isValidScoreCode(value) {
      return this.isValidScore(value);
    }

    toast(text) {
      if (!text) return;
      if (!this.toastEl) {
        this.toastEl = document.querySelector('.qyj-toast');
        if (!this.toastEl) {
          this.toastEl = document.createElement('div');
          this.toastEl.className = 'qyj-toast';
          document.body.appendChild(this.toastEl);
        }
      }
      this.toastEl.textContent = text;
      this.toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastEl.classList.remove('show');
      }, this.toastDuration);
    }

    defaultFetchReview(scoreCode) {
      return fetch(`/api/reviews/${scoreCode}`)
        .then(async (resp) => {
          const data = await resp.json();
          if (!resp.ok) {
            throw new Error(data?.error || '获取评价数据失败');
          }
          return data;
        });
    }

    defaultCreateReview(formData) {
      return fetch('/api/reviews', { method: 'POST', body: formData })
        .then(async (resp) => {
          const data = await resp.json();
          if (!resp.ok || !data.success) {
            throw new Error(data?.error || '保存失败');
          }
          return data;
        });
    }
  }

  window.ReviewModal = ReviewModal;
})(window, document);
