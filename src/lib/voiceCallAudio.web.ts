const audioState: { element?: HTMLAudioElement } = {};

export const voiceCallAudio = {
  start() {},
  stop() {
    audioState.element?.remove();
    audioState.element = undefined;
  },
  setSpeaker(_enabled: boolean) {},
  startRingtone() {},
  stopRingtone() {},
  startRingback() {},
  stopRingback() {},
  attachRemoteAudio(stream: any) {
    if (typeof document === "undefined" || !stream) return;
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.setAttribute("aria-hidden", "true");
    audio.style.display = "none";
    document.body.appendChild(audio);
    void audio.play().catch(() => {});
    audioState.element = audio;
  },
};
