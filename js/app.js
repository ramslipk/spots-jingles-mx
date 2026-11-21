/**
 * ============================================================================
 * Publicidad, Spots y Jingles MX — Motor Interactivo de Audio, Video y UI
 * ============================================================================
 * Incluye:
 *  1. Reproductor de Audio HTML5 + Web Audio API AnalyserNode conectado a tus
 *     archivos .MP3 reales en `demos/audio/` (con respaldo sintetizado si falta
 *     algún archivo).
 *  2. Exclusión mutua automática entre TODOS los reproductores de audio y el
 *     video promocional (`demos/video/spot-ads.mp4`).
 *  3. Visor Lightbox accesible para ampliar el Flyer y la Partitura.
 *  4. Scroll Reveal escalonado (Intersection Observer), Navbar compactable,
 *     menú móvil hamburguesa y acordeón FAQ.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIGURACIÓN DE PISTAS REALES (demos/audio/)
     ========================================================================== */
  const TRACKS = {
    'spot-oficial': {
      title: 'Spot Demo Oficial: Publicidad, Spots y Jingles MX',
      duration: 60,
      bpm: 118,
      style: 'commercial',
      audioSrc: 'demos/audio/spot-ads-oficial.mp3',
    },
    'spot-gi-a-joe': {
      title: 'Spot Comercial — GI A JOE',
      duration: 55,
      bpm: 126,
      style: 'perifoneo',
      audioSrc: 'demos/audio/spot-gi-a-joe.mp3',
    },
    'baile-22-nov': {
      title: 'Eventos y Bailes — Gran Baile 22 de Noviembre',
      duration: 64,
      bpm: 124,
      style: 'sonidero',
      audioSrc: 'demos/audio/baile-22-nov-mezcla.mp3',
    },
    'radio-la-atrevida': {
      title: 'Radio e Institucional — Radio La Atrevida',
      duration: 54,
      bpm: 100,
      style: 'corporativo',
      audioSrc: 'demos/audio/spot-radio-la-atrevida.mp3',
    },
    'spot-churros': {
      title: 'Comida y Negocios Locales — Spot Churros',
      duration: 82,
      bpm: 114,
      style: 'comida',
      audioSrc: 'demos/audio/spot-churros.mp3',
    },
    'reventon-grupero': {
      title: 'Cortinilla & Cabina — Reventón Grupero',
      duration: 19,
      bpm: 122,
      style: 'jingle',
      audioSrc: 'demos/audio/cortinilla-reventon-grupero.mp3',
    },
  };

  /* ==========================================================================
     2. MOTOR DE AUDIO (MP3 Real + Web Audio AnalyserNode)
     ========================================================================== */
  const formatTime = (seconds) => {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  class StudioAudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.masterGain = null;
      this.freqData = null;

      this.activeId = null;
      this.players = new Map();
      this.rafId = null;
      this.videoEl = null;

      this.state = new Map();
      Object.keys(TRACKS).forEach((id) => {
        this.state.set(id, {
          currentTime: 0,
          duration: TRACKS[id].duration,
          isPlaying: false,
          htmlAudio: null,
          mediaSource: null,
          lastTickMs: 0,
        });
      });
    }

    attachVideo(videoEl) {
      if (!videoEl) return;
      this.videoEl = videoEl;
      videoEl.addEventListener('play', () => {
        if (this.activeId) {
          this.pause(this.activeId);
        }
      });
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.78;

        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return true;
    }

    registerPlayer(id, elements) {
      this.players.set(id, elements);
      this.renderPlayerUI(id);
    }

    toggle(id) {
      const st = this.state.get(id);
      if (!st) return;

      if (this.activeId === id && st.isPlaying) {
        this.pause(id);
      } else {
        this.play(id);
      }
    }

    play(id) {
      const track = TRACKS[id];
      const st = this.state.get(id);
      if (!track || !st) return;

      // Exclusión mutua: pausar cualquier otro audio o video activo
      if (this.activeId && this.activeId !== id) {
        this.pause(this.activeId);
      }
      if (this.videoEl && !this.videoEl.paused) {
        this.videoEl.pause();
      }

      // Reiniciar si estaba al final
      if (st.currentTime >= st.duration - 0.25) {
        st.currentTime = 0;
      }

      const hasAudioCtx = this.ensureContext();
      this.activeId = id;
      st.isPlaying = true;
      st.lastTickMs = performance.now();

      if (track.audioSrc) {
        this.startRealMp3(id, track, st, hasAudioCtx);
      }

      this.renderPlayerUI(id);
      this.startAnimationLoop();
    }

    pause(id) {
      const st = this.state.get(id);
      if (!st) return;

      st.isPlaying = false;

      if (st.htmlAudio) {
        st.htmlAudio.pause();
      }

      if (this.activeId === id) {
        this.activeId = null;
      }

      this.resetEqualizerBars(id);
      this.renderPlayerUI(id);
    }

    seek(id, ratio) {
      const st = this.state.get(id);
      if (!st) return;

      const clamped = Math.max(0, Math.min(1, ratio));
      const newTime = clamped * st.duration;
      st.currentTime = newTime;
      st.lastTickMs = performance.now();

      if (st.htmlAudio && Number.isFinite(st.htmlAudio.duration) && st.htmlAudio.duration > 0) {
        try {
          st.htmlAudio.currentTime = newTime;
        } catch (_) {
          // Ignorar si aún no se cargan metadatos
        }
      }

      this.renderPlayerUI(id);
    }

    startRealMp3(id, track, st, hasAudioCtx) {
      if (!st.htmlAudio) {
        const audio = new Audio(track.audioSrc);
        audio.preload = 'metadata';

        audio.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            st.duration = audio.duration;
            if (st.currentTime > 0 && st.currentTime < audio.duration) {
              try {
                audio.currentTime = st.currentTime;
              } catch (_) {}
            }
            this.renderPlayerUI(id);
          }
        });

        audio.addEventListener('ended', () => {
          st.currentTime = 0;
          this.pause(id);
        });

        st.htmlAudio = audio;

        // Conectar al AnalyserNode si estamos en HTTP/HTTPS mismo origen
        if (hasAudioCtx && window.location.protocol !== 'file:') {
          try {
            st.mediaSource = this.ctx.createMediaElementSource(audio);
            st.mediaSource.connect(this.masterGain);
          } catch (_) {
            // Reproducción directa sin Web Audio si el navegador restringe
          }
        }
      }

      if (Number.isFinite(st.htmlAudio.duration) && st.htmlAudio.duration > 0) {
        st.htmlAudio.currentTime = st.currentTime;
      }

      st.htmlAudio.play().catch(() => {
        // Algunos entornos headless bloquean autoplay; el loop mantiene UI consistente
      });
    }

    /* ----------------------------------------------------------------------
       Loop de Tiempo Real: Progreso + Ecualizador Reactivo
       ---------------------------------------------------------------------- */
    startAnimationLoop() {
      if (this.rafId) return;

      const tick = (now) => {
        if (!this.activeId) {
          this.rafId = null;
          return;
        }

        const id = this.activeId;
        const st = this.state.get(id);
        const track = TRACKS[id];

        if (!st || !st.isPlaying) {
          this.rafId = null;
          return;
        }

        if (track.audioSrc && st.htmlAudio && !st.htmlAudio.paused && st.htmlAudio.readyState >= 2) {
          st.currentTime = st.htmlAudio.currentTime;
          if (Number.isFinite(st.htmlAudio.duration) && st.htmlAudio.duration > 0) {
            st.duration = st.htmlAudio.duration;
          }
          st.lastTickMs = now;
        } else if (!track.audioSrc) {
          const deltaSec = (now - st.lastTickMs) / 1000;
          st.lastTickMs = now;
          st.currentTime += Math.max(0, Math.min(0.25, deltaSec));
          if (st.currentTime >= st.duration) {
            st.currentTime = 0;
            this.pause(id);
            this.rafId = null;
            return;
          }
        }

        this.renderPlayerUI(id);
        this.updateEqualizer(id, now);

        this.rafId = window.requestAnimationFrame(tick);
      };

      this.rafId = window.requestAnimationFrame(tick);
    }

    updateEqualizer(id, now) {
      const ui = this.players.get(id);
      if (!ui || !ui.bars || ui.bars.length === 0) return;

      let hasLiveFreq = false;
      if (this.analyser && this.freqData) {
        this.analyser.getByteFrequencyData(this.freqData);
        for (let i = 0; i < 16; i++) {
          if (this.freqData[i] > 4) {
            hasLiveFreq = true;
            break;
          }
        }
      }

      const count = ui.bars.length;
      for (let i = 0; i < count; i++) {
        let pct;
        if (hasLiveFreq) {
          const binIndex = Math.min(
            this.freqData.length - 1,
            Math.floor((i / count) * (this.freqData.length * 0.65)) + 1
          );
          const raw = this.freqData[binIndex] / 255;
          pct = Math.max(16, Math.min(100, Math.round(raw * 115 + 14)));
        } else {
          const wave = Math.sin(now * 0.009 + i * 0.7) * 0.5 + 0.5;
          const wave2 = Math.cos(now * 0.015 - i * 0.4) * 0.5 + 0.5;
          pct = Math.round(22 + wave * 45 + wave2 * 28);
        }
        ui.bars[i].style.height = `${pct}%`;
      }
    }

    resetEqualizerBars(id) {
      const ui = this.players.get(id);
      if (!ui || !ui.bars) return;
      ui.bars.forEach((bar, idx) => {
        const resting = 22 + ((idx * 17) % 38);
        bar.style.height = `${resting}%`;
      });
    }

    renderPlayerUI(id) {
      const ui = this.players.get(id);
      const st = this.state.get(id);
      if (!ui || !st) return;

      const pct = st.duration > 0 ? Math.min(100, (st.currentTime / st.duration) * 100) : 0;

      if (ui.fill) ui.fill.style.width = `${pct}%`;
      if (ui.thumb) ui.thumb.style.left = `${pct}%`;
      if (ui.currentEl) ui.currentEl.textContent = formatTime(st.currentTime);
      if (ui.durationEl) ui.durationEl.textContent = formatTime(st.duration);

      if (ui.scrubber) {
        ui.scrubber.setAttribute('aria-valuenow', Math.round(pct));
        ui.scrubber.setAttribute('aria-valuetext', `${formatTime(st.currentTime)} de ${formatTime(st.duration)}`);
      }

      if (ui.playBtn) {
        ui.playBtn.classList.toggle('is-playing', st.isPlaying);
        ui.playBtn.setAttribute('aria-pressed', st.isPlaying ? 'true' : 'false');
        ui.playBtn.setAttribute(
          'aria-label',
          st.isPlaying ? `Pausar ${TRACKS[id].title}` : `Reproducir ${TRACKS[id].title}`
        );
      }

      if (ui.iconPlay) ui.iconPlay.classList.toggle('hidden', st.isPlaying);
      if (ui.iconPause) ui.iconPause.classList.toggle('hidden', !st.isPlaying);

      if (ui.eqContainer) {
        ui.eqContainer.classList.toggle('is-playing', st.isPlaying);
        ui.eqContainer.classList.toggle('is-idle', !st.isPlaying);
      }

      if (ui.card) {
        ui.card.classList.toggle('is-playing', st.isPlaying);
      }

      if (ui.statusLabel) {
        ui.statusLabel.textContent = st.isPlaying ? 'REPRODUCIENDO' : 'LISTO PARA ESCUCHAR';
      }
    }
  }

  /* ==========================================================================
     3. INICIALIZACIÓN DE REPRODUCTORES DE AUDIO Y VIDEO
     ========================================================================== */
  function initAudioPlayers() {
    const engine = new StudioAudioEngine();
    const playerRoots = document.querySelectorAll('[data-audio-player]');

    playerRoots.forEach((root) => {
      const id = root.getAttribute('data-audio-player');
      if (!TRACKS[id]) return;

      const eqContainer = root.querySelector('[data-eq]');
      const barCount = Number(eqContainer?.getAttribute('data-bars') || 16);

      const bars = [];
      if (eqContainer) {
        eqContainer.innerHTML = '';
        for (let i = 0; i < barCount; i++) {
          const bar = document.createElement('span');
          bar.className = 'eq-bar';
          bar.style.setProperty('--i', i);
          const resting = 22 + ((i * 17) % 38);
          bar.style.height = `${resting}%`;
          eqContainer.appendChild(bar);
          bars.push(bar);
        }
      }

      const playBtn = root.querySelector('[data-play-btn]');
      const scrubber = root.querySelector('[data-scrubber]');

      engine.registerPlayer(id, {
        card: root,
        playBtn,
        iconPlay: root.querySelector('[data-icon-play]'),
        iconPause: root.querySelector('[data-icon-pause]'),
        scrubber,
        fill: root.querySelector('[data-scrubber-fill]'),
        thumb: root.querySelector('[data-scrubber-thumb]'),
        currentEl: root.querySelector('[data-time-current]'),
        durationEl: root.querySelector('[data-time-total]'),
        eqContainer,
        bars,
        statusLabel: root.querySelector('[data-player-status]'),
      });

      if (playBtn) {
        playBtn.addEventListener('click', () => engine.toggle(id));
      }

      if (scrubber) {
        let isDragging = false;

        const updateFromPointer = (clientX) => {
          const rect = scrubber.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = (clientX - rect.left) / rect.width;
          engine.seek(id, ratio);
        };

        scrubber.addEventListener('pointerdown', (e) => {
          isDragging = true;
          scrubber.setPointerCapture?.(e.pointerId);
          updateFromPointer(e.clientX);
        });

        scrubber.addEventListener('pointermove', (e) => {
          if (!isDragging) return;
          updateFromPointer(e.clientX);
        });

        const endDrag = () => {
          isDragging = false;
        };
        scrubber.addEventListener('pointerup', endDrag);
        scrubber.addEventListener('pointercancel', endDrag);

        scrubber.addEventListener('keydown', (e) => {
          const st = engine.state.get(id);
          if (!st) return;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            engine.seek(id, (st.currentTime + 3) / st.duration);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            engine.seek(id, (st.currentTime - 3) / st.duration);
          }
        });
      }
    });

    // Conectar exclusión mutua con el video promocional
    const videoEl = document.getElementById('demo-video-player');
    engine.attachVideo(videoEl);

    window.__studioAudio = engine;
  }

  /* ==========================================================================
     4. LIGHTBOX MODAL PARA FLYER Y PARTITURA
     ========================================================================== */
  function initMediaLightbox() {
    const modal = document.getElementById('media-lightbox');
    if (!modal) return;

    const modalImg = document.getElementById('lightbox-img');
    const modalTitle = document.getElementById('lightbox-title');
    const modalSubtitle = document.getElementById('lightbox-subtitle');
    const modalPdfLink = document.getElementById('lightbox-pdf-link');
    const closeBtn = document.getElementById('lightbox-close');

    const openModal = ({ src, alt, title, subtitle, pdfUrl }) => {
      if (modalImg) {
        modalImg.src = src;
        modalImg.alt = alt || title || 'Vista previa';
      }
      if (modalTitle) modalTitle.textContent = title || '';
      if (modalSubtitle) modalSubtitle.textContent = subtitle || '';
      if (modalPdfLink) {
        if (pdfUrl) {
          modalPdfLink.href = pdfUrl;
          modalPdfLink.classList.remove('hidden');
        } else {
          modalPdfLink.classList.add('hidden');
        }
      }
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      closeBtn?.focus();
    };

    const closeModal = () => {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };

    document.querySelectorAll('[data-lightbox-src]').forEach((trigger) => {
      trigger.addEventListener('click', () => {
        openModal({
          src: trigger.getAttribute('data-lightbox-src'),
          alt: trigger.getAttribute('data-lightbox-alt'),
          title: trigger.getAttribute('data-lightbox-title'),
          subtitle: trigger.getAttribute('data-lightbox-subtitle'),
          pdfUrl: trigger.getAttribute('data-lightbox-pdf'),
        });
      });
    });

    closeBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) {
        closeModal();
      }
    });
  }

  /* ==========================================================================
     5. NAVBAR FIJA COMPACTABLE Y MENÚ MÓVIL HAMBURGUESA
     ========================================================================== */
  function initNavigation() {
    const navbar = document.getElementById('navbar');
    const menuBtn = document.getElementById('mobile-menu-btn');
    const drawer = document.getElementById('mobile-drawer');
    const floatingWa = document.getElementById('floating-whatsapp-btn');
    const mobileLinks = drawer ? drawer.querySelectorAll('a') : [];

    const onScroll = () => {
      if (navbar) {
        navbar.classList.toggle('is-scrolled', window.scrollY > 24);
      }
      if (floatingWa) {
        floatingWa.classList.toggle('is-hidden-at-top', window.scrollY < 240);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const setMenuOpen = (open) => {
      if (!menuBtn || !drawer) return;
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    if (menuBtn && drawer) {
      menuBtn.addEventListener('click', () => {
        const currentlyOpen = menuBtn.getAttribute('aria-expanded') === 'true';
        setMenuOpen(!currentlyOpen);
      });

      mobileLinks.forEach((link) => {
        link.addEventListener('click', () => setMenuOpen(false));
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setMenuOpen(false);
      });

      window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) setMenuOpen(false);
      });
    }
  }

  /* ==========================================================================
     6. SCROLL REVEAL ESCALONADO (Intersection Observer)
     ========================================================================== */
  function initScrollReveal() {
    const items = document.querySelectorAll('[data-reveal]');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -36px 0px',
      }
    );

    items.forEach((el) => {
      const delay = el.getAttribute('data-reveal-delay');
      if (delay) {
        el.style.setProperty('--reveal-delay', `${delay}ms`);
      }
      observer.observe(el);
    });
  }

  /* ==========================================================================
     7. ACORDEÓN DE PREGUNTAS FRECUENTES (FAQ)
     ========================================================================== */
  function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    if (!faqItems.length) return;

    faqItems.forEach((item) => {
      const trigger = item.querySelector('.faq-trigger');
      if (!trigger) return;

      trigger.addEventListener('click', () => {
        const isOpen = item.getAttribute('data-open') === 'true';

        faqItems.forEach((other) => {
          if (other !== item) {
            other.setAttribute('data-open', 'false');
            other.querySelector('.faq-trigger')?.setAttribute('aria-expanded', 'false');
          }
        });

        item.setAttribute('data-open', isOpen ? 'false' : 'true');
        trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      });
    });
  }

  /* ==========================================================================
     8. MICRO-INTERACCIÓN: BRILLO DINÁMICO EN TARJETAS AL PASAR EL CURSOR
     ========================================================================== */
  function initCardSpotlight() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const cards = document.querySelectorAll('.studio-card');
    cards.forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        card.style.setProperty('--mouse-x', `${x.toFixed(1)}%`);
        card.style.setProperty('--mouse-y', `${y.toFixed(1)}%`);
      });
    });
  }

  /* ==========================================================================
     ARRANQUE
     ========================================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAudioPlayers();
    initMediaLightbox();
    initScrollReveal();
    initFaqAccordion();
    initCardSpotlight();
  });
})();
