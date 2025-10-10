// Casino Battle Royale Service Worker - FORCE UPDATE v3
const CACHE_NAME = 'casino-battle-v3-force-update-20241010';
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

// Fetch event - BYPASS CACHE FOR HTML
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // For HTML files and API calls, always fetch from network
  if (event.request.mode === 'navigate' || 
      event.request.destination === 'document' ||
      url.pathname.endsWith('.html') ||
      url.pathname.includes('/api/')) {
    
    event.respondWith(
      fetch(event.request).catch(() => {
        // Only fallback to cache if network fails
        return caches.match(event.request);
      })
    );
  } else {
    // For other resources, try cache first
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          return response || fetch(event.request);
        })
    );
  }
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

console.log('SW: Casino Battle Service Worker v3 loaded - FORCE UPDATE');