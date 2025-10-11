import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Progress } from './components/ui/progress';
import { Separator } from './components/ui/separator';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';
import { Crown, Coins, Users, Trophy, Zap, Wallet, Play, Timer } from 'lucide-react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Prize links configuration
const PRIZE_LINKS = {
  bronze: "https://your-prize-link-1.com",
  silver: "https://your-prize-link-2.com", 
  gold: "https://your-prize-link-3.com"
};

// Room configurations
const ROOM_CONFIGS = {
  bronze: { 
    name: 'Bronze Room', 
    icon: '🥉', 
    min: 150, 
    max: 450,
    gradient: 'from-amber-600 to-amber-800'
  },
  silver: { 
    name: 'Silver Room', 
    icon: '🥈', 
    min: 500, 
    max: 1500,
    gradient: 'from-slate-400 to-slate-600'
  },
  gold: { 
    name: 'Gold Room', 
    icon: '🥇', 
    min: 2000, 
    max: 8000,
    gradient: 'from-yellow-400 to-yellow-600'
  }
};

// Daily Tokens Button Component
function DailyTokensButton({ user, onClaim }) {
  const [claiming, setClaiming] = React.useState(false);
  const [canClaim, setCanClaim] = React.useState(true);
  const [timeLeft, setTimeLeft] = React.useState('');

  const checkClaimStatus = React.useCallback(async () => {
    if (!user) return;
    
    const lastClaim = user.last_daily_claim;
    if (!lastClaim) {
      setCanClaim(true);
      setTimeLeft('');
      return;
    }

    try {
      const lastClaimDate = new Date(lastClaim);
      const now = new Date();
      const timeSince = (now - lastClaimDate) / 1000; // seconds
      const timeUntilNext = Math.max(0, 86400 - timeSince);

      if (timeUntilNext === 0) {
        setCanClaim(true);
        setTimeLeft('');
      } else {
        setCanClaim(false);
        const hours = Math.floor(timeUntilNext / 3600);
        const minutes = Math.floor((timeUntilNext % 3600) / 60);
        setTimeLeft(`${hours}h ${minutes}m`);
      }
    } catch (error) {
      setCanClaim(true);
    }
  }, [user]);

  React.useEffect(() => {
    checkClaimStatus();
    const interval = setInterval(checkClaimStatus, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [checkClaimStatus]);

  const handleClaim = async () => {
    if (!canClaim || claiming) return;

    setClaiming(true);
    try {
      const response = await axios.post(`${API}/claim-daily-tokens/${user.id}`);
      
      if (response.data.status === 'success') {
        toast.success(`🎁 ${response.data.message}`, { duration: 3000 });
        onClaim(response.data.new_balance);
        setCanClaim(false);
        checkClaimStatus();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error('Failed to claim tokens');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <button
      onClick={handleClaim}
      disabled={!canClaim || claiming}
      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
        canClaim && !claiming
          ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 animate-pulse'
          : 'bg-slate-600 text-slate-400 cursor-not-allowed'
      }`}
      title={canClaim ? 'Claim 10 free tokens!' : `Next claim in ${timeLeft}`}
    >
      {claiming ? '...' : canClaim ? '🎁 Claim 10' : `⏰ ${timeLeft}`}
    </button>
  );
}

// Countdown Timer Component
function CountdownTimer({ onComplete }) {
  const [count, setCount] = React.useState(3);

  React.useEffect(() => {
    if (count === 0) {
      onComplete();
      return;
    }

    const timer = setTimeout(() => {
      setCount(count - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count, onComplete]);

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="text-9xl font-bold text-yellow-400 animate-pulse mb-4">
        {count}
      </div>
      <p className="text-white text-2xl font-semibold">
        {count === 3 && "Get Ready..."}
        {count === 2 && "Selecting Winner..."}
        {count === 1 && "Almost There..."}
      </p>
    </div>
  );
}

function App() {
  // Core state
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [telegramError, setTelegramError] = useState(false);

  // Data state
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomParticipants, setRoomParticipants] = useState({}); // Track participants per room
  const [gameHistory, setGameHistory] = useState([]);
  const [userPrizes, setUserPrizes] = useState([]);
  const [inLobby, setInLobby] = useState(false); // Track if user is in lobby waiting
  const [lobbyData, setLobbyData] = useState(null); // Store lobby room data
  const [showWinnerScreen, setShowWinnerScreen] = useState(false); // Show winner announcement
  const [winnerData, setWinnerData] = useState(null); // Store winner information
  const [gameInProgress, setGameInProgress] = useState(false); // Track if game is running
  const [currentGameData, setCurrentGameData] = useState(null); // Store current game info
  
  // UI state
  const [activeTab, setActiveTab] = useState('rooms');
  const [isMobile, setIsMobile] = useState(false);
  const [casinoWalletAddress, setCasinoWalletAddress] = useState('Loading...');
  const [welcomeBonusStatus, setWelcomeBonusStatus] = useState(null);

  // Form state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmount, setBetAmount] = useState('');

  // Debug roomParticipants changes
  useEffect(() => {
    console.log('🔄 roomParticipants changed:', roomParticipants);
    if (lobbyData) {
      console.log(`Players in ${lobbyData.room_type} room:`, roomParticipants[lobbyData.room_type]);
    }
  }, [roomParticipants, lobbyData]);

  // Debug winner screen state
  useEffect(() => {
    console.log('🏆 showWinnerScreen changed:', showWinnerScreen);
    console.log('🏆 winnerData:', winnerData);
  }, [showWinnerScreen, winnerData]);

  // Debug game in progress state
  useEffect(() => {
    console.log('🎮 gameInProgress changed:', gameInProgress);
    console.log('🎮 currentGameData:', currentGameData);
  }, [gameInProgress, currentGameData]);

  // Debug lobby state
  useEffect(() => {
    console.log('🚪 inLobby changed:', inLobby);
    console.log('🚪 lobbyData:', lobbyData);
  }, [inLobby, lobbyData]);

  // POLL for room participants while in lobby (ensures both players see each other)
  useEffect(() => {
    if (!inLobby || !lobbyData) {
      console.log('⚠️ Polling NOT started - inLobby:', inLobby, 'lobbyData:', lobbyData);
      return;
    }
    
    console.log('🔄 Starting lobby participant polling for', lobbyData.room_type);
    let pollCount = 0;
    
    const fetchParticipants = async () => {
      pollCount++;
      console.log(`📡 Poll #${pollCount} - Fetching participants for ${lobbyData.room_type}...`);
      
      try {
        const response = await axios.get(`${API}/room-participants/${lobbyData.room_type}`);
        console.log(`📊 Poll #${pollCount} - Response:`, response.data);
        
        // ALWAYS update, even if empty (to clear old data)
        const players = response.data.players || [];
        console.log(`👥 Poll #${pollCount} - Players found:`, players.length, players);
        
        setRoomParticipants(prev => {
          const updated = {
            ...prev,
            [lobbyData.room_type]: players
          };
          console.log(`✅ Poll #${pollCount} - State updated:`, updated[lobbyData.room_type]);
          return updated;
        });
        
        // React will automatically re-render when state changes
        if (players.length >= 3) {
          console.log('🎉 3 PLAYERS FOUND! Checking game status...');
          // Check if game has started or finished
          checkGameStatus(lobbyData.room_type);
        }
      } catch (error) {
        console.error(`❌ Poll #${pollCount} - Failed:`, error);
      }
    };
    
    // Fetch immediately
    fetchParticipants();
    
    // Then poll every 500ms (reliable for lobby updates)
    const pollInterval = setInterval(fetchParticipants, 500);
    
    return () => {
      console.log(`🛑 Stopping lobby participant polling after ${pollCount} polls`);
      clearInterval(pollInterval);
    };
  }, [inLobby, lobbyData]);

  // Mobile detection - force mobile for Telegram WebApp
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Force mobile in Telegram WebApp environment or narrow screens
      const isTelegram = window.Telegram && window.Telegram.WebApp;
      const shouldBeMobile = width <= 768 || isTelegram || (height > width && width <= 1024);
      setIsMobile(shouldBeMobile);
      console.log(`Mobile detection: width=${width}, height=${height}, isTelegram=${!!isTelegram}, isMobile=${shouldBeMobile}`);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  // Socket connection
  useEffect(() => {
    console.log('🔌 Connecting to WebSocket:', BACKEND_URL);
    const newSocket = io(BACKEND_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      forceNew: false
    });
    
    newSocket.on('connect', () => {
      console.log('✅✅✅ WebSocket CONNECTED! ID:', newSocket.id);
      toast.success('Connected to server!', { duration: 2000 });
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('❌❌❌ WebSocket connection error:', error);
      // Remove persistent error notifications - just log to console
    });
    
    newSocket.on('disconnect', (reason) => {
      console.warn('⚠️⚠️⚠️ WebSocket disconnected:', reason);
      toast.warning('Disconnected from server', { duration: 2000 });
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('✅ Connected to server');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
      setIsConnected(false);
    });

    // Game events
    newSocket.on('player_joined', (data) => {
      console.log('👤 Player joined:', data);
      console.log('All players in room:', data.all_players);
      
      // Update room participants - this will trigger lobby re-render
      setRoomParticipants(prev => {
        const updated = {
          ...prev,
          [data.room_type]: data.all_players || []
        };
        console.log('Updated roomParticipants:', updated);
        return updated;
      });
      
      // Show notification
      toast.success(
        `🎯 ${data.player.first_name} joined ${data.room_type} room! (${data.players_count}/3)`,
        { duration: 3000 }
      );
      
      // Reload rooms to update counts
      loadRooms();
    });

    newSocket.on('game_starting', (data) => {
      console.log('🎮 Game starting:', data);
      
      // Show BIG notification to ALL players (even those outside the room)
      toast.success(`🎰 ${ROOM_CONFIGS[data.room_type]?.icon} ${ROOM_CONFIGS[data.room_type]?.name} ROOM IS FULL! Game starting!`, {
        duration: 3000,
        style: {
          background: '#10b981',
          color: 'white',
          fontSize: '16px',
          fontWeight: 'bold'
        }
      });
      
      // If user is in this room, show game screen
      if (inLobby && lobbyData?.room_type === data.room_type) {
        setInLobby(false);
        setGameInProgress(true);
        setCurrentGameData({
          room_type: data.room_type,
          players: roomParticipants[data.room_type] || data.players || [],
          message: 'Game in progress...'
        });
        setActiveRoom(data);
      }
      
      // Reload rooms for all players to see updated status
      loadRooms();
    });

    newSocket.on('game_finished', (data) => {
      console.log('🏆 GAME FINISHED EVENT RECEIVED!');
      console.log('📊 Game data:', data);
      console.log('👤 Current user:', user);
      console.log('🎯 User telegram_id:', user?.telegram_id);
      console.log('🎯 Winner telegram_id:', data.winner?.telegram_id);
      
      // Show notification to ALL players about the winner
      const winnerName = data.winner_name || `${data.winner?.first_name} ${data.winner?.last_name || ''}`.trim();
      const gameTime = new Date().toLocaleTimeString();
      
      // BIG TOAST for everyone
      toast.success(`🏆 ${ROOM_CONFIGS[data.room_type]?.icon} Game Finished at ${gameTime}! Winner: ${winnerName}`, {
        duration: 8000,
        style: {
          background: '#eab308',
          color: 'black',
          fontSize: '18px',
          fontWeight: 'bold',
          padding: '20px'
        }
      });
      
      // FORCE CLOSE ALL OTHER SCREENS
      setGameInProgress(false);
      setCurrentGameData(null);
      setInLobby(false);
      setLobbyData(null);
      setActiveRoom(null);
      console.log('✅ All game screens closed');
      
      // Check if current user is the winner
      const isWinner = user && (user.telegram_id === data.winner?.telegram_id || user.id === data.winner_id);
      console.log('🤔 Am I the winner?', isWinner);
      
      // Show winner screen to ALL players
      const winnerInfo = {
        winner_name: winnerName,
        winner_telegram_id: data.winner?.telegram_id || data.winner_telegram_id,
        winner_photo: data.winner?.photo_url || '',
        winner_username: data.winner?.username || '',
        room_type: data.room_type,
        prize_link: data.prize_link,
        is_winner: isWinner,
        game_time: gameTime
      };
      console.log('👑 Setting winner info:', winnerInfo);
      
      setWinnerData(winnerInfo);
      setShowWinnerScreen(true);
      console.log('✅ Winner screen state set to TRUE');
      
      // Extra logging
      setTimeout(() => {
        console.log('⏱️ After 1 second - showWinnerScreen:', showWinnerScreen);
        console.log('⏱️ After 1 second - winnerData:', winnerData);
      }, 1000);
      
      // AUTO-CLOSE after 2 seconds and return to rooms
      setTimeout(() => {
        console.log('⏰ 2 seconds passed, closing winner screen...');
        setShowWinnerScreen(false);
        setWinnerData(null);
        setActiveTab('rooms');
        toast.success('Room reset! Ready for new players 🎰');
      }, 2000);
      
      // Refresh data
      loadRooms();
      loadGameHistory();
      if (user) loadUserPrizes();
    });

    newSocket.on('prize_won', (data) => {
      console.log('🎉 Prize won:', data);
      toast.success('🎉 Congratulations! You won a prize!');
      if (user) loadUserPrizes();
    });

    newSocket.on('rooms_updated', () => {
      loadRooms();
    });

    newSocket.on('new_room_available', (data) => {
      console.log('🆕 New room available:', data);
      loadRooms();
      toast.success(`${ROOM_CONFIGS[data.room_type]?.icon} New ${data.room_type} room ready! Round #${data.round_number}`, {
        duration: 2000
      });
    });

    newSocket.on('token_balance_updated', (data) => {
      if (user && data.user_id === user.id) {
        setUser({...user, token_balance: data.new_balance});
        toast.success(`🎉 Payment confirmed! +${data.tokens_added} tokens (${data.sol_received} SOL)`);
      }
    });

    return () => {
      console.log('🧹 Cleaning up WebSocket connection');
      newSocket.close();
    };
  }, []); // Empty dependency array - only run once on mount

  // Authentication and data loading
  useEffect(() => {
    // Clear any cached data and force refresh for Telegram
    // AGGRESSIVE CACHE CLEARING for Telegram Web App
    console.log('🧹 Clearing ALL caches and sessions...');
    localStorage.clear(); // Clear everything including old sessions
    sessionStorage.clear();
    
    // Clear Service Worker caches
    if ('caches' in window) {
      caches.keys().then(cacheNames => {
        cacheNames.forEach(cacheName => {
          if (cacheName.includes('casino')) {
            caches.delete(cacheName);
            console.log('Deleted cache:', cacheName);
          }
        });
      });
    }
    
    // Force Telegram Web App to reload if available
    if (window.Telegram && window.Telegram.WebApp) {
      console.log('🔄 Forcing Telegram Web App refresh...');
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      // Send reload message to service worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({type: 'CLEAR_CACHE'});
      }
    }
    
    // Check for saved user session first (after clearing, this should be null on first load)
    const savedUser = localStorage.getItem('casino_user');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        console.log('Found saved user session:', userData);
        
        // Set cached user first for instant UI
        setUser(userData);
        setIsLoading(false);
        toast.success('Welcome back! Session restored.');
        
        // Load fresh data
        loadRooms();
        loadGameHistory();
        loadUserPrizes();
        
        // IMMEDIATELY refresh from server to get latest balance (async)
        (async () => {
          try {
            const response = await axios.get(`${API}/user/${userData.id}`);
            if (response.data) {
              console.log('✅ Refreshed user data from server:', response.data);
              setUser(response.data);
              saveUserSession(response.data);
              toast.success(`Balance updated: ${response.data.token_balance} tokens`);
            }
          } catch (refreshError) {
            console.log('Failed to refresh from server:', refreshError);
          }
        })();
        
        return;
      } catch (e) {
        console.log('Failed to parse saved user, continuing with auth');
        localStorage.removeItem('casino_user');
      }
    }
    
    loadRooms();
    loadGameHistory();
    loadWelcomeBonusStatus();
    
    // Telegram authentication - REAL USERS ONLY
    const authenticateFromTelegram = async () => {
      // Background Telegram auth - updates user if in Telegram environment
      try {
        console.log('🔍 Initializing Telegram Web App authentication...');
        
        // Quick check for Telegram environment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // If not in Telegram environment, throw error to trigger fallback
        if (!window.Telegram || !window.Telegram.WebApp) {
          throw new Error('Not in Telegram environment');
        }
        
        const webApp = window.Telegram.WebApp;
        console.log('=' * 50);
        console.log('🔍 TELEGRAM WEB APP DEBUG INFO:');
        console.log('WebApp object:', webApp);
        console.log('WebApp.initData:', webApp.initData);
        console.log('WebApp.initDataUnsafe:', webApp.initDataUnsafe);
        console.log('WebApp.initDataUnsafe.user:', webApp.initDataUnsafe?.user);
        console.log('=' * 50);
        
        // Initialize WebApp
        webApp.ready();
        webApp.expand();
        
        // Get Telegram user data
        let telegramUser = webApp.initDataUnsafe?.user;
        console.log('Initial telegramUser:', telegramUser);
        
        // If no user data in initDataUnsafe, try other methods
        if (!telegramUser || !telegramUser.id) {
          console.log('No user in initDataUnsafe, checking other sources...');
          
          // Try to get user from initData if available
          if (webApp.initData) {
            try {
              const initDataParams = new URLSearchParams(webApp.initData);
              const userParam = initDataParams.get('user');
              if (userParam) {
                telegramUser = JSON.parse(decodeURIComponent(userParam));
                console.log('Found user in initData:', telegramUser);
              }
            } catch (e) {
              console.log('Failed to parse user from initData:', e);
            }
          }
          
          // If still no user, throw error - NO FALLBACK
          if (!telegramUser || !telegramUser.id) {
            console.error('❌ NO TELEGRAM USER DATA AVAILABLE!');
            console.error('WebApp.initData:', webApp.initData);
            console.error('WebApp.initDataUnsafe:', webApp.initDataUnsafe);
            throw new Error('No Telegram user data - Bot might not be configured correctly');
          }
        }
        
        console.log('Final telegramUser:', telegramUser);
        
        // Prepare authentication data
        const authData = {
          id: parseInt(telegramUser.id),
          first_name: telegramUser.first_name || 'Telegram User',
          last_name: telegramUser.last_name || null,
          username: telegramUser.username || null,
          photo_url: telegramUser.photo_url || null,
          auth_date: Math.floor(Date.now() / 1000),
          hash: webApp.initData || 'telegram_webapp',
          telegram_id: parseInt(telegramUser.id)
        };

        console.log('Sending authentication request with data:', authData);
        
        const response = await axios.post(`${API}/auth/telegram`, {
          telegram_auth_data: authData
        }, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('Authentication response:', response.data);
        
        // Update with real Telegram user data and save session
        setUser(response.data);
        saveUserSession(response.data);
        setIsLoading(false);
        toast.success(`Welcome back, ${telegramUser.first_name}!`);
        
        // Configure WebApp
        webApp.enableClosingConfirmation();
        if (webApp.setHeaderColor) webApp.setHeaderColor('#1e293b');
        if (webApp.setBackgroundColor) webApp.setBackgroundColor('#0f172a');
        
        // Load user data
        setTimeout(() => {
          loadUserPrizes();
          loadDerivedWallet();
        }, 1000);
        
      } catch (error) {
        console.error('❌ Telegram authentication failed:', error);
        
        // If we have Telegram user data, try to find existing account
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
          const telegramUser = window.Telegram.WebApp.initDataUnsafe.user;
          if (telegramUser && telegramUser.id) {
            try {
              console.log('Trying to find existing user by Telegram ID:', telegramUser.id);
              const response = await axios.get(`${API}/users/telegram/${telegramUser.id}`);
              
              if (response.data) {
                console.log('Found existing user with tokens!', response.data);
                setUser(response.data);
                saveUserSession(response.data);
                setIsLoading(false);
                toast.success(`Welcome back, ${response.data.first_name}! Your tokens are restored.`);
                
                setTimeout(() => {
                  loadUserPrizes();
                  loadDerivedWallet();
                }, 1000);
                return;
              }
            } catch (lookupError) {
              console.log('User not found by Telegram ID:', lookupError);
            }
          }
        }
        
        // If all else fails, create temporary account
        console.log('Creating temporary account as last resort');
        setIsLoading(false);
      }
    };

    // Start authentication immediately
    const authTimeout = setTimeout(authenticateFromTelegram, 100);
    
    // Fallback timeout - load user from Telegram data if available
    const fallbackTimeout = setTimeout(async () => {
      if (isLoading && !user) {
        console.log('Authentication timeout - trying Telegram user data extraction');
        
        let telegramUser = null;
        
        // Try to get Telegram user data even if authentication failed
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
          telegramUser = window.Telegram.WebApp.initDataUnsafe.user;
        }
        
        if (telegramUser && telegramUser.id) {
          // Try to find existing user in database by Telegram ID
          try {
            const response = await axios.get(`${API}/users/telegram/${telegramUser.id}`);
            if (response.data) {
              setUser(response.data);
              saveUserSession(response.data);
              setIsLoading(false);
              toast.success(`Welcome back, ${telegramUser.first_name}!`);
              return;
            }
          } catch (e) {
            console.log('User not found in database, will create fallback');
          }
        }
        
        // Last resort fallback - create and save to backend
        const fallbackTelegramData = {
          id: telegramUser?.id || Date.now(),
          first_name: telegramUser?.first_name || 'Player',
          last_name: telegramUser?.last_name || '',
          username: telegramUser?.username || '',
          photo_url: telegramUser?.photo_url || '',
          auth_date: Math.floor(Date.now() / 1000), // Unix timestamp
          hash: 'fallback-hash-' + Date.now() // Fallback hash
        };
        
        const fallbackUserCreate = {
          telegram_auth_data: fallbackTelegramData
        };
        
        try {
          // Save fallback user to backend database
          const response = await axios.post(`${API}/auth/telegram`, fallbackUserCreate);
          if (response.data) {
            setUser(response.data);
            saveUserSession(response.data);
            
            // Check if user got welcome bonus
            if (response.data.token_balance >= 1000) {
              toast.success('🎉 Welcome! You got 1000 FREE tokens!', { duration: 5000 });
            } else {
              toast.success('Account created successfully!');
            }
            
            // Refresh welcome bonus status
            loadWelcomeBonusStatus();
          }
        } catch (error) {
          // If backend save fails, use frontend-only fallback
          setUser({
            id: 'fallback-' + Date.now(),
            first_name: fallbackTelegramData.first_name,
            last_name: fallbackTelegramData.last_name,
            token_balance: 0,
            telegram_id: fallbackTelegramData.id,
            username: fallbackTelegramData.username
          });
          toast.warning('Using temporary account - limited functionality');
        }
        setIsLoading(false);
      }
    }, 5000);
    
    return () => {
      clearTimeout(authTimeout);
      clearTimeout(fallbackTimeout);
    };
  }, []);

  // User session management
  const saveUserSession = (userData) => {
    try {
      localStorage.setItem('casino_user', JSON.stringify(userData));
      console.log('User session saved');
    } catch (e) {
      console.log('Failed to save user session:', e);
    }
  };

  const refreshUserData = async (userId) => {
    try {
      // Refresh user balance and data from server
      const response = await axios.get(`${API}/user/${userId}`);
      if (response.data) {
        setUser(response.data);
        saveUserSession(response.data);
        console.log('User data refreshed:', response.data);
      }
    } catch (error) {
      console.log('Failed to refresh user data:', error);
    }
  };

  // Data loading functions
  const loadRooms = async () => {
    try {
      const response = await axios.get(`${API}/rooms`);
      setRooms(response.data.rooms);
    } catch (error) {
      console.error('Failed to load rooms:', error);
      toast.error('Failed to load rooms');
    }
  };

  const loadWelcomeBonusStatus = async () => {
    try {
      const response = await axios.get(`${API}/welcome-bonus-status`);
      setWelcomeBonusStatus(response.data);
    } catch (error) {
      console.error('Failed to load welcome bonus status:', error);
    }
  };

  const loadDerivedWallet = async () => {
    try {
      if (!user || !user.id) return;
      
      const response = await axios.get(`${API}/user/${user.id}/derived-wallet`);
      setCasinoWalletAddress(response.data.derived_wallet_address);
      toast.success('Your personal wallet loaded! 🎯');
    } catch (error) {
      console.error('Failed to load derived wallet:', error);
      setCasinoWalletAddress('Error loading wallet');
      toast.error('Failed to load wallet address');
    }
  };

  const loadGameHistory = async () => {
    try {
      const response = await axios.get(`${API}/game-history?limit=10`);
      setGameHistory(response.data.games);
    } catch (error) {
      console.error('Failed to load game history:', error);
    }
  };

  const loadUserPrizes = async () => {
    try {
      if (!user || !user.id) return;
      const response = await axios.get(`${API}/user/${user.id}/prizes`);
      setUserPrizes(response.data.prizes || []);
    } catch (error) {
      console.error('Failed to load prizes:', error);
    }
  };

  // Game functions
  const joinRoom = async (roomType) => {
    console.log('🎯 JOIN ROOM CALLED!', { 
      roomType, 
      user: user ? 'EXISTS' : 'NULL', 
      betAmount,
      selectedRoom 
    });
    
    if (!user) {
      console.error('❌ No user');
      toast.error('Please authenticate first');
      return;
    }

    // Parse bet amount
    const parsedBetAmount = parseInt(betAmount);
    console.log('💰 Parsed bet amount:', parsedBetAmount);
    
    if (!parsedBetAmount || isNaN(parsedBetAmount)) {
      console.error('❌ Invalid bet amount (not a number)', betAmount);
      toast.error('Please enter a valid bet amount');
      return;
    }

    if (parsedBetAmount < ROOM_CONFIGS[roomType].min || parsedBetAmount > ROOM_CONFIGS[roomType].max) {
      console.error('❌ Bet amount out of range', parsedBetAmount);
      toast.error(`Bet amount must be between ${ROOM_CONFIGS[roomType].min} - ${ROOM_CONFIGS[roomType].max} tokens`);
      return;
    }

    if (user.token_balance < parsedBetAmount) {
      console.error('❌ Insufficient tokens', { balance: user.token_balance, bet: parsedBetAmount });
      toast.error('Insufficient tokens');
      return;
    }

    console.log('✅ Validation passed, calling API with:', {
      room_type: roomType,
      user_id: user.id,
      bet_amount: parsedBetAmount
    });
    
    try {
      const response = await axios.post(`${API}/join-room`, {
        room_type: roomType,
        user_id: user.id,
        bet_amount: parsedBetAmount
      });
      console.log('✅ API Response:', response.data);

      if (response.data.status === 'joined') {
        toast.success(`Joined ${ROOM_CONFIGS[roomType].name}! Waiting for opponent...`);
        setUser({...user, token_balance: response.data.new_balance});
        setBetAmount('');
        setSelectedRoom(null);
        
        // Set initial room participants with current user
        const currentPlayer = {
          user_id: user.id,
          first_name: user.first_name,
          last_name: user.last_name || '',
          username: user.telegram_username || user.username || '',
          photo_url: user.photo_url || '',
          bet_amount: parseInt(betAmount)
        };
        
        setRoomParticipants(prev => ({
          ...prev,
          [roomType]: [currentPlayer]
        }));
        
        // Enter lobby mode
        setInLobby(true);
        setLobbyData({
          room_type: roomType,
          room_id: response.data.room_id,
          bet_amount: parseInt(betAmount)
        });
        
        loadRooms();
      }
    } catch (error) {
      console.error('Join room error:', error);
      toast.error(error.response?.data?.detail || 'Failed to join room');
    }
  };

  // Error screen for non-Telegram access
  if (telegramError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/90 border-slate-700">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Telegram Web App Required</h3>
            <p className="text-slate-400 mb-4">This casino must be opened as a Telegram Web App, not in a regular browser.</p>
            
            <div className="space-y-3 text-left mb-4">
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">📱</span>
                <p className="text-sm text-slate-300">Open Telegram on your mobile device</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">🔍</span>
                <p className="text-sm text-slate-300">Find your casino bot or Web App</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">🚀</span>
                <p className="text-sm text-slate-300">Tap "Launch" or "Open App" in Telegram</p>
              </div>
            </div>
            
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-4">
              <p className="text-sm text-blue-300 font-medium mb-1">
                🔒 Why Telegram Only?
              </p>
              <p className="text-xs text-blue-200">
                Authentication and payments work securely only within Telegram's environment.
              </p>
            </div>
            
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-300 font-medium">
                ⚠️ Not working? Contact support with error details.
              </p>
            </div>
            <Button
              onClick={() => window.location.reload()}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700"
            >
              🔄 Retry Connection
            </Button>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // Loading screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/90 border-slate-700">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold text-white mb-2">Connecting to Telegram...</h3>
            <p className="text-slate-400">Authenticating your account</p>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/90 border-slate-700">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold text-white mb-2">Loading Casino...</h3>
            <p className="text-slate-400">Connecting to Telegram Web App</p>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white ${
      isMobile ? 'overflow-x-hidden max-w-full w-full' : ''
    }`} style={isMobile ? {maxWidth: '100vw', width: '100vw'} : {}}>
      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-50">
        <div className="px-4 py-3">
          {isMobile ? (
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Crown className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                <div>
                  <h1 className="text-sm font-bold text-white">Casino Battle</h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-xs text-slate-400">Balance</div>
                  <div className="text-sm font-bold text-yellow-400">{user.token_balance || 0}</div>
                </div>
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="w-8 h-8 text-yellow-400" />
                <h1 className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
                  Casino Battle Royale
                </h1>
              </div>
              
              <div className="flex items-center gap-6">
                <Button
                  onClick={() => setActiveTab('tokens')}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2"
                >
                  <Coins className="w-4 h-4 mr-2" />
                  Buy Tokens
                </Button>

                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">{user.first_name}{user.last_name ? ` ${user.last_name}` : ''}</span>
                  {user.is_owner && (
                    <span className="px-2 py-1 bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-xs font-bold rounded-full">
                      OWNER
                    </span>
                  )}
                  {user.is_admin && !user.is_owner && (
                    <span className="px-2 py-1 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-xs font-bold rounded-full">
                      ADMIN
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Coins className="w-4 h-4 text-yellow-400" />
                    <span className="text-lg font-bold text-yellow-400">{user.token_balance || 0}</span>
                    <span className="text-slate-400">tokens</span>
                  </div>
                  <DailyTokensButton user={user} onClaim={(newBalance) => setUser({...user, token_balance: newBalance, last_daily_claim: new Date().toISOString()})} />
                </div>
                {userPrizes.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Trophy className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-green-400">{userPrizes.length} prizes</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className={`text-xs ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <nav className="desktop-sidebar w-64 bg-slate-800/50 backdrop-blur-sm border-r border-slate-700 min-h-screen p-4">
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab('rooms')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'rooms' 
                    ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Users className="w-5 h-5" />
                <span>Battle Rooms</span>
              </button>
              
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'history' 
                    ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Timer className="w-5 h-5" />
                <span>History</span>
              </button>
              
              <button
                onClick={() => setActiveTab('tokens')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'tokens' 
                    ? 'bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Coins className="w-5 h-5" />
                <span>Buy Tokens</span>
              </button>
              
            </div>
            
            {/* Stats Sidebar */}
            <div className="mt-8 space-y-4">
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Your Balance</div>
                <div className="text-2xl font-bold text-yellow-400">{user.token_balance}</div>
                <div className="text-xs text-slate-500">Casino Tokens</div>
              </div>
            </div>
          </nav>
        )}

        {/* Main Content */}
        <main className={`flex-1 ${isMobile ? 'p-2 pb-24 w-full overflow-x-hidden' : 'p-6'}`} style={isMobile ? {maxWidth: '100vw'} : {}}>
          <div className={`${isMobile ? 'space-y-3 w-full max-w-full' : 'space-y-6'}`}>

            {/* Mobile Welcome Header - Compact */}
            {isMobile && (
              <div className="bg-gradient-to-r from-green-600/15 to-emerald-600/15 border border-green-500/20 rounded-lg p-3 mb-3">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <h3 className="text-base font-bold text-white">Welcome, {user.first_name}!</h3>
                    {user.is_owner && (
                      <span className="px-2 py-0.5 bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-xs font-bold rounded-full">
                        OWNER
                      </span>
                    )}
                    {user.is_admin && !user.is_owner && (
                      <span className="px-2 py-0.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-xs font-bold rounded-full">
                        ADMIN
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <p className="text-yellow-400 font-medium text-sm">Balance: {user.token_balance || 0} tokens</p>
                    <button 
                      onClick={() => {
                        refreshUserData(user.id);
                        toast.info('Refreshing balance...');
                      }}
                      className="text-blue-400 hover:text-blue-300 transition-colors"
                      title="Refresh balance"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                  <DailyTokensButton user={user} onClaim={(newBalance) => setUser({...user, token_balance: newBalance, last_daily_claim: new Date().toISOString()})} />
                </div>
              </div>
            )}

            {/* Welcome Card - Desktop Only */}
            {!isMobile && (
              <Card className="desktop-welcome-card bg-gradient-to-r from-green-600/20 to-emerald-600/20 border-green-500/30">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                        <Coins className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">Welcome, {user.first_name}!</h3>
                        <p className="text-green-200">Send SOL to get tokens • Rate based on current SOL/EUR price</p>
                        <p className="text-yellow-400 font-semibold">Your Balance: {user.token_balance || 0} tokens</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => setActiveTab('tokens')}
                      size="lg"
                      className="bg-green-600 hover:bg-green-700 text-white font-bold px-8 py-4 text-lg"
                    >
                      <Coins className="w-5 h-5 mr-2" />
                      Buy Tokens
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* WINNER ANNOUNCEMENT SCREEN - Show to all players after game */}
            {showWinnerScreen && winnerData && (
              <Card className={`bg-slate-800/90 border-2 ${winnerData.is_winner ? 'border-green-500 shadow-lg shadow-green-500/50' : 'border-red-500 shadow-lg shadow-red-500/50'}`}>
                <CardContent className="p-8">
                  <div className="text-center space-y-6">
                    {/* Trophy Animation */}
                    <div className="flex justify-center">
                      <div className="w-24 h-24 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center animate-bounce">
                        <Trophy className="w-12 h-12 text-slate-900" />
                      </div>
                    </div>
                    
                    {/* Winner/Loser Announcement */}
                    <div>
                      {winnerData.is_winner ? (
                        <>
                          <h2 className="text-4xl font-bold text-green-400 mb-2 animate-pulse">
                            🎉 YOU WON! 🎉
                          </h2>
                          <p className="text-white text-2xl font-bold mb-2">
                            Congratulations!
                          </p>
                          <p className="text-slate-300 text-lg mb-2">
                            {ROOM_CONFIGS[winnerData.room_type]?.icon} {ROOM_CONFIGS[winnerData.room_type]?.name} at {winnerData.game_time}
                          </p>
                        </>
                      ) : (
                        <>
                          <h2 className="text-3xl font-bold text-orange-400 mb-3">
                            Room {ROOM_CONFIGS[winnerData.room_type]?.name} is Full
                          </h2>
                          <p className="text-white text-lg mb-2">
                            This game at <span className="text-yellow-400 font-bold">{winnerData.game_time}</span> has ended.
                          </p>
                          <p className="text-white text-2xl font-bold mb-2">
                            Winner: <span className="text-green-400">{winnerData.winner_name}</span>
                          </p>
                          <p className="text-slate-400 text-sm">
                            Better luck next time!
                          </p>
                        </>
                      )}
                    </div>
                    
                    {/* Winner Profile */}
                    <div className="flex flex-col items-center gap-4 p-6 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 rounded-lg border border-yellow-500/30">
                      {/* Profile Picture */}
                      <div className="w-24 h-24 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600 flex items-center justify-center text-slate-900 font-bold text-3xl">
                        {winnerData.winner_photo ? (
                          <img 
                            src={winnerData.winner_photo} 
                            alt={winnerData.winner_name} 
                            className="w-24 h-24 rounded-full"
                          />
                        ) : (
                          winnerData.winner_name?.charAt(0).toUpperCase()
                        )}
                      </div>
                      
                      {/* Winner Name */}
                      <div>
                        <p className="text-2xl font-bold text-white">
                          {winnerData.winner_name}
                        </p>
                        {winnerData.winner_username && (
                          <p className="text-slate-400">@{winnerData.winner_username}</p>
                        )}
                      </div>
                      
                      {/* Winner Badge */}
                      {winnerData.is_winner && (
                        <Badge className="bg-green-500 text-black text-lg px-4 py-2 animate-pulse">
                          ✓ You Won!
                        </Badge>
                      )}
                    </div>
                    
                    {/* Claim Prize Button - ONLY FOR WINNER */}
                    {winnerData.is_winner && winnerData.prize_link && (
                      <div className="space-y-3">
                        <Button
                          onClick={() => {
                            window.open(winnerData.prize_link, '_blank');
                            toast.success('Prize link opened!');
                          }}
                          className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold text-lg py-6"
                        >
                          🎁 Claim Your Prize Now!
                        </Button>
                        <p className="text-sm text-slate-400">
                          Click to claim your reward!
                        </p>
                      </div>
                    )}
                    
                    {/* Auto-close message */}
                    <div className="text-center">
                      <p className="text-slate-400 text-sm animate-pulse">
                        Returning to rooms in 2 seconds...
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* GAME IN PROGRESS SCREEN - Show countdown */}
            {gameInProgress && currentGameData && (
              <Card className="bg-slate-800/90 border-2 border-green-500/50">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl text-green-400 flex items-center justify-center gap-2">
                    <Zap className="w-6 h-6 animate-pulse" />
                    {ROOM_CONFIGS[currentGameData.room_type]?.icon} Room is Full!
                  </CardTitle>
                  <CardDescription className="text-lg text-white">
                    This game at {new Date().toLocaleTimeString()} has taken place and is now FULL.
                  </CardDescription>
                  
                  {/* COUNTDOWN TIMER */}
                  <div className="mt-4">
                    <CountdownTimer 
                      onComplete={() => {
                        console.log('⏰ Countdown complete, waiting for winner...');
                      }}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Show both players competing */}
                    <div>
                      <h3 className="text-white font-semibold mb-3 text-center">Players in This Game:</h3>
                      <div className="space-y-3">
                        {currentGameData.players?.map((player, index) => (
                          <div key={`game-player-${player.user_id}`} className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-600/20 to-blue-600/20 rounded-lg border border-green-500/30">
                            {/* Profile Picture */}
                            <div className="w-12 h-12 rounded-full bg-gradient-to-r from-green-400 to-blue-400 flex items-center justify-center text-slate-900 font-bold text-xl flex-shrink-0">
                              {player.photo_url ? (
                                <img src={player.photo_url} alt={player.first_name} className="w-12 h-12 rounded-full" />
                              ) : (
                                player.first_name?.charAt(0).toUpperCase()
                              )}
                            </div>
                            
                            {/* Player Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-white font-semibold truncate">
                                  {player.first_name} {player.last_name || ''}
                                </p>
                                {player.user_id === user?.id && (
                                  <Badge className="bg-blue-500 text-white text-xs">You</Badge>
                                )}
                              </div>
                              {player.username && (
                                <p className="text-slate-400 text-sm">@{player.username}</p>
                              )}
                              <p className="text-yellow-400 text-sm font-medium">Bet: {player.bet_amount} tokens</p>
                            </div>
                            
                            {/* Battle indicator for 3-player games */}
                            {index === 1 && currentGameData.players.length === 3 && (
                              <div className="absolute left-1/2 transform -translate-x-1/2 bg-red-500 text-white font-bold px-2 py-1 rounded-full text-xs">
                                ⚔️ BATTLE
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                  </div>
                </CardContent>
              </Card>
            )}

            {/* LOBBY SCREEN - Show when player is waiting in room */}
            {!showWinnerScreen && !gameInProgress && inLobby && lobbyData && (
              <Card className="bg-slate-800/90 border-2 border-yellow-500/50">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl text-yellow-400 flex items-center justify-center gap-2">
                    <Users className="w-6 h-6" />
                    {ROOM_CONFIGS[lobbyData.room_type]?.icon} {ROOM_CONFIGS[lobbyData.room_type]?.name} Lobby
                  </CardTitle>
                  <CardDescription className="text-lg">
                    Bet Amount: {lobbyData.bet_amount} tokens
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Current room participants */}
                    <div>
                      <h3 className="text-white font-semibold mb-3 text-center">Players in Room:</h3>
                      {/* Debug info */}
                      {console.log('Lobby - lobbyData:', lobbyData)}
                      {console.log('Lobby - roomParticipants:', roomParticipants)}
                      {console.log('Lobby - Current room players:', roomParticipants[lobbyData?.room_type])}
                      <div className="space-y-3" key={`lobby-${lobbyData.room_type}-${roomParticipants[lobbyData.room_type]?.length || 0}`}>
                        {roomParticipants[lobbyData.room_type]?.length > 0 ? (
                          roomParticipants[lobbyData.room_type].map((player, index) => (
                            <div key={`player-${player.user_id}-${index}`} className="flex items-center gap-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                              {/* Profile Picture */}
                              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600 flex items-center justify-center text-slate-900 font-bold text-xl flex-shrink-0">
                                {player.photo_url ? (
                                  <img src={player.photo_url} alt={player.first_name} className="w-12 h-12 rounded-full" />
                                ) : (
                                  player.first_name?.charAt(0).toUpperCase()
                                )}
                              </div>
                              
                              {/* Player Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-white font-semibold truncate">
                                    {player.first_name} {player.last_name || ''}
                                  </p>
                                  {player.user_id === user?.id && (
                                    <Badge className="bg-green-500 text-black text-xs">You</Badge>
                                  )}
                                </div>
                                {player.username && (
                                  <p className="text-slate-400 text-sm">@{player.username}</p>
                                )}
                                <p className="text-yellow-400 text-sm font-medium">Bet: {player.bet_amount} tokens</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-4">
                            <p className="text-slate-400">Loading players...</p>
                          </div>
                        )}
                        
                        {/* Show waiting slot if only 1 player */}
                        {roomParticipants[lobbyData.room_type]?.length === 1 && (
                          <div className="flex items-center gap-4 p-4 bg-slate-700/30 rounded-lg border border-dashed border-slate-600">
                            <div className="w-12 h-12 rounded-full bg-slate-600 flex items-center justify-center text-slate-400 text-2xl flex-shrink-0">
                              ?
                            </div>
                            <div className="flex-1">
                              <p className="text-slate-400 font-semibold">Waiting for opponent...</p>
                              <p className="text-slate-500 text-sm">The game will start automatically when another player joins</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status Message */}
                    <div className="text-center">
                      {roomParticipants[lobbyData.room_type]?.length < 3 ? (
                        <div className="py-4">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mb-2"></div>
                          <p className="text-yellow-400 font-semibold">Waiting for {3 - (roomParticipants[lobbyData.room_type]?.length || 0)} more player{3 - (roomParticipants[lobbyData.room_type]?.length || 0) === 1 ? '' : 's'}...</p>
                          <p className="text-slate-400 text-sm mt-1">Stay on this screen</p>
                        </div>
                      ) : (
                        <div className="py-4">
                          <p className="text-green-400 font-semibold text-lg">✓ Room Full! Game starting soon...</p>
                        </div>
                      )}
                    </div>

                    {/* Leave Room Button */}
                    <div className="text-center pt-2">
                      <Button 
                        onClick={() => {
                          setInLobby(false);
                          setLobbyData(null);
                          toast.info('Left the lobby');
                          loadRooms();
                        }}
                        variant="outline"
                        className="border-red-500 text-red-500 hover:bg-red-500/10"
                      >
                        Leave Lobby
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Battle Rooms Tab */}
            {activeTab === 'rooms' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <div className={isMobile ? 'space-y-4' : 'space-y-6'}>
                {isMobile ? (
                  <div className="text-center py-2 px-2">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-base font-bold text-white flex-1 text-center">Casino Rooms</h2>
                      <Button
                        onClick={() => {
                          loadRooms();
                          toast.success('Rooms refreshed!');
                        }}
                        size="sm"
                        className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 text-xs"
                      >
                        🔄 Refresh
                      </Button>
                    </div>
                    <p className="text-xs text-slate-400">
                      3 players • Higher bet = better odds
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full mb-3">
                      <Users className="w-8 h-8 text-slate-900" />
                    </div>
                    <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
                      Choose Your Battle Arena
                    </h2>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                      Join one of our three exclusive rooms where 3 players battle for the prize!
                      <br />
                      <span className="text-yellow-400 font-medium">Higher bet = Better winning odds!</span>
                    </p>
                    <div className="mt-4">
                      <Button
                        onClick={() => {
                          loadRooms();
                          toast.success('Rooms refreshed!');
                        }}
                        className="bg-blue-500 hover:bg-blue-600 text-white"
                      >
                        🔄 Refresh Rooms
                      </Button>
                    </div>
                  </div>
                )}

                {/* Welcome Bonus Banner */}
                {welcomeBonusStatus && welcomeBonusStatus.bonus_active && (
                  <div className="mb-6 max-w-4xl mx-auto">
                    <div className="bg-gradient-to-r from-green-600/20 to-emerald-600/20 border-2 border-green-500/40 rounded-lg p-4 text-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-green-400/10 to-emerald-400/10 animate-pulse"></div>
                      <div className="relative z-10">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <span className="text-2xl">🎁</span>
                          <h3 className="text-xl font-bold text-green-400">Welcome Bonus Active!</h3>
                          <span className="text-2xl">🎁</span>
                        </div>
                        <p className="text-white font-medium mb-2">
                          First 100 players get <span className="text-yellow-400 font-bold">1000 FREE TOKENS!</span>
                        </p>
                        <p className="text-green-300 text-sm">
                          ⏰ Only <span className="font-bold text-yellow-400">{welcomeBonusStatus.remaining_spots}</span> spots remaining!
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className={`grid gap-3 w-full ${isMobile ? 'grid-cols-1 px-1' : 'lg:grid-cols-3 md:grid-cols-2 grid-cols-1 max-w-7xl mx-auto'}`}>
                  {['bronze', 'silver', 'gold'].map((roomType) => {
                    const room = rooms.find(r => r.room_type === roomType) || { players_count: 0 };
                    const config = ROOM_CONFIGS[roomType];
                    
                    return (
                      <Card key={roomType} className="bg-slate-800/90 border-slate-700 overflow-hidden">
                        {isMobile ? (
                          // MOBILE: Compact card layout - fixed overflow
                          <div className="w-full max-w-full overflow-hidden">
                            <div className={`bg-gradient-to-r ${config.gradient} p-2`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-lg flex-shrink-0">{config.icon}</span>
                                  <div className="min-w-0 flex-1">
                                    <h3 className="text-white font-bold text-sm truncate">{config.name}</h3>
                                    <p className="text-white/80 text-xs truncate">{config.min}-{config.max}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Badge className={`text-xs px-2 py-0.5 flex-shrink-0 ${
                                    room.status === 'playing' || room.status === 'finished' ? 'bg-red-500 text-white animate-pulse' :
                                    room.players_count === 0 ? 'bg-slate-500 text-white' :
                                    room.players_count === 1 ? 'bg-yellow-500 text-black animate-pulse' :
                                    'bg-green-500 text-black'
                                  }`}>
                                    {room.status === 'playing' || room.status === 'finished' ? '🔒 FULL' :
                                     room.players_count === 0 ? '🎯 Empty' :
                                     room.players_count === 1 ? '🔥 Filling' :
                                     room.players_count === 2 ? '⏳ Nearly Ready' :
                                     '⚡ Ready'}
                                  </Badge>
                                  <span className="text-xs text-white/70">{room.players_count}/3</span>
                                </div>
                              </div>
                            </div>
                            <div className="p-2 space-y-2">
                              <Input
                                type="number"
                                placeholder={`${config.min}-${config.max}`}
                                value={selectedRoom === roomType ? betAmount : ''}
                                onChange={(e) => {
                                  console.log('📝 Bet amount changed:', e.target.value, 'for room:', roomType);
                                  setSelectedRoom(roomType);
                                  setBetAmount(e.target.value);
                                }}
                                className="bg-slate-700 border-slate-500 text-white text-center h-9 text-sm placeholder:text-slate-400 focus:border-yellow-400"
                              />
                              
                              <Button
                                onClick={async () => {
                                  console.log('🔘 MOBILE Join button clicked!', {
                                    roomType,
                                    betAmount,
                                    selectedRoom,
                                    userBalance: user?.token_balance,
                                    playersCount: room.players_count,
                                    roomStatus: room.status
                                  });
                                  await joinRoom(roomType);
                                  console.log('🔘 Join room function completed');
                                }}
                                disabled={room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount)}
                                className={`w-full h-9 text-white font-semibold text-sm ${
                                  (room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount))
                                    ? 'bg-slate-600 cursor-not-allowed' 
                                    : 'bg-green-600 hover:bg-green-700'
                                }`}
                              >
                                <Play className="w-3 h-3 mr-1" />
                                {room.status === 'playing' || room.status === 'finished' ? '🔒 FULL - Game in Progress' :
                                 room.players_count >= 3 ? 'Full' : 
                                 !betAmount ? 'Enter Bet' :
                                 parseInt(betAmount) < config.min || parseInt(betAmount) > config.max ? 'Invalid' :
                                 user.token_balance < parseInt(betAmount) ? 'Low Balance' : 'Join'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // DESKTOP: Full card layout
                          <>
                            <CardHeader className={`bg-gradient-to-br ${config.gradient} text-white relative overflow-hidden`}>
                              <div className="absolute inset-0 bg-black/10"></div>
                              <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                                      <span className="text-2xl">{config.icon}</span>
                                    </div>
                                    <div>
                                      <CardTitle className="text-xl font-bold leading-tight">
                                        {config.name}
                                      </CardTitle>
                                      <CardDescription className="text-white/90 font-medium leading-tight">
                                        {config.min} - {config.max} tokens
                                      </CardDescription>
                                    </div>
                                  </div>
                                  <Badge className="bg-white/20 text-white font-bold">
                                    {room.players_count}/3 players
                                  </Badge>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="p-4">
                              <div className="space-y-4">
                                {room.players_count === 0 && (
                                  <p className="text-slate-400 text-sm text-center">No players yet. Be the first to join!</p>
                                )}
                                {room.players_count === 1 && (
                                  <p className="text-yellow-400 text-sm text-center font-medium">1 player waiting. Join now!</p>
                                )}
                                {room.players_count >= 3 && (
                                  <p className="text-red-400 text-sm text-center font-medium">Room full - game in progress</p>
                                )}
                                
                                <div className="space-y-3">
                                  <Input
                                    type="number"
                                    placeholder={`Bet amount (${config.min}-${config.max})`}
                                    value={selectedRoom === roomType ? betAmount : ''}
                                    onChange={(e) => {
                                      setSelectedRoom(roomType);
                                      setBetAmount(e.target.value);
                                    }}
                                    min={config.min}
                                    max={config.max}
                                    className="bg-slate-700 border-slate-600 text-white"
                                  />
                                  
                                  <Button
                                    onClick={async () => {
                                      console.log('🖥️ DESKTOP Join button clicked!', {
                                        roomType,
                                        betAmount,
                                        selectedRoom,
                                        userBalance: user?.token_balance,
                                        playersCount: room.players_count,
                                        roomStatus: room.status
                                      });
                                      await joinRoom(roomType);
                                      console.log('🖥️ Join room function completed');
                                    }}
                                    disabled={room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount)}
                                    className={`w-full ${
                                      (room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount))
                                        ? 'bg-slate-600 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600'
                                    } text-white font-bold py-3`}
                                  >
                                    <Play className="w-4 h-4 mr-2" />
                                    {room.status === 'playing' || room.status === 'finished' ? '🔒 FULL - Game in Progress' :
                                     room.players_count >= 3 ? 'Room Full' : 
                                     !betAmount ? 'Enter Bet Amount' :
                                     parseInt(betAmount) < config.min || parseInt(betAmount) > config.max ? 'Invalid Amount' :
                                     user.token_balance < parseInt(betAmount) ? 'Insufficient Tokens' : 'Join Battle'}
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Token Purchase Tab */}
            {activeTab === 'tokens' && (
              isMobile ? (
                <div className="space-y-3 max-w-full">
                  <Card className="bg-slate-800/90 border-slate-700">
                    <CardContent className="p-3 text-center">
                      <h2 className="text-sm font-bold text-white mb-1">Current Balance</h2>
                      <div className="text-xl font-bold text-yellow-400">{user.token_balance || 0}</div>
                      <div className="text-xs text-slate-400">tokens</div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800/90 border-slate-700 max-w-full overflow-hidden">
                    <CardContent className="p-3">
                      <h3 className="text-center text-white font-semibold mb-2 text-sm">Send SOL Here</h3>
                      <div className="bg-slate-900 p-2 rounded-lg mb-2 overflow-hidden">
                        <code className="text-green-400 text-xs font-mono break-all block text-center leading-relaxed">
                          {casinoWalletAddress && casinoWalletAddress !== 'Loading...' ? casinoWalletAddress : 'Loading...'}
                        </code>
                      </div>
                      <div className="flex gap-2 mb-2">
                        <Button
                          onClick={() => {
                            navigator.clipboard.writeText(casinoWalletAddress);
                            toast.success('Address copied!');
                          }}
                          disabled={!casinoWalletAddress || casinoWalletAddress === 'Loading...'}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 text-sm"
                        >
                          📋 Copy
                        </Button>
                        <Button
                          onClick={() => {
                            toast.info('Send SOL to get tokens automatically!');
                          }}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 text-sm"
                        >
                          ℹ️ Help
                        </Button>
                      </div>
                      <div className="p-2 bg-green-500/10 border border-green-500/20 rounded text-center">
                        <p className="text-xs text-green-300 font-medium">
                          Auto Conversion Active
                        </p>
                        <p className="text-xs text-slate-400">
                          SOL → EUR → Tokens (1 EUR = 100 tokens)
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card className="bg-slate-800/90 border-slate-700">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-400">
                      <Coins className="w-5 h-5" />
                      Buy Casino Tokens
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      Send SOL to your personal address. Automatic conversion based on current SOL/EUR price
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="p-6 bg-gradient-to-r from-green-600/20 to-emerald-600/20 rounded-lg border border-green-500/30">
                      <h3 className="text-xl font-semibold text-white mb-4 text-center">Your Personal Solana Address</h3>
                      <div className="bg-slate-800 p-4 rounded-lg border border-slate-600">
                        <code className="text-green-400 font-mono text-lg break-all block text-center">
                          {casinoWalletAddress}
                        </code>
                      </div>
                      <div className="flex justify-center mt-4">
                        <Button
                          onClick={() => {
                            navigator.clipboard.writeText(casinoWalletAddress);
                            toast.success('Address copied!');
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2"
                        >
                          📋 Copy Address
                        </Button>
                      </div>
                      <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded text-center">
                        <p className="text-sm text-green-300 font-medium">
                          Send SOL to this address and receive tokens automatically!
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Conversion rate: Based on real-time SOL/EUR price • 1 EUR = 100 tokens
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-400">
                    <Timer className="w-5 h-5" />
                    Game History
                  </CardTitle>
                  <CardDescription>Recent completed games</CardDescription>
                </CardHeader>
                <CardContent>
                  {gameHistory.length === 0 ? (
                    <p className="text-center text-slate-400 py-8">No games completed yet. Start playing!</p>
                  ) : (
                    <div className="space-y-3">
                      {gameHistory.map((game, index) => (
                        <div key={index} className="p-4 bg-slate-700/50 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{ROOM_CONFIGS[game.room_type]?.icon}</span>
                              <span className="font-medium text-white capitalize">{game.room_type} Room</span>
                            </div>
                            <Badge className="bg-green-500 text-white">Completed</Badge>
                          </div>
                          <div className="text-sm text-slate-300 space-y-1">
                            <div>Winner: <span className="text-yellow-400 font-medium">{game.winner_name}</span></div>
                            <div>Prize Pool: <span className="text-green-400">{game.total_pot} tokens</span></div>
                            <div>Date: {new Date(game.completed_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation - BIGGER & BETTER */}
      {isMobile && (
        <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 z-50">
          <div className="flex justify-evenly items-center py-3 px-2 safe-area-inset-bottom max-w-md mx-auto">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex flex-col items-center p-3 rounded-xl transition-all duration-200 min-w-[100px] ${
                activeTab === 'rooms' 
                  ? 'text-yellow-400 bg-yellow-400/20 scale-105' 
                  : 'text-slate-300 active:bg-slate-700/50'
              }`}
            >
              <Users className="w-7 h-7 mb-1" />
              <span className="text-sm font-semibold">Rooms</span>
            </button>
            
            <button
              onClick={() => setActiveTab('tokens')}
              className={`flex flex-col items-center p-3 rounded-xl transition-all duration-200 min-w-[100px] ${
                activeTab === 'tokens' 
                  ? 'text-green-400 bg-green-400/20 scale-105' 
                  : 'text-slate-300 active:bg-slate-700/50'
              }`}
            >
              <Coins className="w-7 h-7 mb-1" />
              <span className="text-sm font-semibold">Tokens</span>
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center p-3 rounded-xl transition-all duration-200 min-w-[100px] ${
                activeTab === 'history' 
                  ? 'text-blue-400 bg-blue-400/20 scale-105' 
                  : 'text-slate-300 active:bg-slate-700/50'
              }`}
            >
              <Timer className="w-7 h-7 mb-1" />
              <span className="text-sm font-semibold">History</span>
            </button>
          </div>
        </nav>
      )}

      <Toaster richColors position={isMobile ? "top-center" : "top-right"} />
    </div>
  );
}

export default App;