(function () {
  "use strict";

  const video = document.getElementById("customMapAlert");

  video.addEventListener("ended", hideVideo);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      video.pause();
      video.currentTime = 0;
      hideVideo();
      return;
    }

    playFromStart();
  });

  playFromStart();

  function playFromStart() {
    video.classList.add("is-visible");
    video.currentTime = 0;
    video.play().catch(() => {
      video.muted = true;
      video.play();
    });
  }

  function hideVideo() {
    video.classList.remove("is-visible");
  }
})();
