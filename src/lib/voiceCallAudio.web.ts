const audioState: { element?: HTMLAudioElement } = {};

async function playRemoteAudio(): Promise<boolean> {
  if (!audioState.element) return false;
  try {
    await audioState.element.play();
    return true;
  } catch {
    return false;
  }
}

export const voiceCallAudio = {
  start(_type: "audio" | "video" = "audio") {},
  stop() {
    if (audioState.element) {
      audioState.element.pause();
      audioState.element.srcObject = null;
      audioState.element.remove();
    }
    audioState.element = undefined;
  },
  setSpeaker(_enabled: boolean) {},
  startRingtone() {},
  stopRingtone() {},
  startRingback() {},
  stopRingback() {},
  async attachRemoteAudio(stream: MediaStream): Promise<boolean> {
    if (typeof document === "undefined" || !stream) return false;
    if (!audioState.element) {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("aria-hidden", "true");
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioState.element = audio;
    }
    audioState.element.srcObject = stream;
    return playRemoteAudio();
  },
  resumeRemoteAudio: playRemoteAudio,
};
