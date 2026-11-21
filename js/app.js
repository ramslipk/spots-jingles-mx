/**
 * ============================================================================
 * Publicidad, Spots y Jingles MX — Motor Interactivo de Audio y Animaciones
 * ============================================================================
 * Incluye:
 *  1. Reproductor de Audio con Web Audio API (demos temporales listos para
 *     probar Play/Pause, barra de progreso, contador y ecualizador en vivo).
 *     Para conectar tus audios reales, solo asigna la ruta en `audioSrc`.
 *  2. Exclusión mutua automática: al reproducir un track, los demás se pausan.
 *  3. Scroll Reveal escalonado (Intersection Observer).
 *  4. Navbar fija compactable + Menú móvil hamburguesa animado.
 *  5. Acordeón FAQ fluido y efecto de brillo reactivo al cursor en tarjetas.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIGURACIÓN DE PISTAS DE AUDIO
     ==========================================================================
     INSTRUCCIONES:
     Cuando tengas tus archivos reales, súbelos a una carpeta (ej. /audio/) y
     cambia `audioSrc: null` por la ruta correspondiente, por ejemplo:
     audioSrc: 'audio/el-camaleon.mp3'
     ========================================================================== */
  const TRACKS = {
    'el-camaleon': {
      title: 'Spot Demo Oficial: El Camaleón',
      duration: 60,
      bpm: 118,
      style: 'commercial',
      // REEMPLAZAR CON ARCHIVO .MP3 (Ejemplo: 'audio/spot-el-camaleon.mp3')
      audioSrc: null,
    },
    perifoneo: {
      title: 'Perifoneo y Ofertas',
      duration: 15,
      bpm: 128,
      style: 'perifoneo',
      // REEMPLAZAR CON ARCHIVO .MP3 (Ejemplo: 'audio/demo-perifoneo.mp3')
      audioSrc: null,
    },
    eventos: {
      title: 'Eventos, Bailes y Sonideros',
      duration: 20,
      bpm: 124,
      style: 'sonidero',
      // REEMPLAZAR CON ARCHIVO .MP3 (Ejemplo: 'audio/demo-eventos.mp3')
      audioSrc: null,
    },
    corporativo: {
      title: 'Serio y Corporativo',
      duration: 20,
      bpm: 92,
      style: 'corporativo',
      // REEMPLAZAR CON ARCHIVO .MP3 (Ejemplo: 'audio/demo-corporativo.mp3')
      audioSrc: null,
    },
    comida: {
      title: 'Comida y Negocios Locales',
      duration: 15,
      bpm: 114,
      style: 'comida',
      // REEMPLAZAR CON ARCHIVO .MP3 (Ejemplo: 'audio/demo-comida.mp3')
      audioSrc: null,
    },
    jingle: {
      title: 'Jingle Original Cantado',
      duration: 25,
      bpm: 120,
      style: 'jingle',
      // REEMPLAZAR CON ARCHIVO .MP3 (Ejemplo: 'audio/demo-jingle.mp3')
      audioSrc: null,
    },
  };

  /* ==========================================================================
     2. MOTOR DE AUDIO (Web Audio API + Soporte Nativo MP3)
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
      this.synthTimer = null;
      this.synthStep = 0;

      // Estado por cada pista (para recordar posición al pausar/buscar)
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

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.38;

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

      // Exclusión mutua: pausar cualquier otro reproductor activo
      if (this.activeId && this.activeId !== id) {
        this.pause(this.activeId);
      }

      // Reiniciar si estaba al final
      if (st.currentTime >= st.duration - 0.15) {
        st.currentTime = 0;
      }

      const hasAudioCtx = this.ensureContext();
      this.activeId = id;
      st.isPlaying = true;
      st.lastTickMs = performance.now();

      if (track.audioSrc) {
        this.startRealMp3(id, track, st, hasAudioCtx);
      } else if (hasAudioCtx) {
        this.startSynthLoop(id, track);
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
        this.stopSynthLoop();
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

      if (st.htmlAudio && Number.isFinite(st.htmlAudio.duration)) {
        st.htmlAudio.currentTime = newTime;
      }

      this.renderPlayerUI(id);
    }

    startRealMp3(id, track, st, hasAudioCtx) {
      if (!st.htmlAudio) {
        const audio = new Audio(track.audioSrc);
        audio.preload = 'metadata';
        audio.crossOrigin = 'anonymous';
        audio.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            st.duration = audio.duration;
            this.renderPlayerUI(id);
          }
        });
        audio.addEventListener('ended', () => {
          st.currentTime = 0;
          this.pause(id);
        });
        st.htmlAudio = audio;

        if (hasAudioCtx) {
          try {
            st.mediaSource = this.ctx.createMediaElementSource(audio);
            st.mediaSource.connect(this.masterGain);
          } catch (_) {
            // Fallback directo si CORS bloquea MediaElementAudioSourceNode
          }
        }
      }

      st.htmlAudio.currentTime = st.currentTime;
      st.htmlAudio.play().catch(() => {});
    }

    /* ----------------------------------------------------------------------
       Sintetizador Demo por Estilo (Web Audio API)
       Genera bases musicales distintivas mientras se reemplazan los .MP3
       ---------------------------------------------------------------------- */
    startSynthLoop(id, track) {
      this.stopSynthLoop();
      this.synthStep = Math.floor(this.state.get(id).currentTime * 4);

      const stepMs = Math.round((60 / track.bpm / 2) * 1000); // corcheas
      this.triggerSynthStep(track.style, this.synthStep);

      this.synthTimer = window.setInterval(() => {
        if (this.activeId !== id) {
          this.stopSynthLoop();
          return;
        }
        this.synthStep += 1;
        this.triggerSynthStep(track.style, this.synthStep);
      }, stepMs);
    }

    stopSynthLoop() {
      if (this.synthTimer) {
        window.clearInterval(this.synthTimer);
        this.synthTimer = null;
      }
    }

    playTone({ freq, type = 'sine', start = 0, dur = 0.22, gain = 0.22, filterFreq = 2600, slideTo = null }) {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime + start;

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const amp = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(24, slideTo), now + dur);
      }

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq, now);

      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.linearRampToValueAtTime(gain, now + 0.014);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      osc.connect(filter);
      filter.connect(amp);
      amp.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + dur + 0.02);
    }

    playKick(gain = 0.42) {
      this.playTone({
        freq: 138,
        slideTo: 38,
        type: 'sine',
        dur: 0.16,
        gain,
        filterFreq: 380,
      });
    }

    playHat(gain = 0.075) {
      if (!this.ctx || !this.masterGain) return;
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.045);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6200;

      const amp = this.ctx.createGain();
      amp.gain.value = gain;

      noise.connect(hp);
      hp.connect(amp);
      amp.connect(this.masterGain);
      noise.start();
    }

    triggerSynthStep(style, step) {
      const barStep = step % 16;

      if (style === 'commercial') {
        // Spot Oficial El Camaleón: groove moderno de estudio (radio/TV)
        if (barStep % 4 === 0) this.playKick(0.45);
        if (barStep % 2 === 1) this.playHat(0.08);
        const bass = [110, 110, 130.8, 146.8, 164.8, 146.8, 130.8, 98];
        if (barStep % 2 === 0) {
          this.playTone({
            freq: bass[(barStep / 2) % bass.length],
            type: 'triangle',
            dur: 0.24,
            gain: 0.24,
            filterFreq: 750,
          });
        }
        const chords = [
          [440, 554.37, 659.25],
          [392, 493.88, 587.33],
          [349.23, 440, 523.25],
          [329.63, 415.3, 493.88],
        ];
        if (barStep % 4 === 0) {
          const chord = chords[(barStep / 4) % chords.length];
          chord.forEach((f) => {
            this.playTone({ freq: f, type: 'sine', dur: 0.42, gain: 0.085, filterFreq: 2400 });
          });
        }
        if (barStep === 3 || barStep === 11) {
          this.playTone({ freq: 880, type: 'triangle', dur: 0.14, gain: 0.09, filterFreq: 3200 });
        }
      } else if (style === 'perifoneo') {
        // Energético y vendedor: golpes de metal/synth + ritmo ágil
        if (barStep % 2 === 0) this.playKick(0.46);
        this.playHat(barStep % 2 === 1 ? 0.1 : 0.04);
        const stabs = [523.25, 0, 659.25, 587.33, 698.46, 0, 783.99, 659.25];
        const note = stabs[barStep % stabs.length];
        if (note > 0) {
          this.playTone({ freq: note, type: 'sawtooth', dur: 0.15, gain: 0.12, filterFreq: 2200 });
          this.playTone({ freq: note / 2, type: 'triangle', dur: 0.16, gain: 0.14, filterFreq: 900 });
        }
      } else if (style === 'sonidero') {
        // Eventos, Bailes y Sonideros: sub-bass potente + efecto cabina/laser
        if (barStep % 4 === 0 || barStep === 14) this.playKick(0.54);
        if (barStep % 2 === 1) this.playHat(0.09);
        const sub = [65.4, 65.4, 73.4, 82.4];
        if (barStep % 4 === 0) {
          this.playTone({
            freq: sub[(barStep / 4) % sub.length],
            type: 'sawtooth',
            dur: 0.36,
            gain: 0.22,
            filterFreq: 420,
          });
        }
        if (barStep === 0) {
          // Efecto sweep de cabina
          this.playTone({
            freq: 1400,
            slideTo: 240,
            type: 'sawtooth',
            dur: 0.28,
            gain: 0.13,
            filterFreq: 3200,
          });
        }
        if (barStep === 6 || barStep === 10) {
          this.playTone({ freq: 523.25, type: 'square', dur: 0.12, gain: 0.07, filterFreq: 1700 });
        }
      } else if (style === 'corporativo') {
        // Serio y Corporativo: arpegio limpio, cálido y confiable
        const arp = [261.63, 329.63, 392.0, 493.88, 523.25, 493.88, 392.0, 329.63];
        this.playTone({
          freq: arp[barStep % arp.length],
          type: 'sine',
          dur: 0.36,
          gain: 0.14,
          filterFreq: 1800,
        });
        if (barStep % 8 === 0) {
          [130.81, 196.0, 246.94].forEach((f) => {
            this.playTone({ freq: f, type: 'triangle', dur: 0.9, gain: 0.08, filterFreq: 900 });
          });
        }
      } else if (style === 'comida') {
        // Comida y Negocios Locales: alegre, marimba/pluck antojable
        if (barStep % 4 === 0) this.playKick(0.36);
        if (barStep % 2 === 1) this.playHat(0.07);
        const melody = [587.33, 659.25, 739.99, 880, 739.99, 659.25, 587.33, 440];
        this.playTone({
          freq: melody[barStep % melody.length],
          type: 'triangle',
          dur: 0.17,
          gain: 0.18,
          filterFreq: 2600,
        });
        if (barStep % 4 === 2) {
          this.playTone({ freq: 293.66, type: 'sine', dur: 0.22, gain: 0.16, filterFreq: 900 });
        }
      } else if (style === 'jingle') {
        // Jingle Original Cantado: hook melódico brillante y pegajoso
        if (barStep % 4 === 0) this.playKick(0.4);
        if (barStep % 2 === 1) this.playHat(0.08);
        const hook = [
          523.25, 659.25, 783.99, 1046.5,
          880.0, 783.99, 659.25, 783.99,
          698.46, 880.0, 783.99, 659.25,
          587.33, 659.25, 523.25, 523.25,
        ];
        const freq = hook[barStep];
        this.playTone({ freq, type: 'triangle', dur: 0.22, gain: 0.18, filterFreq: 3400 });
        if (barStep % 4 === 0) {
          this.playTone({ freq: freq / 2, type: 'sine', dur: 0.34, gain: 0.14, filterFreq: 1400 });
        }
      }
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

        // Actualizar tiempo actual
        if (track.audioSrc && st.htmlAudio) {
          st.currentTime = st.htmlAudio.currentTime;
        } else {
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
          // Onda reactiva suave si el contexto de audio está silenciado
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
     3. INICIALIZACIÓN DE REPRODUCTORES EN EL DOM
     ========================================================================== */
  function initAudioPlayers() {
    const engine = new StudioAudioEngine();
    const playerRoots = document.querySelectorAll('[data-audio-player]');

    playerRoots.forEach((root) => {
      const id = root.getAttribute('data-audio-player');
      if (!TRACKS[id]) return;

      const eqContainer = root.querySelector('[data-eq]');
      const barCount = Number(eqContainer?.getAttribute('data-bars') || 16);

      // Generar barras del ecualizador dinámicamente
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

      // Interacción de búsqueda (Click, Touch Drag y Teclado)
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
            engine.seek(id, (st.currentTime + 2) / st.duration);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            engine.seek(id, (st.currentTime - 2) / st.duration);
          }
        });
      }
    });

    // Exponer para depuración o pruebas
    window.__studioAudio = engine;
  }

  /* ==========================================================================
     4. NAVBAR FIJA COMPACTABLE Y MENÚ MÓVIL HAMBURGUESA
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
     5. SCROLL REVEAL ESCALONADO (Intersection Observer)
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
     6. ACORDEÓN DE PREGUNTAS FRECUENTES (FAQ)
     ========================================================================== */
  function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    if (!faqItems.length) return;

    faqItems.forEach((item) => {
      const trigger = item.querySelector('.faq-trigger');
      if (!trigger) return;

      trigger.addEventListener('click', () => {
        const isOpen = item.getAttribute('data-open') === 'true';

        // Cerrar las demás preguntas para mantener lectura limpia
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
     7. MICRO-INTERACCIÓN: BRILLO DINÁMICO EN TARJETAS AL PASAR EL CURSOR
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
    initScrollReveal();
    initFaqAccordion();
    initCardSpotlight();
  });
})();
