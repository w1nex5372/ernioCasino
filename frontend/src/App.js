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
  
  // UI state
  const [activeTab, setActiveTab] = useState('rooms');
  const [isMobile, setIsMobile] = useState(false);
  const [casinoWalletAddress, setCasinoWalletAddress] = useState('Loading...');

  // Form state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmount, setBetAmount] = useState('');

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
    const newSocket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      forceNew: true
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
      
      // Update room participants
      setRoomParticipants(prev => ({
        ...prev,
        [data.room_type]: data.all_players || []
      }));
      
      // Show notification
      toast.success(
        `🎯 ${data.player.first_name} joined ${data.room_type} room! (${data.players_count}/2)`,
        { duration: 3000 }
      );
      
      // Reload rooms to update counts
      loadRooms();
    });

    newSocket.on('game_starting', (data) => {
      console.log('🎮 Game starting:', data);
      toast.info(`🎮 Game starting in ${data.room_type} room!`);
      setActiveRoom(data);
    });

    newSocket.on('game_starting', (data) => {
      console.log('Game starting:', data);
      toast.info('Game starting! Good luck! 🎰');
      // Keep in lobby but show game is starting
    });

    newSocket.on('game_finished', (data) => {
      console.log('Game finished:', data);
      
      // Show winner screen to all players
      setWinnerData({
        winner_name: data.winner_name,
        winner_telegram_id: data.winner?.telegram_id || data.winner_telegram_id,
        winner_photo: data.winner?.photo_url || '',
        winner_username: data.winner?.username || '',
        room_type: data.room_type,
        prize_link: data.prize_link,
        is_winner: user && (user.telegram_id === data.winner?.telegram_id || user.id === data.winner_id)
      });
      setShowWinnerScreen(true);
      
      setActiveRoom(null);
      setInLobby(false);
      setLobbyData(null);
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

    newSocket.on('token_balance_updated', (data) => {
      if (user && data.user_id === user.id) {
        setUser({...user, token_balance: data.new_balance});
        toast.success(`🎉 Payment confirmed! +${data.tokens_added} tokens (${data.sol_received} SOL)`);
      }
    });

    return () => newSocket.close();
  }, []);

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
        
        // Last resort fallback
        setUser({
          id: 'fallback-' + Date.now(),
          first_name: telegramUser?.first_name || 'Player',
          last_name: telegramUser?.last_name || '',
          token_balance: 0,
          telegram_id: telegramUser?.id || Date.now(),
          username: telegramUser?.username || ''
        });
        setIsLoading(false);
        toast.warning('Using temporary account - your tokens may not be available');
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
    if (!user) {
      toast.error('Please authenticate first');
      return;
    }

    if (!betAmount || betAmount < ROOM_CONFIGS[roomType].min || betAmount > ROOM_CONFIGS[roomType].max) {
      toast.error(`Bet amount must be between ${ROOM_CONFIGS[roomType].min} - ${ROOM_CONFIGS[roomType].max} tokens`);
      return;
    }

    if (user.token_balance < betAmount) {
      toast.error('Insufficient tokens');
      return;
    }

    try {
      const response = await axios.post(`${API}/join-room`, {
        room_type: roomType,
        user_id: user.id,
        bet_amount: parseInt(betAmount)
      });

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
                <div className="flex items-center gap-1">
                  <Coins className="w-4 h-4 text-yellow-400" />
                  <span className="text-lg font-bold text-yellow-400">{user.token_balance || 0}</span>
                  <span className="text-slate-400">tokens</span>
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
              
              <button
                onClick={() => setActiveTab('prizes')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'prizes' 
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Trophy className="w-5 h-5" />
                <span>My Prizes</span>
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
                  <div className="flex items-center justify-center gap-2">
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

            {/* LOBBY SCREEN - Show when player is waiting in room */}
            {inLobby && lobbyData && (
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
                      <div className="space-y-3">
                        {roomParticipants[lobbyData.room_type]?.length > 0 ? (
                          roomParticipants[lobbyData.room_type].map((player, index) => (
                            <div key={index} className="flex items-center gap-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
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
                      {roomParticipants[lobbyData.room_type]?.length === 1 ? (
                        <div className="py-4">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mb-2"></div>
                          <p className="text-yellow-400 font-semibold">Waiting for opponent to join...</p>
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
            {activeTab === 'rooms' && !inLobby && (
              <div className={isMobile ? 'space-y-4' : 'space-y-6'}>
                {isMobile ? (
                  <div className="text-center py-2 px-2">
                    <h2 className="text-base font-bold text-white mb-1">Casino Rooms</h2>
                    <p className="text-xs text-slate-400">
                      2 players • Higher bet = better odds
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
                      Join one of our three exclusive rooms where 2 players battle for the prize!
                      <br />
                      <span className="text-yellow-400 font-medium">Higher bet = Better winning odds!</span>
                    </p>
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
                                    room.players_count === 0 ? 'bg-slate-500 text-white' :
                                    room.players_count === 1 ? 'bg-yellow-500 text-black animate-pulse' :
                                    'bg-green-500 text-black'
                                  }`}>
                                    {room.players_count === 0 ? '🎯 Empty' :
                                     room.players_count === 1 ? '🔥 Filling' :
                                     '⚡ Ready'}
                                  </Badge>
                                  <span className="text-xs text-white/70">{room.players_count}/2</span>
                                </div>
                              </div>
                            </div>
                            <div className="p-2 space-y-2">
                              {/* Room Participants Display */}
                              <div className="min-h-[40px]">
                                {roomParticipants[roomType] && roomParticipants[roomType].length > 0 ? (
                                  <div className="space-y-1">
                                    {roomParticipants[roomType].map((player, idx) => (
                                      <div key={idx} className="flex items-center gap-2 bg-slate-700/50 rounded p-1">
                                        <div className="w-5 h-5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-xs font-bold text-white">
                                          {player.first_name?.[0] || '?'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs text-white font-medium truncate">
                                            {player.username ? `@${player.username}` : player.first_name}
                                          </div>
                                        </div>
                                        <div className="text-xs text-yellow-400 font-bold">
                                          {player.bet_amount}
                                        </div>
                                      </div>
                                    ))}
                                    {roomParticipants[roomType].length === 1 && (
                                      <div className="flex items-center gap-2 bg-slate-600/30 rounded p-1 border-2 border-dashed border-slate-500">
                                        <div className="w-5 h-5 bg-slate-500 rounded-full flex items-center justify-center">
                                          <span className="text-xs">?</span>
                                        </div>
                                        <div className="text-xs text-slate-400 italic">Waiting for opponent...</div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center h-full">
                                    <p className="text-slate-400 text-xs">Empty room</p>
                                  </div>
                                )}
                              </div>
                              
                              <Input
                                type="number"
                                placeholder={`${config.min}-${config.max}`}
                                value={selectedRoom === roomType ? betAmount : ''}
                                onChange={(e) => {
                                  setSelectedRoom(roomType);
                                  setBetAmount(e.target.value);
                                }}
                                className="bg-slate-700 border-slate-500 text-white text-center h-9 text-sm placeholder:text-slate-400 focus:border-yellow-400"
                              />
                              
                              <Button
                                onClick={() => {
                                  console.log('Join button clicked!', {
                                    roomType,
                                    betAmount,
                                    userBalance: user.token_balance,
                                    playersCount: room.players_count
                                  });
                                  joinRoom(roomType);
                                }}
                                disabled={room.players_count >= 2 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount)}
                                className={`w-full h-9 text-white font-semibold text-sm ${
                                  (room.players_count >= 2 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount))
                                    ? 'bg-slate-600 cursor-not-allowed' 
                                    : 'bg-green-600 hover:bg-green-700'
                                }`}
                              >
                                <Play className="w-3 h-3 mr-1" />
                                {room.players_count >= 2 ? 'Full' : 
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
                                    {room.players_count}/2 players
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
                                {room.players_count >= 2 && (
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
                                    onClick={() => {
                                      console.log('Desktop join clicked!', {
                                        roomType,
                                        betAmount,
                                        userBalance: user.token_balance,
                                        playersCount: room.players_count
                                      });
                                      joinRoom(roomType);
                                    }}
                                    disabled={room.players_count >= 2 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount)}
                                    className={`w-full ${
                                      (room.players_count >= 2 || !betAmount || parseInt(betAmount) < config.min || parseInt(betAmount) > config.max || user.token_balance < parseInt(betAmount))
                                        ? 'bg-slate-600 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600'
                                    } text-white font-bold py-3`}
                                  >
                                    <Play className="w-4 h-4 mr-2" />
                                    {room.players_count >= 2 ? 'Room Full' : 
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

            {/* Prizes Tab */}
            {activeTab === 'prizes' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-purple-400">
                    <Trophy className="w-5 h-5" />
                    My Prizes
                  </CardTitle>
                  <CardDescription>Your won prizes and rewards</CardDescription>
                </CardHeader>
                <CardContent>
                  {userPrizes.length === 0 ? (
                    <div className="text-center py-8">
                      <Trophy className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                      <p className="text-slate-400 mb-4">No prizes won yet</p>
                      <Button onClick={() => setActiveTab('rooms')} className="bg-yellow-600 hover:bg-yellow-700">
                        Start Playing
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Show latest prize first */}
                      {[...userPrizes].reverse().map((prize, index) => (
                        <div key={index} className={`p-4 bg-gradient-to-r rounded-lg ${
                          index === 0 
                            ? 'from-yellow-600/30 to-orange-600/30 border-2 border-yellow-500/50' 
                            : 'from-purple-600/20 to-pink-600/20 border border-purple-500/30'
                        }`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{ROOM_CONFIGS[prize.room_type]?.icon}</span>
                              <span className="font-medium text-white capitalize">{prize.room_type} Room Win</span>
                            </div>
                            <Badge className={index === 0 ? "bg-yellow-500 text-black animate-pulse" : "bg-purple-500 text-white"}>
                              {index === 0 ? "Latest!" : "Won"}
                            </Badge>
                          </div>
                          <div className="text-sm text-slate-300 mb-3">
                            <div>Bet Amount: <span className="text-yellow-400">{prize.bet_amount} tokens</span></div>
                            <div>Won: {new Date(prize.timestamp).toLocaleDateString()}</div>
                          </div>
                          <Button
                            onClick={() => window.open(prize.prize_link, '_blank')}
                            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold"
                          >
                            🎁 Claim Prize
                          </Button>
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

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 z-50">
          <div className="flex justify-around items-center py-2 px-1 safe-area-inset-bottom">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex flex-col items-center p-1 rounded-lg transition-all duration-200 min-w-0 ${
                activeTab === 'rooms' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Users className="w-4 h-4 mb-0.5" />
              <span className="text-xs font-medium leading-tight">Rooms</span>
            </button>
            
            <button
              onClick={() => setActiveTab('tokens')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 min-w-0 ${
                activeTab === 'tokens' 
                  ? 'text-green-400 bg-green-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Coins className="w-4 h-4 mb-0.5" />
              <span className="text-xs font-medium leading-tight">Tokens</span>
            </button>
            
            <button
              onClick={() => setActiveTab('prizes')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 relative min-w-0 ${
                activeTab === 'prizes' 
                  ? 'text-purple-400 bg-purple-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Trophy className="w-4 h-4 mb-0.5" />
              <span className="text-xs font-medium leading-tight">Prizes</span>
              {userPrizes.length > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {userPrizes.length}
                </div>
              )}
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 min-w-0 ${
                activeTab === 'history' 
                  ? 'text-blue-400 bg-blue-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Timer className="w-4 h-4 mb-0.5" />
              <span className="text-xs font-medium leading-tight">History</span>
            </button>
          </div>
        </nav>
      )}

      <Toaster richColors position={isMobile ? "top-center" : "top-right"} />
    </div>
  );
}

export default App;