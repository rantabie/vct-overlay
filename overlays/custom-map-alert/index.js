(function () {
  "use strict";

  const video = document.getElementById("customMapAlert");

  video.currentTime = 0;
  video.play().catch(() => {
    video.muted = true;
    video.play();
  });
})();
