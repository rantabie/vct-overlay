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
})();
