(function () {
  "use strict";

  const video = document.getElementById("customMapAlert");
  const DEBUG_AUTOPLAY = new URLSearchParams(window.location.search).get("debug") === "1";
  const END_HOLD_MS = 1000;

  let runId = 0;
  let finishTimer = 0;

  video.addEventListener("ended", finishVideo);
  document.addEventListener("click", playFromStart);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    playFromStart();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetVideo();
  });

  window.addEventListener("obsSourceVisibleChanged", (event) => {
    if (!isObsEventEnabled(event, "visible")) resetVideo();
  });

  window.addEventListener("obsSourceActiveChanged", (event) => {
    if (!isObsEventEnabled(event, "active")) resetVideo();
  });

  resetVideo();
  if (DEBUG_AUTOPLAY) playFromStart();

  async function playFromStart() {
    const currentRun = ++runId;

    clearFinishTimer();
    video.classList.remove("is-visible");
    video.pause();
    try {
      video.currentTime = 0;
    } catch (error) {
      // Metadata may not be ready yet on a freshly created OBS browser source.
    }

    try {
      await waitForReady(currentRun);
      if (currentRun !== runId) return;
      video.classList.add("is-visible");
      await video.play();
    } catch (error) {
      if (currentRun !== runId) return;
      video.muted = true;
      video.classList.add("is-visible");
      video.play().catch(() => resetVideo());
    }
  }

  function resetVideo() {
    runId += 1;
    clearFinishTimer();
    video.pause();
    video.classList.remove("is-visible");
    try {
      video.currentTime = 0;
    } catch (error) {
      // Some browser builds reject seeking before metadata is ready.
    }
  }

  function finishVideo() {
    const currentRun = runId;
    video.pause();
    clearFinishTimer();
    finishTimer = window.setTimeout(() => {
      if (currentRun === runId) resetVideo();
    }, END_HOLD_MS);
  }

  function clearFinishTimer() {
    if (!finishTimer) return;
    window.clearTimeout(finishTimer);
    finishTimer = 0;
  }

  function waitForReady(currentRun) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve();
      }, 500);

      video.addEventListener("loadeddata", onReady);
      video.addEventListener("canplay", onReady);
      video.addEventListener("error", onError);

      function onReady() {
        cleanup();
        resolve();
      }

      function onError() {
        cleanup();
        reject(new Error("Custom map alert video could not load."));
      }

      function cleanup() {
        window.clearTimeout(timeout);
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("error", onError);
      }
    }).then(() => {
      if (currentRun !== runId) throw new Error("Custom map alert play cancelled.");
    });
  }

  function isObsEventEnabled(event, property) {
    if (typeof event.detail === "boolean") return event.detail;
    return Boolean(event.detail?.[property]);
  }
})();
