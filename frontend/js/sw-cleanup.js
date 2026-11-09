// Safe cleanup of legacy service workers without wiping HTTP browser caches on every page load
if ('serviceWorker' in navigator && !sessionStorage.getItem('fl_sw_cleaned')) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    if (regs && regs.length) {
      regs.forEach(r => {
        r.unregister();
        console.log('Legacy ServiceWorker unregistered');
      });
    }
  }).catch(() => {});
  sessionStorage.setItem('fl_sw_cleaned', '1');
}