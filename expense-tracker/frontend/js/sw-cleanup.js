// Unregister ALL service workers permanently
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => { r.unregister(); console.log('SW unregistered'); });
  });
  // Also clear all caches
  if (window.caches) {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
}