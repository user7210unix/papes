const CONFIG = Object.freeze({
  REPO_OWNER: 'user7210unix',
  REPO_NAME: 'papes',
  BRANCH: 'main',
  ASSETS_PATH: 'assets',
  PROXY_BASE: 'https://chan-proxy.anonnousmes.workers.dev/?url=',
  RAW_BASE: 'https://raw.githubusercontent.com/user7210unix/papes/main/',
  /* Reliable resized fallback when proxy does not constrain size */
  RESIZE_BASE: 'https://wsrv.nl/?url=',
  IMAGE_EXT: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  GITHUB_API: 'https://api.github.com',
  FETCH_TIMEOUT_MS: 14000,
  LAZY_ROOT_MARGIN: '280px',
  PREVIEW_WIDTH: 960,   /* ~720p class for common landscape wallpapers */
});

/** @typedef {{ path: string, name: string, fullUrl: string, previewUrl: string, fallbackPreviewUrl: string }} ImageEntry */

class GalleryApp {
  constructor() {
    this.images = /** @type {ImageEntry[]} */ ([]);
    this.currentIndex = 0;
    this.isLightboxOpen = false;
    this.lbLoadToken = 0;

    this.els = {
      status: document.getElementById('status'),
      gallery: document.getElementById('gallery'),
      count: document.getElementById('image-count'),
      lightbox: document.getElementById('lightbox'),
      lbImage: document.getElementById('lightbox-image'),
      lbSpinner: document.getElementById('lightbox-spinner'),
      lbName: document.getElementById('lightbox-name'),
      lbCounter: document.getElementById('lightbox-counter'),
      lbDownload: document.getElementById('lightbox-download'),
      lbClose: document.getElementById('lightbox-close'),
      lbPrev: document.getElementById('lightbox-prev'),
      lbNext: document.getElementById('lightbox-next'),
    };

    this.lazyObserver = null;
    this.bindEvents();
  }

  /* ---------- Bootstrap ---------- */
  async init() {
    try {
      this.images = await this.fetchImageList();
      if (this.images.length === 0) {
        this.setStatus('No images found in repository.');
        return;
      }
      this.els.count.textContent = `${this.images.length} wallpapers`;
      this.setStatus('');
      this.renderGallery();
      this.setupLazyLoad();
    } catch (err) {
      console.error(err);
      this.setStatus('Failed to load archive. Check network or API rate limits.');
    }
  }

  setStatus(msg) {
    if (!msg) {
      this.els.status.hidden = true;
      this.els.status.textContent = '';
      return;
    }
    this.els.status.hidden = false;
    this.els.status.textContent = msg;
  }

  /* ---------- Data ---------- */
  async fetchImageList() {
    const paths = await this.collectImagePaths(CONFIG.ASSETS_PATH);
    return paths
      .map((path) => this.toImageEntry(path))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /**
   * Recursively walk GitHub contents API.
   * @param {string} path
   * @returns {Promise<string[]>}
   */
  async collectImagePaths(path) {
    const url = `${CONFIG.GITHUB_API}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}?ref=${CONFIG.BRANCH}`;
    const items = await this.fetchJson(url);
    if (!Array.isArray(items)) return [];

    const results = [];
    const dirPromises = [];

    for (const item of items) {
      if (item.type === 'file' && this.isImagePath(item.path)) {
        results.push(item.path);
      } else if (item.type === 'dir') {
        if (item.name === 'fonts') continue;
        dirPromises.push(this.collectImagePaths(item.path));
      }
    }

    const nested = await Promise.all(dirPromises);
    for (const list of nested) {
      results.push(...list);
    }
    return results;
  }

  isImagePath(path) {
    const lower = path.toLowerCase();
    for (const ext of CONFIG.IMAGE_EXT) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  /**
   * @param {string} path
   * @returns {ImageEntry}
   */
  toImageEntry(path) {
    const name = path.split('/').pop() || path;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const fullUrl = CONFIG.RAW_BASE + encodedPath;

    // Primary: user proxy (intended low-quality / constrained preview)
    const previewUrl = CONFIG.PROXY_BASE + encodeURIComponent(fullUrl);

    // Secondary: explicit resize so the catalog never pulls multi-MB originals
    const fallbackPreviewUrl =
      CONFIG.RESIZE_BASE +
      encodeURIComponent(fullUrl) +
      `&w=${CONFIG.PREVIEW_WIDTH}&q=75&output=webp`;

    return { path, name, fullUrl, previewUrl, fallbackPreviewUrl };
  }

  async fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) {
        throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- Render ---------- */
  renderGallery() {
    const frag = document.createDocumentFragment();

    this.images.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('tabindex', '0');
      item.dataset.index = String(index);

      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      item.appendChild(placeholder);

      const img = document.createElement('img');
      img.alt = entry.name.replace(/\.[^.]+$/, '');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.dataset.src = entry.previewUrl;
      img.dataset.fallback = entry.fallbackPreviewUrl;
      item.appendChild(img);

      frag.appendChild(item);
    });

    this.els.gallery.replaceChildren(frag);
  }

