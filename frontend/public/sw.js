// Service Worker v8.0 - AGGRESSIVE CACHE CLEARING
console.log('SW v8.0: AGGRESSIVE CACHE CLEAR MODE - Force updating all clients');

const SW_VERSION = 'v8.0-WINNER-FIX-20250114';
let hasNotifiedClients = false; // Track if we've already notified

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
      // Get all window clients
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(clients => {
      console.log(`SW v8.0: Found ${clients.length} clients to update`);
      
      // Send message to all clients first
      clients.forEach(client => {
        console.log('SW v8.0: Notifying client:', client.url);
        client.postMessage({ 
          type: 'SW_UPDATED', 
          version: SW_VERSION,
          forceReload: true
        });
      });
      
      // For Telegram WebView, also try to navigate to force reload
      // This is more aggressive and works even if message handler isn't set up
      return new Promise((resolve) => {
        setTimeout(() => {
          clients.forEach(client => {
            if (client.url && client.url.includes('?')) {
              // Add/update timestamp to force reload
              const url = new URL(client.url);
              url.searchParams.set('_sw_refresh', Date.now());
              console.log('SW v8.0: Navigating client to:', url.href);
              client.navigate(url.href).catch(err => {
                console.log('SW v8.0: Navigate failed (expected in some contexts):', err.message);
              });
            }
          });
          resolve();
        }, 1000);
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