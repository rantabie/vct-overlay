(function () {
  "use strict";

  const video = document.getElementById("countdownVideo");
  const status = document.getElementById("controlStatus");
  const playButton = document.getElementById("playButton");
  const pauseButton = document.getElementById("pauseButton");
  const restartButton = document.getElementById("restartButton");
  const backButton = document.getElementById("backButton");
  const forwardButton = document.getElementById("forwardButton");
  const muteButton = document.getElementById("muteButton");
  const currentTrack = document.getElementById("currentTrack");
  const currentTrackText = document.getElementById("currentTrackText");
  const DEFAULT_TOSU_HOST = "127.0.0.1:24050";
  const tosuHost = new URLSearchParams(window.location.search).get("tosu") || DEFAULT_TOSU_HOST;
  const socketUrl = `ws://${tosuHost}/ws`;
  const WAITING_TRACK_TEXT = "Waiting for osu client";
  let socket = null;
  let reconnectTimer = null;
  let currentTrackValue = WAITING_TRACK_TEXT;

  if (new URLSearchParams(window.location.search).has("controls")) {
    document.documentElement.classList.add("show-controls");
  }

  playButton.addEventListener("click", play);
  pauseButton.addEventListener("click", () => video.pause());
  restartButton.addEventListener("click", restart);
  backButton.addEventListener("click", () => seekBy(-10));
  forwardButton.addEventListener("click", () => seekBy(10));
  muteButton.addEventListener("click", toggleMute);

  video.addEventListener("loadedmetadata", render);
  video.addEventListener("play", render);
  video.addEventListener("pause", render);
  video.addEventListener("ended", render);
  video.addEventListener("volumechange", render);
  video.addEventListener("timeupdate", render);

  play();
  connectTosu();
  window.setInterval(render, 500);

  function play() {
    video.play().catch(() => {
      status.textContent = "Autoplay was blocked. Press Play in the control panel.";
    });
  }

  function restart() {
    video.currentTime = 0;
    play();
  }

  function seekBy(seconds) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
    render();
  }

  function toggleMute() {
    video.muted = !video.muted;
    render();
  }

  function render() {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const remaining = Math.max(0, duration - video.currentTime);
    const state = video.ended ? "Finished" : video.paused ? "Paused" : "Playing";
    status.textContent = `${state}. ${formatTime(remaining)} remaining.`;
    muteButton.textContent = video.muted ? "Unmute" : "Mute";
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    return `${String(minutes).padStart(2, "0")}:${remainder}`;
  }

  function connectTosu() {
    clearTimeout(reconnectTimer);

    try {
      socket = new WebSocket(socketUrl);
    } catch (error) {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("message", (event) => {
      try {
        updateCurrentTrack(JSON.parse(event.data));
      } catch (error) {
        // Ignore malformed tosu payloads without putting debug text on stream.
      }
    });

    socket.addEventListener("close", () => {
      setCurrentTrack(WAITING_TRACK_TEXT);
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connectTosu, 2500);
  }

  function updateCurrentTrack(data) {
    const bm = data?.menu?.bm || {};
    const metadata = bm.metadata || {};
    const artist = cleanText(metadata.artist || bm.artist);
    const title = cleanText(metadata.title || bm.title);
    const nextTrack = artist && title ? `${artist} - ${title}` : title || artist;

    if (!nextTrack) {
      setCurrentTrack(WAITING_TRACK_TEXT);
      return;
    }

    setCurrentTrack(nextTrack);
  }

  function setCurrentTrack(text) {
    if (text === currentTrackValue) return;
    currentTrackValue = text;
    currentTrackText.textContent = text;
    currentTrack.classList.add("is-visible");
  }

  function cleanText(value) {
    return String(value || "").trim();
  }
})();
