// Casino Battle Royale Service Worker - FORCE REFRESH v5
const CACHE_NAME = 'casino-battle-FORCE-REFRESH-v5-' + Date.now();
const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
];

// Install Service Worker - FORCE UPDATE
self.addEventListener('install', (event) => {
  // Force immediate activation
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('SW: Installing new cache version:', CACHE_NAME);
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate - DELETE ALL OLD CACHES
self.addEventListener('activate', (event) => {
  console.log('SW: Activating and clearing old caches');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control immediately
      return self.clients.claim();
    })
  );
});

// EMERGENCY - NO CACHE AT ALL
self.addEventListener('fetch', (event) => {
  console.log('SW: EMERGENCY MODE - Bypassing cache for:', event.request.url);
  
  // BYPASS ALL CACHE - Always fetch from network
  event.respondWith(
    fetch(event.request.clone()).then(response => {
      console.log('SW: Fresh response for:', event.request.url);
      return response;
    }).catch(error => {
      console.log('SW: Network failed for:', event.request.url, error);
      // Only for critical failures, try cache
      return caches.match(event.request);
    })
  );
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

console.log('SW: Casino Battle Service Worker v5 loaded - TELEGRAM CACHE FIX ' + Date.now());