  setupLazyLoad() {
    if (this.lazyObserver) this.lazyObserver.disconnect();

    this.lazyObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = /** @type {HTMLImageElement} */ (entry.target);
          const src = img.dataset.src;
          if (!src) continue;

          this.loadThumb(img, src, img.dataset.fallback || '');
          this.lazyObserver.unobserve(img);
        }
      },
      { rootMargin: CONFIG.LAZY_ROOT_MARGIN, threshold: 0.01 }
    );

    this.els.gallery.querySelectorAll('img[data-src]').forEach((img) => {
      this.lazyObserver.observe(img);
    });
  }

  /**
   * Try proxy first, then resized fallback. Never fall back to full original in grid.
   * @param {HTMLImageElement} img
   * @param {string} primary
   * @param {string} fallback
   */
  loadThumb(img, primary, fallback) {
    img.removeAttribute('data-src');

    const onSuccess = () => {
      img.classList.add('loaded');
      const ph = img.previousElementSibling;
      if (ph && ph.classList.contains('placeholder')) ph.remove();
    };

    img.addEventListener('load', onSuccess, { once: true });

    img.addEventListener(
      'error',
      () => {
        if (fallback && img.src !== fallback) {
          img.src = fallback;
          return;
        }
        // Give up gracefully – keep placeholder gone, show empty tile
        onSuccess();
      },
      { once: true }
    );

    img.src = primary;
  }

  /* ---------- Lightbox ---------- */
  openLightbox(index) {
    if (index < 0 || index >= this.images.length) return;
    this.currentIndex = index;
    this.isLightboxOpen = true;

    this.els.lightbox.hidden = false;
    void this.els.lightbox.offsetWidth;
    this.els.lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    this.loadLightboxImage(index);
  }

  closeLightbox() {
    this.isLightboxOpen = false;
    this.lbLoadToken += 1;
    this.els.lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => {
      this.els.lightbox.hidden = true;
      this.els.lbImage.src = '';
      this.els.lbImage.classList.remove('is-visible');
    }, 220);
  }

  navigate(delta) {
    const next = (this.currentIndex + delta + this.images.length) % this.images.length;
    this.currentIndex = next;
    this.loadLightboxImage(next);
  }

  loadLightboxImage(index) {
    const entry = this.images[index];
    if (!entry) return;

    const token = ++this.lbLoadToken;

    this.els.lbName.textContent = entry.name.replace(/\.[^.]+$/, '');
    this.els.lbCounter.textContent = `${index + 1} / ${this.images.length}`;
    this.els.lbDownload.href = entry.fullUrl;
    this.els.lbDownload.setAttribute('download', entry.name);

    this.els.lbImage.classList.remove('is-visible');
    this.els.lbSpinner.classList.remove('is-hidden');

    // Full quality only in lightbox
    const tmp = new Image();
    tmp.decoding = 'async';
    tmp.onload = () => {
      if (token !== this.lbLoadToken) return;
      this.els.lbImage.src = tmp.src;
      this.els.lbSpinner.classList.add('is-hidden');
      requestAnimationFrame(() => {
        this.els.lbImage.classList.add('is-visible');
      });
    };
    tmp.onerror = () => {
      if (token !== this.lbLoadToken) return;
      this.els.lbImage.src = entry.fallbackPreviewUrl || entry.previewUrl;
      this.els.lbSpinner.classList.add('is-hidden');
      this.els.lbImage.classList.add('is-visible');
    };
    tmp.src = entry.fullUrl;
  }

  /* ---------- Events (delegation) ---------- */
  bindEvents() {
    this.els.gallery.addEventListener('click', (e) => {
      const item = e.target.closest('.gallery-item');
      if (!item) return;
      const idx = Number(item.dataset.index);
      if (!Number.isNaN(idx)) this.openLightbox(idx);
    });

    this.els.gallery.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.gallery-item');
      if (!item) return;
      e.preventDefault();
      const idx = Number(item.dataset.index);
      if (!Number.isNaN(idx)) this.openLightbox(idx);
    });

    this.els.lbClose.addEventListener('click', () => this.closeLightbox());
    this.els.lbPrev.addEventListener('click', () => this.navigate(-1));
    this.els.lbNext.addEventListener('click', () => this.navigate(1));

    this.els.lightbox.addEventListener('click', (e) => {
      if (e.target === this.els.lightbox || e.target.classList.contains('lightbox-stage')) {
        this.closeLightbox();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!this.isLightboxOpen) return;
      if (e.key === 'Escape') this.closeLightbox();
      if (e.key === 'ArrowLeft') this.navigate(-1);
      if (e.key === 'ArrowRight') this.navigate(1);
    });

    let touchStartX = 0;
    this.els.lightbox.addEventListener(
      'touchstart',
      (e) => {
        touchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );
    this.els.lightbox.addEventListener(
      'touchend',
      (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 48) this.navigate(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );
  }
}

const app = new GalleryApp();
app.init();
