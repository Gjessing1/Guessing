const AudioManager = (() => {
  const sounds = {};
  let muted = false;

  return {
    load(name, src) {
      const a = new Audio(src);
      a.preload = 'auto';
      sounds[name] = a;
    },
    play(name, loop = false) {
      const a = sounds[name];
      if (!a || muted) return;
      a.loop = loop;
      a.currentTime = 0;
      a.play().catch(() => {});
    },
    stop(name) {
      const a = sounds[name];
      if (!a) return;
      a.pause();
      a.currentTime = 0;
    },
    stopAll() {
      Object.values(sounds).forEach(a => { a.pause(); a.currentTime = 0; });
    },
    resume(name) {
      const a = sounds[name];
      if (!a || muted) return;
      if (a.paused) a.play().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (muted) this.stopAll();
      return muted;
    },
  };
})();
