// Service Worker v8.0 - AGGRESSIVE CACHE CLEARING
console.log('SW v8.0: AGGRESSIVE CACHE CLEAR MODE - Force updating all clients');

const SW_VERSION = 'v8.0-WINNER-FIX-20250114';

// Immediately install and take over
self.addEventListener('install', (event) => {
  console.log(`SW v8.0: Installing new service worker ${SW_VERSION}`);
  // Skip waiting to activate immediately
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.log(`SW v8.0: Activating ${SW_VERSION} - DELETING ALL OLD CACHES`);
  
  event.waitUntil(
    Promise.all([
      // Delete ALL caches
      caches.keys().then((cacheNames) => {
        console.log('SW v8.0: Found caches:', cacheNames);
        return Promise.all(
          cacheNames.map((cacheName) => {
            console.log('SW v8.0: DELETING cache:', cacheName);
            return caches.delete(cacheName);
          })
        );
      }),
      // Take control of all clients immediately
      self.clients.claim()
    ]).then(() => {
      console.log(`SW v8.0: ${SW_VERSION} is now active and controlling all pages`);
      // Refresh all clients to load new version
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          console.log('SW v8.0: Refreshing client:', client.url);
          client.postMessage({ 
            type: 'SW_UPDATED', 
            version: SW_VERSION 
          });
        });
      });
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

console.log(`SW v8.0: Casino Battle Service Worker ${SW_VERSION} loaded at ${Date.now()}`);