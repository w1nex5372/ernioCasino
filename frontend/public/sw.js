// Service Worker v9.0 - SYNC FIX WITH GET READY ANIMATION
console.log('SW v9.0: SYNC FIX - GET READY ANIMATION BUILD');

const SW_VERSION = 'v9.0-SYNC-FIX-20250114-1820';
const BUILD_TIMESTAMP = Date.now();
let hasNotifiedClients = false; // Track if we've already notified

console.log(`🚀 SW v9.0 loaded at ${BUILD_TIMESTAMP}`);

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
      
      // Only notify clients once per activation
      if (hasNotifiedClients) {
        console.log('SW v8.0: Already notified clients, skipping');
        return Promise.resolve();
      }
      
      hasNotifiedClients = true;
      
      // Get all window clients
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(clients => {
      if (!clients || clients.length === 0) {
        console.log('SW v8.0: No clients to notify');
        return;
      }
      
      console.log(`SW v8.0: Found ${clients.length} clients to notify (one-time)`);
      
      // Send message to all clients ONCE
      clients.forEach(client => {
        console.log('SW v8.0: Notifying client:', client.url);
        client.postMessage({ 
          type: 'SW_UPDATED', 
          version: SW_VERSION,
          forceReload: true
        });
      });
      
      console.log('SW v8.0: Client notification complete');
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