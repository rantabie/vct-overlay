(function () {
  "use strict";

  const DEFAULT_SECONDS = 5 * 60;
  const STORAGE_KEY = "vct.countdown.state";
  const DEFAULT_TOSU_HOST = "127.0.0.1:24050";

  const dom = {
    timer: document.getElementById("timer"),
    timerShadow: document.getElementById("timerShadow"),
    nowPlaying: document.getElementById("nowPlaying"),
    controlStatus: document.getElementById("controlStatus"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    resetButton: document.getElementById("resetButton"),
    minusButton: document.getElementById("minusButton"),
    plusButton: document.getElementById("plusButton"),
    minutesInput: document.getElementById("minutesInput")
  };

  const params = new URLSearchParams(window.location.search);
  const tosuHost = params.get("tosu") || (location.port === "24050" ? location.host : DEFAULT_TOSU_HOST);
  const socketUrl = `ws://${tosuHost}/ws`;

  let state = loadState();
  let reconnectTimer = null;

  wireControls();
  render();
  window.setInterval(render, 250);
  document.addEventListener("visibilitychange", render);
  connectTosu();

  function wireControls() {
    dom.startButton.addEventListener("click", start);
    dom.pauseButton.addEventListener("click", pause);
    dom.resetButton.addEventListener("click", () => reset(DEFAULT_SECONDS));
    dom.minusButton.addEventListener("click", () => adjust(-60));
    dom.plusButton.addEventListener("click", () => adjust(60));
    dom.minutesInput.addEventListener("change", () => {
      const minutes = Math.max(0, Math.min(180, Number(dom.minutesInput.value) || 0));
      reset(Math.round(minutes * 60));
    });
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") return normaliseState(saved);
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }

    return {
      running: true,
      remainingMs: DEFAULT_SECONDS * 1000,
      deadline: Date.now() + DEFAULT_SECONDS * 1000
    };
  }

  function normaliseState(saved) {
    const remainingMs = Number(saved.remainingMs);
    const deadline = Number(saved.deadline);
    return {
      running: Boolean(saved.running),
      remainingMs: Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : DEFAULT_SECONDS * 1000,
      deadline: Number.isFinite(deadline) ? deadline : 0
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getRemainingMs() {
    if (!state.running) return state.remainingMs;
    return Math.max(0, state.deadline - Date.now());
  }

  function start() {
    const remainingMs = getRemainingMs();
    state = {
      running: remainingMs > 0,
      remainingMs,
      deadline: Date.now() + remainingMs
    };
    saveState();
    render();
  }

  function pause() {
    state = {
      running: false,
      remainingMs: getRemainingMs(),
      deadline: 0
    };
    saveState();
    render();
  }

  function reset(seconds) {
    const remainingMs = Math.max(0, seconds) * 1000;
    state = {
      running: remainingMs > 0,
      remainingMs,
      deadline: remainingMs > 0 ? Date.now() + remainingMs : 0
    };
    saveState();
    render();
  }

  function adjust(deltaSeconds) {
    const remainingMs = Math.max(0, getRemainingMs() + deltaSeconds * 1000);
    state = {
      running: state.running && remainingMs > 0,
      remainingMs,
      deadline: state.running && remainingMs > 0 ? Date.now() + remainingMs : 0
    };
    saveState();
    render();
  }

  function render() {
    const remainingMs = getRemainingMs();
    if (state.running && remainingMs <= 0) {
      state = { running: false, remainingMs: 0, deadline: 0 };
      saveState();
    }

    const text = formatTime(Math.ceil(remainingMs / 1000));
    dom.timer.textContent = text;
    dom.timerShadow.textContent = text;
    dom.minutesInput.value = Math.ceil(remainingMs / 60000);
    dom.controlStatus.textContent = state.running
      ? `Running. Ends at ${new Date(state.deadline).toLocaleTimeString()}.`
      : "Paused. Start resumes from the displayed time.";
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    return `${String(minutes).padStart(2, "0")}:${remainder}`;
  }

  function connectTosu() {
    clearTimeout(reconnectTimer);
    new ReconnectingSocket(socketUrl, {
      onMessage(event) {
        try {
          const data = JSON.parse(event.data);
          const metadata = data?.menu?.bm?.metadata || {};
          dom.nowPlaying.textContent = metadata.title ? `Now playing: ${metadata.title}` : "Waiting for current beatmap";
        } catch (error) {
          dom.nowPlaying.textContent = "Waiting for tosu";
        }
      }
    });
  }

  class ReconnectingSocket {
    constructor(url, handlers) {
      this.url = url;
      this.handlers = handlers;
      this.retryDelay = 1200;
      this.connect();
    }

    connect() {
      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        this.scheduleReconnect();
        return;
      }

      this.ws.addEventListener("message", (event) => this.handlers.onMessage?.(event));
      this.ws.addEventListener("close", () => this.scheduleReconnect());
      this.ws.addEventListener("error", () => this.ws.close());
    }

    scheduleReconnect() {
      clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        this.retryDelay = Math.min(this.retryDelay * 1.35, 6000);
        this.connect();
      }, this.retryDelay);
    }
  }
})();
