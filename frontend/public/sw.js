// Service Worker v9.1 - WORK FOR CASINO BUILD
console.log('SW v9.1: WORK FOR CASINO BUILD');

const SW_VERSION = 'v9.1-WORK-FOR-CASINO-20250116-1200';
const BUILD_TIMESTAMP = Date.now();

console.log(`🚀 SW v9.1 loaded at ${BUILD_TIMESTAMP}`);

// Immediately install and take over
self.addEventListener('install', (event) => {
  console.log(`🔧 SW v9.1: Installing ${SW_VERSION}`);
  // Skip waiting to activate immediately
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.log(`✅ SW v9.1: Activating ${SW_VERSION} - DELETING ALL OLD CACHES`);
  
  event.waitUntil(
    Promise.all([
      // Delete ALL old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            console.log('🗑️ SW v9.1: DELETING cache:', cacheName);
            return caches.delete(cacheName);
          })
        );
      }),
      // Take control of all clients immediately
      self.clients.claim()
    ]).then(() => {
      console.log(`🎉 SW v9.1: ${SW_VERSION} is now active`);
    })
  );
});

// NO FETCH HANDLING - Just let browser handle everything
self.addEventListener('fetch', (event) => {
  // Do nothing - let browser fetch directly
  return;
});

// Message handler for manual cache refresh
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('SW: Manual cache clear requested');
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        if (cacheName.includes('casino-battle')) {
          caches.delete(cacheName);
          console.log('SW: Deleted cache:', cacheName);
        }
      });
    });
  }
});

// Push notification handler
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New game starting!',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Join Now',
        icon: '/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icon-192x192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Casino Battle Royale', options)
  );
});

console.log(`🚀 SW v9.0: Casino Battle Service Worker ${SW_VERSION} loaded - BUILD: ${BUILD_TIMESTAMP}`);