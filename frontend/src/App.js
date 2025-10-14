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
import PaymentModal from './components/PaymentModal';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// App version for cache busting - NO SERVICE WORKER
const APP_VERSION = '8.0-WINNER-FIX-v5-20250114';

// Check and clear old version cache
const storedVersion = localStorage.getItem('app_version');
if (storedVersion !== APP_VERSION) {
  console.log(`🔄 Version changed from ${storedVersion} to ${APP_VERSION} - Clearing cache`);
  
  // Clear specific cached data that might be stale
  const keysToKeep = ['casino_last_eur_amount', 'casino_last_sol_eur_price'];
  const allKeys = Object.keys(localStorage);
  
  allKeys.forEach(key => {
    if (!keysToKeep.includes(key)) {
      localStorage.removeItem(key);
    }
  });
  
  // Set new version
  localStorage.setItem('app_version', APP_VERSION);
  
  // Force reload to clear any in-memory cache
  if (storedVersion) {
    console.log('🔄 Reloading page with new version...');
    window.location.reload(true);
  }
}

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

    // Immediately disable button and start countdown
    setClaiming(true);
    setCanClaim(false);
    setTimeLeft('23h 59m');
    
    try {
      const response = await axios.post(`${API}/claim-daily-tokens/${user.id}`);
      
      if (response.data.status === 'success') {
        toast.success(`🎁 ${response.data.message}`, { duration: 3000 });
        
        // Update parent component with new balance AND claim time
        onClaim(response.data.new_balance);
        
        // Keep button disabled and countdown visible
        // checkClaimStatus will be called on next user update
      } else {
        toast.error(response.data.message);
        // If failed, revert to claimable
        setCanClaim(true);
        setTimeLeft('');
      }
    } catch (error) {
      console.error('Bonus claim error:', error);
      if (error.response?.data?.message) {
        toast.error(error.response.data.message);
      } else if (error.response?.status === 404) {
        toast.error('User not found. Please log in again.');
      } else if (error.response?.status === 400) {
        toast.error('Already claimed today. Try again tomorrow!');
        // Keep disabled - already claimed
      } else {
        toast.error('Failed to claim tokens. Please try again.');
        // On network error, revert to claimable
        setCanClaim(true);
        setTimeLeft('');
      }
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
  const [winnerDisplayedForGame, setWinnerDisplayedForGame] = useState(() => {
    // Initialize from sessionStorage to persist across re-renders but not page reloads
    return sessionStorage.getItem('last_winner_game_id') || null;
  }); // Track which game ID we've shown winner for
  const [gameInProgress, setGameInProgress] = useState(false); // Track if game is running
  const [currentGameData, setCurrentGameData] = useState(null); // Store current game info
  
  // UI state
  const [activeTab, setActiveTab] = useState('rooms');
  const [isMobile, setIsMobile] = useState(false);
  const [casinoWalletAddress, setCasinoWalletAddress] = useState('Loading...');
  const [welcomeBonusStatus, setWelcomeBonusStatus] = useState(null);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);

  // Form state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmount, setBetAmount] = useState('');
  
  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTokenAmount, setPaymentTokenAmount] = useState(1000);
  const [paymentEurAmount, setPaymentEurAmount] = useState(null); // EUR amount for payment modal

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

  // Polling for lobby participants (only if in lobby)
  useEffect(() => {
    console.log(`🚪 inLobby changed: ${inLobby}`);
    console.log(`🚪 lobbyData:`, lobbyData);
    
    if (!inLobby || !lobbyData || !lobbyData.room_type) {
      console.log('⚠️ Polling NOT started - inLobby:', inLobby, 'lobbyData:', lobbyData);
      return;
    }

    let pollCount = 0;

    const fetchParticipants = async () => {
      pollCount++;
      console.log(`🔄 Poll #${pollCount} - Fetching participants for ${lobbyData.room_type}...`);
      
      try {
        const response = await axios.get(`${API}/room-participants/${lobbyData.room_type}`);
        const players = response.data.players || [];
        
        console.log(`👥 Found ${players.length} players in ${lobbyData.room_type}:`, players);
        
        setRoomParticipants(prev => {
          const updated = { ...prev, [lobbyData.room_type]: players };
          console.log('🔄 Updated roomParticipants:', updated);
          return updated;
        });
        
        // React will automatically re-render when state changes
        if (players.length >= 3) {
          console.log('🎉 3 PLAYERS FOUND! Starting winner detection cycle...');
          
          // Show "Game Starting" message
          toast.success(`🎰 Room Full! Game starting...`, { duration: 3000 });
          
          // Socket event 'game_finished' will handle winner display - no need for polling
          console.log('🚀 Waiting for game_finished socket event from server...');
        }
        
      } catch (error) {
        console.error('Error fetching participants:', error);
        // Don't show error toast for every poll failure, just log it
        if (pollCount === 1) {
          // Only show error on first failure
          toast.error('Failed to load players. Retrying...');
        }
      }
    };

    // Fetch immediately
    fetchParticipants();
    
    // Then poll every 2000ms (reasonable for lobby updates)
    const pollInterval = setInterval(fetchParticipants, 2000);

    return () => {
      console.log('🧹 Cleaning up lobby polling');
      clearInterval(pollInterval);
    };
  }, [inLobby, lobbyData]);

  // Global winner detection for ALL users (even if not in lobby)
  useEffect(() => {
    let globalWinnerCheckInterval;
    
    // Only start global checking if user is authenticated
    if (user && user.telegram_id) {
      console.log('🌐 Starting global winner detection for user:', user.first_name);
      
      const checkForGlobalWinners = async () => {
        try {
          // Check for very recent completed games (last 30 seconds for better coverage)
          const response = await axios.get(`${API}/game-history?limit=10`);
          const games = response.data.games;
          
          console.log(`🔍 Global winner check - Found ${games.length} recent games for ${user.first_name}`);
          
          const veryRecentGame = games.find(game => 
            game.status === 'finished' &&
            new Date(game.finished_at) > new Date(Date.now() - 30000) // Last 30 seconds (increased)
          );
          
          if (veryRecentGame) {
            console.log('⏰ Recent completed game found:', {
              gameId: veryRecentGame.id,
              finishedAt: veryRecentGame.finished_at,
              secondsAgo: (Date.now() - new Date(veryRecentGame.finished_at)) / 1000,
              showWinnerScreen: showWinnerScreen
            });
            
            if (!showWinnerScreen) {
              console.log('🌟 GLOBAL WINNER DETECTED! Checking participation...');
              
              // Check if current user was in this game
              const userWasInGame = veryRecentGame.players?.some(p => {
                const match = p.telegram_id === user.telegram_id || p.user_id === user.id;
                console.log(`🔍 Checking player ${p.first_name} (telegram_id: ${p.telegram_id}, user_id: ${p.user_id}) vs current user (telegram_id: ${user.telegram_id}, id: ${user.id}): ${match}`);
                return match;
              });
              
              console.log(`👥 User participation check: ${userWasInGame ? 'PARTICIPATED' : 'NOT PARTICIPATED'}`);
              
              if (userWasInGame) {
                console.log('🎯 Current user participated in this game! Showing winner screen on ALL devices...');
                await broadcastWinnerToAllPlayers(veryRecentGame, veryRecentGame.room_type);
              } else {
                console.log('ℹ️ User was not in this game, skipping winner screen');
              }
            } else {
              console.log('ℹ️ Winner screen already showing, skipping...');
            }
          } else {
            console.log('⏳ No recent completed games found (last 30 seconds)');
          }
          
        } catch (error) {
          console.error('Global winner check error:', error);
        }
      };
      
      // Check every 2 seconds for global winners
      globalWinnerCheckInterval = setInterval(checkForGlobalWinners, 2000);
    }
    
    return () => {
      if (globalWinnerCheckInterval) {
        console.log('🧹 Cleaning up global winner detection');
        clearInterval(globalWinnerCheckInterval);
      }
    };
  }, [user, showWinnerScreen]);

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
  // Service Worker completely disabled - no SW listener needed
  // Cache clearing handled in index.html

  // Monitor room participants changes for debugging
  useEffect(() => {
    if (inLobby && lobbyData) {
      const currentRoomPlayers = roomParticipants[lobbyData.room_type] || [];
      console.log(`📊 [Room Monitor] ${lobbyData.room_type} room has ${currentRoomPlayers.length}/3 players`);
      console.log('📊 [Room Monitor] Players:', currentRoomPlayers.map(p => p.username).join(', '));
      
      if (currentRoomPlayers.length === 3) {
        console.log('✅ [Room Monitor] ROOM IS FULL - Should show GET READY animation');
      }
    }
  }, [roomParticipants, inLobby, lobbyData])

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
      console.log('Room type:', data.room_type);
      console.log('Players count:', data.all_players?.length);
      
      // Update room participants - this will trigger lobby re-render
      setRoomParticipants(prev => {
        const updated = {
          ...prev,
          [data.room_type]: data.all_players || []
        };
        console.log('🔄 Updated roomParticipants:', updated);
        console.log(`🎯 Room ${data.room_type} now has ${data.all_players?.length || 0}/3 players`);
        
        // Force component re-render by creating new object
        return {...updated};
      });
      
      // If room is now full, show special notification
      if (data.all_players?.length === 3) {
        console.log('🚀 ROOM IS FULL! Showing explosive animation...');
        toast.success('🚀 ROOM IS FULL! GET READY!', {
          duration: 3000,
          style: { 
            background: 'linear-gradient(to right, #22c55e, #10b981)',
            color: 'white',
            fontSize: '18px',
            fontWeight: 'bold'
          }
        });
      }
      
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
      
      // PREVENT DUPLICATE: Check if we already showed winner for this game
      const gameId = data.game_id || data.id || `${data.room_type}-${Date.now()}`;
      const lastDisplayedId = sessionStorage.getItem('last_winner_game_id');
      
      if (winnerDisplayedForGame === gameId || lastDisplayedId === gameId) {
        console.log('⏭️ Winner already displayed for game:', gameId, '- SKIPPING');
        return;
      }
      
      // Additional time-based check: ignore old game results (> 2 minutes old)
      if (data.finished_at) {
        const gameAge = Date.now() - new Date(data.finished_at).getTime();
        if (gameAge > 120000) { // 2 minutes
          console.log('⏭️ Game result too old:', gameAge/1000, 'seconds - SKIPPING');
          return;
        }
      }
      
      const winnerName = data.winner_name || `${data.winner?.first_name} ${data.winner?.last_name || ''}`.trim();
      const gameTime = new Date().toLocaleTimeString();
      
      // Check if current user is the winner - ROBUST CHECK
      const isWinner = user && (
        String(user.id) === String(data.winner_id) ||
        String(user.id) === String(data.winner?.user_id) ||
        String(user.telegram_id) === String(data.winner?.telegram_id)
      );
      console.log('🤔 Am I the winner?', isWinner, {
        user_id: user?.id,
        winner_id: data.winner_id,
        winner_user_id: data.winner?.user_id
      });
      
      // FORCE CLOSE ALL OTHER SCREENS
      setGameInProgress(false);
      setCurrentGameData(null);
      setInLobby(false);
      setLobbyData(null);
      setActiveRoom(null);
      
      // Prepare winner data with ALL needed fields
      const winnerInfo = {
        winner: data.winner, // Full winner object with user_id
        winner_name: winnerName,
        winner_id: data.winner_id,
        winner_user_id: data.winner?.user_id,
        winner_telegram_id: data.winner?.telegram_id,
        winner_photo: data.winner?.photo_url || '',
        winner_username: data.winner?.username || '',
        room_type: data.room_type,
        prize_pool: data.prize_pool,
        prize_link: data.prize_link,
        is_winner: isWinner,
        game_time: gameTime,
        game_id: gameId
      };
      
      // Set winner screen state and persist to sessionStorage
      setWinnerData(winnerInfo);
      setShowWinnerScreen(true);
      setWinnerDisplayedForGame(gameId);
      sessionStorage.setItem('last_winner_game_id', gameId);
      console.log('✅ Winner screen displayed for game:', gameId, '(stored in sessionStorage)');
      
      // Toast notification for everyone (no token amounts)
      if (isWinner) {
        toast.success(`🎉 Congratulations, You Won!`, {
          duration: 5000,
          style: { background: '#22c55e', color: 'white', fontSize: '18px', fontWeight: 'bold' }
        });
      } else {
        toast.info(`🏆 ${winnerName} won the game!`, {
          duration: 5000,
          style: { background: '#3b82f6', color: 'white', fontSize: '16px' }
        });
      }
      
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
    // Initialize Telegram Web App early
    if (window.Telegram && window.Telegram.WebApp) {
      console.log('🔄 Initializing Telegram Web App...');
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
    
    // Check for saved user session first
    const savedUser = localStorage.getItem('casino_user');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        console.log('✅ Found saved user session:', userData);
        
        // CRITICAL FIX: If user ID is null/undefined, force re-auth
        if (!userData.id || userData.id === 'null' || userData.id === 'undefined') {
          console.warn('⚠️ Invalid user ID in cache - forcing re-authentication');
          localStorage.removeItem('casino_user');
          authenticateFromTelegram();
          return;
        }
        
        // Set cached user first for instant UI
        setUser(userData);
        
        // Load fresh data
        loadRooms();
        loadGameHistory();
        loadUserPrizes();
        
        // IMMEDIATELY refresh from server to get latest balance and verify session (async)
        (async () => {
          try {
            const response = await axios.get(`${API}/user/${userData.id}`);
            if (response.data) {
              console.log('✅ Session verified. Refreshed user data:', response.data);
              setUser(response.data);
              saveUserSession(response.data);
              toast.success(`Welcome back, ${response.data.first_name}!`);
            }
          } catch (refreshError) {
            console.error('❌ Session validation failed:', refreshError);
            // If session is invalid, clear it and try Telegram auth
            localStorage.removeItem('casino_user');
            toast.warning('Session expired. Please log in again.');
            authenticateFromTelegram();
          }
        })();
        
        setIsLoading(false);
        return;
      } catch (e) {
        console.error('Failed to parse saved user:', e);
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
          
          // If still no user, throw error to trigger fallback
          if (!telegramUser || !telegramUser.id) {
            console.warn('⚠️ NO TELEGRAM USER DATA AVAILABLE - Will use fallback');
            console.log('WebApp.initData:', webApp.initData);
            console.log('WebApp.initDataUnsafe:', webApp.initDataUnsafe);
            throw new Error('No Telegram user data - using fallback authentication');
          }
        }
        
        console.log('Final telegramUser:', telegramUser);
        
        // Prepare authentication data with proper validation
        const authData = {
          id: parseInt(telegramUser.id),
          first_name: telegramUser.first_name || 'Telegram User',
          last_name: telegramUser.last_name || '',
          username: telegramUser.username || '',
          photo_url: telegramUser.photo_url || '',
          auth_date: Math.floor(Date.now() / 1000),
          hash: webApp.initData || 'telegram_webapp',
          telegram_id: parseInt(telegramUser.id)
        };

        console.log('📤 Sending authentication data to backend:', authData);
        
        // Call API with user data
        const response = await axios.post(`${API}/auth/telegram`, {
          telegram_auth_data: authData
        }, {
          timeout: 10000, // 10 second timeout
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.data) {
          console.log('✅ Telegram authentication successful:', response.data);
          setUser(response.data);
          saveUserSession(response.data);
          setIsLoading(false);
          
          // Welcome message based on balance
          if (response.data.token_balance >= 1000) {
            toast.success(`🎉 Welcome back, ${response.data.first_name}! Balance: ${response.data.token_balance} tokens`);
          } else if (response.data.token_balance > 0) {
            toast.success(`Welcome, ${response.data.first_name}! Balance: ${response.data.token_balance} tokens`);
          } else {
            toast.success(`👋 Welcome, ${response.data.first_name}! Claim your daily tokens to get started.`);
          }
          
          // Configure WebApp
          webApp.enableClosingConfirmation();
          if (webApp.setHeaderColor) webApp.setHeaderColor('#1e293b');
          if (webApp.setBackgroundColor) webApp.setBackgroundColor('#0f172a');
          
          // Load additional data after successful auth
          setTimeout(() => {
            loadUserPrizes();
            loadDerivedWallet();
            loadWelcomeBonusStatus();
          }, 500);
          
          return; // Exit successfully
        }
        
      } catch (error) {
        console.error('❌ Telegram authentication failed:', error);
        console.error('Error details:', {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data
        });
        
        // Show user-friendly error message
        if (error.response?.status === 401) {
          toast.error('Invalid credentials. Please try again.');
        } else if (error.response?.status === 500) {
          toast.error('Server error. Please try again later.');
        } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          toast.error('Network timeout. Please check your connection.');
        } else if (error.message.includes('Network Error')) {
          toast.error('Cannot reach server. Please check your internet connection.');
        } else {
          toast.error('Authentication failed. Creating account...');
        }
        
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
              toast.error('Account not found. Creating new account...');
            }
          }
        }
        
        // If all else fails, fallback will handle user creation
        console.log('⚠️ Auth failed - fallback will create user in 2 seconds...');
        // Note: isLoading stays true so fallback can detect and handle it
      }
    };

    // Start authentication immediately
    const authTimeout = setTimeout(authenticateFromTelegram, 100);
    
    // Fallback timeout - ALWAYS ensures loading completes (reduced to 3s for better UX)
    const fallbackTimeout = setTimeout(async () => {
      console.log(`⏰ Fallback timeout triggered! user=${user ? 'exists' : 'null'}, isLoading=${isLoading}`);
      
      // If user already exists, just stop loading
      if (user) {
        console.log('✅ User already exists - just stopping loading state');
        setIsLoading(false);
        return;
      }
      
      // No user found - create one
      console.log('✅ No user found - activating fallback mechanism...');
        
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
      // Always ensure loading is stopped
      setIsLoading(false);
    }, 3000); // 3 seconds - gives real auth time to complete, but not too long
    
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
  const loadRooms = async (showError = false) => {
    try {
      const response = await axios.get(`${API}/rooms`);
      setRooms(response.data.rooms);
    } catch (error) {
      console.error('Failed to load rooms:', error);
      // Only show error toast if explicitly requested (not on initial load)
      if (showError) {
        toast.error('Failed to load rooms. Please refresh.');
      }
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

  // Enhanced winner detection system for ALL players in room
  const startWinnerDetection = (roomType) => {
    let attempts = 0;
    const maxAttempts = 30; // Check for 30 seconds max
    
    console.log(`🔍 Starting synchronized winner detection for ${roomType} room`);
    
    const checkForWinner = async () => {
      attempts++;
      console.log(`🔍 Winner detection attempt ${attempts}/${maxAttempts} for ${roomType}`);
      
      try {
        // Check game history for recent completed games of this room type
        const response = await axios.get(`${API}/game-history?limit=15`);
        const games = response.data.games;
        
        // Look for ANY recent completed game of this room type (within last 60 seconds)
        const recentGame = games.find(game => 
          game.room_type === roomType && 
          game.status === 'finished' &&
          new Date(game.finished_at) > new Date(Date.now() - 60000) // Within last 60 seconds
        );
        
        if (recentGame && recentGame.winner) {
          console.log('🏆 WINNER FOUND FOR ALL PLAYERS!', recentGame.winner);
          
          // BROADCAST WINNER TO ALL PLAYERS IN THIS ROOM
          await broadcastWinnerToAllPlayers(recentGame, roomType);
          
          return true; // Winner found, stop checking
        }
        
        // Continue checking if no winner yet and under max attempts
        if (attempts < maxAttempts) {
          console.log(`⏳ No winner yet, checking again in 800ms... (${attempts}/${maxAttempts})`);
          setTimeout(checkForWinner, 800);
        } else {
          console.log('❌ Winner detection timeout - no winner found after 30 attempts');
          
          // Force manual check as fallback
          toast.error('Game taking longer than expected. Use "Force Check Winner" button.', { 
            duration: 10000 
          });
        }
        
      } catch (error) {
        console.error('❌ Error in winner detection:', error);
        
        // Retry on error if under max attempts
        if (attempts < maxAttempts) {
          setTimeout(checkForWinner, 1000);
        }
      }
      
      return false;
    };
    
    // Start checking after 2 second delay (give backend time to process)
    setTimeout(checkForWinner, 2000);
  };

  // Broadcast winner result to ALL players (works on mobile AND desktop)
  const broadcastWinnerToAllPlayers = async (gameResult, roomType) => {
    console.log('📢 BROADCASTING WINNER TO ALL PLAYERS (Mobile & Desktop):', gameResult.winner);
    console.log('🖥️ Device Info:', { isMobile, userAgent: navigator.userAgent });
    
    const winnerName = `${gameResult.winner.first_name} ${gameResult.winner.last_name || ''}`.trim();
    
    // PREVENT DUPLICATE: Check if we already showed winner for this game
    const gameId = gameResult.id;
    if (winnerDisplayedForGame === gameId) {
      console.log('⏭️ Winner already displayed for game:', gameId);
      return;
    }
    
    // Force exit ALL states for consistent experience across devices
    console.log('🔄 Setting winner screen state - Before:', { inLobby, gameInProgress, showWinnerScreen });
    
    setInLobby(false);
    setGameInProgress(false);
    setShowWinnerScreen(true);
    setWinnerDisplayedForGame(gameId); // Mark this game as displayed
    
    // Set comprehensive winner data with Telegram info
    const winnerDisplayData = {
      winner: gameResult.winner,
      winner_name: winnerName,
      winner_username: gameResult.winner.username || gameResult.winner.telegram_username,
      winner_photo: gameResult.winner.photo_url,
      room_type: roomType,
      prize_pool: gameResult.prize_pool,
      prize_link: gameResult.prize_link,
      game_id: gameResult.id,
      finished_at: gameResult.finished_at,
      all_players: gameResult.players || []
    };
    
    setWinnerData(winnerDisplayData);
    
    console.log('✅ Winner data set for game:', gameId, winnerDisplayData);
    console.log('🔄 Setting winner screen state - After:', { 
      inLobby: false, 
      gameInProgress: false, 
      showWinnerScreen: true 
    });
    
    // Show synchronized winner announcement to ALL players (mobile & desktop)
    toast.success(`🏆 GAME COMPLETE! Winner: ${winnerName}`, { 
      duration: 10000,
      style: {
        background: 'linear-gradient(45deg, #10b981, #059669)',
        color: 'white',
        fontSize: '16px',
        fontWeight: 'bold',
        border: '2px solid #fbbf24'
      }
    });
    
    console.log('🎉 Winner announcement displayed for ALL players (Mobile & Desktop)!');
    
    // Update user balance if current user is the winner
    if (user && gameResult.winner && 
        (user.telegram_id === gameResult.winner.telegram_id || user.id === gameResult.winner.id)) {
      console.log('🏆 Current user is the WINNER! Updating balance...');
      
      // Refresh user data to get updated balance
      setTimeout(async () => {
        try {
          const userResponse = await axios.get(`${API}/users/telegram/${user.telegram_id}`);
          if (userResponse.data) {
            setUser(userResponse.data);
            console.log('💰 Winner balance updated!');
          }
        } catch (error) {
          console.error('Failed to refresh winner balance:', error);
        }
      }, 1000);
    }
    
    // Force a re-render to ensure winner screen shows on all devices
    setTimeout(() => {
      console.log('🔄 Force checking winner screen state:', { showWinnerScreen: true });
    }, 100);
  };

  const checkForGameCompletion = async (roomType) => {
    try {
      console.log(`🔍 ONE-TIME check for ${roomType} game completion...`);
      
      // Get game history to find the latest finished game  
      const response = await axios.get(`${API}/game-history?limit=5`);
      const games = response.data.games;
      
      if (games.length > 0) {
        // Look for the most recent game of this room type
        const recentGame = games.find(game => game.room_type === roomType);
        
        if (recentGame && recentGame.status === 'finished') {
          const gameId = recentGame.id;
          
          // PREVENT DUPLICATE: Check if we already showed winner for this game
          if (winnerDisplayedForGame === gameId) {
            console.log('⏭️ Winner already displayed for game:', gameId);
            return true; // Already shown
          }
          
          console.log('🏆 FOUND FINISHED GAME! Showing winner:', recentGame.winner);
          
          // FORCE exit from lobby state
          setInLobby(false);
          setGameInProgress(false);
          setShowWinnerScreen(true);
          setWinnerDisplayedForGame(gameId); // Mark this game as displayed
          
          const winnerName = `${recentGame.winner.first_name} ${recentGame.winner.last_name || ''}`.trim();
          
          setWinnerData({
            winner: recentGame.winner,
            winner_name: winnerName,
            room_type: roomType,
            prize_pool: recentGame.total_pool,
            prize_link: recentGame.prize_link,
            game_id: gameId
          });
          
          // Show winner notification
          toast.success(`🏆 WINNER: ${winnerName}!`, { duration: 5000 });
          
          console.log('✅ Winner screen activated for game:', gameId);
          return true; // Winner found
        }
      }
      
      console.log('⏳ No finished game found');
      return false; // No winner yet
      
    } catch (error) {
      console.error('❌ Failed to check for game completion:', error);
      return false;
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

  const loadGameHistory = async (showLoading = false) => {
    try {
      if (showLoading) setIsRefreshingHistory(true);
      const response = await axios.get(`${API}/game-history?limit=10`);
      setGameHistory(response.data.games);
      if (showLoading) {
        toast.success('✅ History refreshed!', { duration: 2000 });
      }
    } catch (error) {
      console.error('Failed to load game history:', error);
      if (showLoading) {
        toast.error('Failed to refresh history');
      }
    } finally {
      if (showLoading) {
        setTimeout(() => setIsRefreshingHistory(false), 500);
      }
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

  // Listen for payment completion events to refresh user balance
  useEffect(() => {
    const handlePaymentCompleted = async () => {
      console.log('💰 Payment completed event received - refreshing user data...');
      if (user && user.id) {
        try {
          const response = await axios.get(`${API}/user/${user.id}`);
          if (response.data) {
            console.log('✅ User balance refreshed:', response.data.token_balance);
            setUser(response.data);
            saveUserSession(response.data);
            toast.success(`Balance updated: ${response.data.token_balance} tokens`);
          }
        } catch (error) {
          console.error('Failed to refresh user data:', error);
        }
      }
    };

    window.addEventListener('payment-completed', handlePaymentCompleted);
    
    return () => {
      window.removeEventListener('payment-completed', handlePaymentCompleted);
    };
  }, [user]);

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

            {/* 🏆 WINNER ANNOUNCEMENT SCREEN - Responsive & Scrollable */}
            {showWinnerScreen && winnerData && (
              <div className="winner-screen-overlay fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-y-auto overflow-x-hidden animate-fadeIn">
                {/* Animated Confetti Background */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(15)].map((_, i) => (
                    <div
                      key={i}
                      className={`absolute w-2 h-2 md:w-3 md:h-3 bg-gradient-to-r ${
                        i % 3 === 0 ? 'from-yellow-400 to-gold-500' : 
                        i % 3 === 1 ? 'from-purple-400 to-purple-600' : 
                        'from-green-400 to-emerald-500'
                      } rounded-full animate-confetti opacity-80`}
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `-${Math.random() * 20}%`,
                        animationDelay: `${Math.random() * 3}s`,
                        animationDuration: `${2 + Math.random() * 2}s`
                      }}
                    />
                  ))}
                </div>

                {/* Scrollable Container */}
                <div className="min-h-full flex items-center justify-center p-3 md:p-6 py-8">
                  <Card className="w-full max-w-[95vw] md:max-w-lg mx-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 border-2 border-gold-500 shadow-2xl shadow-gold-500/50 relative animate-slideUp my-4">
                    <CardContent className="p-4 md:p-8 text-center space-y-4 md:space-y-6">
                      {/* Close Button */}
                      <button
                        onClick={() => {
                          console.log('❌ Closing winner screen');
                          setShowWinnerScreen(false);
                          setWinnerData(null);
                          // Keep the game ID in sessionStorage to prevent re-display on reconnect
                          // It will be cleared on page reload
                          setActiveTab('rooms');
                          setInLobby(false);
                          setGameInProgress(false);
                        }}
                        className="absolute top-2 right-2 md:top-4 md:right-4 w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-slate-700/80 hover:bg-slate-600 text-white transition-colors z-10"
                        aria-label="Close"
                      >
                        ✕
                      </button>
                      
                      {/* 🏆 Winner Announcement Title - PERSONALIZED */}
                      <div className="space-y-3 md:space-y-4">
                        {(() => {
                          // FIXED: Use winner.user_id which exists in RoomPlayer model
                          const isCurrentUserWinner = winnerData.is_winner || (user && winnerData.winner && (
                            String(winnerData.winner.user_id) === String(user.id) ||
                            String(winnerData.winner_id) === String(user.id) ||
                            String(winnerData.winner_user_id) === String(user.id)
                          ));
                          
                          console.log('Winner screen check:', {
                            user_id: user?.id,
                            winner_user_id: winnerData.winner?.user_id,
                            winner_id: winnerData.winner_id,
                            is_winner_flag: winnerData.is_winner,
                            isCurrentUserWinner
                          });
                          
                          return isCurrentUserWinner;
                        })() ? (
                          <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-gradient-to-r from-yellow-400 via-gold-500 to-yellow-600 bg-clip-text animate-pulse">
                            🎉 Congratulations, You Won!
                          </h1>
                        ) : (
                          <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-gradient-to-r from-slate-400 via-slate-500 to-slate-600 bg-clip-text">
                            Better Luck Next Time!
                          </h1>
                        )}
                        
                        {/* Animated Trophy - Conditional */}
                        <div className="flex justify-center">
                          <div className="relative">
                            {(() => {
                              const isCurrentUserWinner = winnerData.is_winner || (user && winnerData.winner && (
                                String(winnerData.winner.user_id) === String(user.id) ||
                                String(winnerData.winner_id) === String(user.id) ||
                                String(winnerData.winner_user_id) === String(user.id)
                              ));
                              return isCurrentUserWinner;
                            })() ? (
                              <>
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-r from-yellow-400 to-gold-600 rounded-full flex items-center justify-center animate-bounce shadow-lg shadow-gold-500/50">
                                  <Trophy className="w-8 h-8 md:w-10 md:h-10 text-slate-900" />
                                </div>
                                <div className="absolute -inset-2 bg-gradient-to-r from-yellow-400/20 to-gold-600/20 rounded-full animate-ping"></div>
                              </>
                            ) : (
                              <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-r from-slate-600 to-slate-700 rounded-full flex items-center justify-center shadow-lg">
                                <Trophy className="w-8 h-8 md:w-10 md:h-10 text-slate-400" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Winner Display - PERSONALIZED */}
                      <div className="space-y-3 md:space-y-4">
                        {(() => {
                          const isCurrentUserWinner = winnerData.is_winner || (user && winnerData.winner && (
                            String(winnerData.winner.user_id) === String(user.id) ||
                            String(winnerData.winner_id) === String(user.id) ||
                            String(winnerData.winner_user_id) === String(user.id)
                          ));
                          return isCurrentUserWinner;
                        })() ? (
                          <h2 className="text-xl md:text-2xl font-bold text-green-400 animate-pulse px-2">
                            🎉 Congratulations, @{user.telegram_username || user.first_name}!
                          </h2>
                        ) : (
                          <h2 className="text-xl md:text-2xl font-bold text-slate-300 px-2">
                            🏆 The winner was @{winnerData.winner_username || winnerData.winner?.username || winnerData.winner_name}
                          </h2>
                        )}
                        
                        {/* Winner Photo with Enhanced Display */}
                        <div className="flex justify-center">
                          <div className="relative">
                            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border-4 border-gold-500 shadow-xl shadow-gold-500/50">
                              {winnerData.winner_photo || winnerData.winner?.photo_url ? (
                                <img 
                                  src={winnerData.winner_photo || winnerData.winner.photo_url} 
                                  alt={winnerData.winner_name} 
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    console.log('Photo failed to load, using fallback');
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'flex';
                                  }}
                                />
                              ) : null}
                              <div className="w-full h-full bg-gradient-to-r from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg md:text-xl" 
                                   style={{display: (winnerData.winner_photo || winnerData.winner?.photo_url) ? 'none' : 'flex'}}>
                                {(winnerData.winner_name || 'W').charAt(0).toUpperCase()}
                              </div>
                            </div>
                            <div className="absolute -inset-2 bg-gradient-to-r from-gold-400/30 to-yellow-500/30 rounded-full animate-pulse -z-10"></div>
                          </div>
                        </div>

                        {/* Winner Name Display */}
                        <div className="text-center px-2">
                          <p className="text-base md:text-lg font-semibold text-white">
                            {winnerData.winner_name}
                          </p>
                          {winnerData.winner_username && (
                            <p className="text-sm text-slate-300">
                              @{winnerData.winner_username}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Room Type Display */}
                      <div className="bg-gradient-to-r from-slate-800/80 to-slate-700/80 border border-slate-600/30 rounded-lg p-3 md:p-4 mx-2">
                        <p className="text-xs md:text-sm text-slate-400 text-center">
                          {ROOM_CONFIGS[winnerData.room_type]?.icon} {ROOM_CONFIGS[winnerData.room_type]?.name} Room
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 md:space-y-3 pt-2 md:pt-4 px-2">
                        {/* Play Again Button */}
                        <Button
                          onClick={() => {
                            console.log('🔄 Play Again clicked');
                            setShowWinnerScreen(false);
                            setWinnerData(null);
                            // Keep game ID to prevent re-display
                            setActiveTab('rooms');
                            setInLobby(false);
                            setGameInProgress(false);
                            loadRooms();
                            toast.success('🎮 Ready for another game!');
                          }}
                          className="w-full bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-700 hover:from-purple-700 hover:via-purple-800 hover:to-indigo-800 text-white font-bold text-base md:text-lg py-3 md:py-4 rounded-lg border border-purple-500/50 shadow-lg shadow-purple-500/25 transition-all duration-300 active:scale-95"
                        >
                          🎮 Play Again
                        </Button>
                        
                        {/* View Game History Button */}
                        <Button
                          onClick={() => {
                            console.log('📜 View History clicked');
                            setShowWinnerScreen(false);
                            setWinnerData(null);
                            // Keep game ID to prevent re-display
                            setActiveTab('history');
                            setInLobby(false);
                            setGameInProgress(false);
                            loadGameHistory();
                            toast.info('📊 Viewing game history');
                          }}
                          variant="outline"
                          className="w-full border-2 border-gold-500/50 bg-slate-800/50 hover:bg-gold-500/20 text-gold-400 hover:text-gold-300 font-semibold py-2 md:py-3 rounded-lg transition-all duration-300 active:scale-95"
                        >
                          📊 View Game History
                        </Button>
                      </div>

                      {/* Decorative Elements */}
                      <div className="flex justify-center space-x-1 md:space-x-2 pt-2">
                        {['🎉', '✨', '🏆', '✨', '🎉'].map((emoji, i) => (
                          <span 
                            key={i} 
                            className="text-xl md:text-2xl animate-bounce" 
                            style={{ animationDelay: `${i * 0.1}s` }}
                          >
                            {emoji}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
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
                              <p className="text-blue-400 text-sm font-medium">In Battle</p>
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
                                <p className="text-green-400 text-sm font-medium">Ready to play</p>
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

                    {/* Status Message - Dynamic based on player count */}
                    <div className="text-center">
                      {(() => {
                        const playerCount = roomParticipants[lobbyData.room_type]?.length || 0;
                        const playersNeeded = 3 - playerCount;
                        
                        if (playerCount < 3) {
                          // Waiting for more players
                          return (
                            <div className="py-4">
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mb-2"></div>
                              <p className="text-yellow-400 font-semibold text-lg">
                                Waiting for {playersNeeded} more player{playersNeeded === 1 ? '' : 's'}...
                              </p>
                              <p className="text-slate-400 text-sm mt-1">
                                {playerCount}/3 players ready
                              </p>
                              <p className="text-slate-500 text-xs mt-2">Stay on this screen</p>
                            </div>
                          );
                        } else {
                          // Room is full - EXPLOSIVE ANIMATION
                          return (
                            <div className="py-6 relative">
                              {/* Glow Effect */}
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-40 h-40 bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500 rounded-full opacity-20 animate-ping"></div>
                                <div className="w-32 h-32 bg-gradient-to-r from-green-400 to-emerald-600 rounded-full opacity-30 animate-pulse absolute"></div>
                              </div>
                              
                              {/* Main Content */}
                              <div className="relative z-10">
                                <div className="text-6xl mb-4 animate-bounce">🚀</div>
                                <div className="mb-4 space-y-2">
                                  <p className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-emerald-500 to-teal-400 animate-pulse">
                                    GET READY!
                                  </p>
                                  <p className="text-xl md:text-2xl font-bold text-white animate-pulse">
                                    THE GAME IS ABOUT TO BEGIN!
                                  </p>
                                </div>
                                
                                {/* Ready indicator */}
                                <div className="flex items-center justify-center gap-3 mt-6">
                                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                                  <p className="text-green-400 font-bold text-lg">
                                    All 3 Players Ready
                                  </p>
                                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                                </div>
                                
                                <p className="text-slate-400 text-sm mt-4 animate-pulse">
                                  Stay on this screen...
                                </p>
                              </div>
                            </div>
                          );
                        }
                      })()}
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
                  {/* Balance Card */}
                  <Card className="bg-gradient-to-r from-purple-900/50 to-purple-800/50 border-purple-500/30">
                    <CardContent className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <Wallet className="w-5 h-5 text-purple-400" />
                        <h2 className="text-sm font-bold text-white">Your Balance</h2>
                      </div>
                      <div className="text-3xl font-bold text-yellow-400">{user.token_balance || 0}</div>
                      <div className="text-xs text-slate-400">tokens</div>
                    </CardContent>
                  </Card>
                  
                  {/* Add Tokens Button */}
                  <Button
                    onClick={() => setShowPaymentModal(true)}
                    className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-4 text-lg rounded-xl shadow-lg transition-all duration-200"
                  >
                    <Zap className="w-5 h-5 mr-2" />
                    + Add Tokens
                  </Button>
                  <p className="text-xs text-green-400 text-center mt-2">
                    💰 Live on Solana Mainnet - Real SOL payments
                  </p>

                  {/* Quick Amount Buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {[500, 1000, 2000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => {
                          console.log(`🛒 Buy button clicked: ${amount} tokens (€${amount / 100})`);
                          // Telegram haptic feedback
                          if (window.Telegram?.WebApp?.HapticFeedback) {
                            window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
                          }
                          setShowPaymentModal(true);
                          setPaymentEurAmount(amount / 100);
                        }}
                        className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 active:scale-95"
                      >
                        <div className="text-xs">Buy</div>
                        <div className="text-sm">{amount}</div>
                        <div className="text-xs">€{(amount / 100).toFixed(1)}</div>
                      </button>
                    ))}
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 mt-2">
                    <p className="text-xs text-blue-400 text-center">
                      💰 Live on Solana Mainnet - Real SOL transactions
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 max-w-3xl mx-auto">
                  {/* Balance and Wallet Card */}
                  <Card className="bg-gradient-to-r from-purple-900/50 to-purple-800/50 border-purple-500/30">
                    <CardContent className="p-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-2 mb-2">
                            <Wallet className="w-6 h-6 text-purple-400" />
                            <h3 className="text-lg font-bold text-white">Your Balance</h3>
                          </div>
                          <div className="text-5xl font-bold text-yellow-400">{user.token_balance || 0}</div>
                          <div className="text-sm text-slate-400 mt-1">tokens</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Add Tokens Section */}
                  <Card className="bg-slate-800/90 border-slate-700">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-green-400">
                        <Zap className="w-5 h-5" />
                        Add Tokens
                      </CardTitle>
                      <CardDescription className="text-slate-400">
                        Purchase tokens using Solana (SOL) with instant conversion
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-4 gap-4 mb-6">
                        {[500, 1000, 2000, 5000].map(amount => (
                          <button
                            key={amount}
                            onClick={() => {
                              console.log(`🛒 Desktop Buy button clicked: ${amount} tokens (€${amount / 100})`);
                              setShowPaymentModal(true);
                              // Calculate EUR from tokens
                              setPaymentEurAmount(amount / 100);
                            }}
                            className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-6 rounded-xl shadow-lg transition-all duration-200 hover:scale-105"
                          >
                            <div className="text-sm">Buy</div>
                            <div className="text-2xl">{amount}</div>
                            <div className="text-xs">tokens</div>
                            <div className="text-sm mt-1">€{(amount / 100).toFixed(0)}</div>
                          </button>
                        ))}
                      </div>
                      
                      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
                        <h3 className="text-green-400 font-bold mb-2">💰 Live on Mainnet</h3>
                        <p className="text-sm text-green-300">
                          The app is now live on Solana Mainnet. All payments use real SOL and are processed on the live blockchain.
                        </p>
                      </div>
                      
                      <div className="flex gap-4">
                        <Input
                          type="number"
                          placeholder="Custom amount (min 100)"
                          min="100"
                          className="flex-1 bg-slate-900 border-slate-700 text-white"
                          onChange={(e) => setPaymentTokenAmount(parseInt(e.target.value) || 100)}
                        />
                        <Button
                          onClick={() => setShowPaymentModal(true)}
                          className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold px-8"
                        >
                          <Zap className="w-4 h-4 mr-2" />
                          Buy Now
                        </Button>
                      </div>

                      <div className="mt-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                        <h4 className="text-white font-semibold mb-2">How it works:</h4>
                        <ul className="text-sm text-slate-300 space-y-1">
                          <li>• Click a package or enter custom amount</li>
                          <li>• Get a unique payment address with 20-minute timer</li>
                          <li>• Send SOL to the provided address</li>
                          <li>• Tokens credited automatically within 1-2 minutes</li>
                          <li>• <span className="text-purple-400 font-semibold">1 EUR = 100 tokens</span> (live SOL/EUR rate)</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-blue-400">
                        <Timer className="w-5 h-5" />
                        Game History
                      </CardTitle>
                      <CardDescription>Recent completed games</CardDescription>
                    </div>
                    <button
                      onClick={() => loadGameHistory(true)}
                      disabled={isRefreshingHistory}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                        isRefreshingHistory 
                          ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white active:scale-95'
                      }`}
                    >
                      {isRefreshingHistory ? (
                        <>
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                          <span>Refreshing...</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg">🔄</span>
                          <span>Refresh</span>
                        </>
                      )}
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {gameHistory.length === 0 ? (
                    <p className="text-center text-slate-400 py-8">No games completed yet. Start playing!</p>
                  ) : (
                    <div className="space-y-3">
                      {gameHistory.map((game, index) => {
                        // FIXED: Correct winner detection using user_id from RoomPlayer
                        const isUserWinner = user && game.winner && (
                          String(game.winner.user_id) === String(user.id) ||
                          String(game.winner_id) === String(user.id) ||
                          String(game.winner_user_id) === String(user.id)
                        );
                        
                        console.log('History winner check:', {
                          user_id: user?.id,
                          winner_user_id: game.winner?.user_id,
                          winner_id: game.winner_id,
                          winner_user_id_field: game.winner_user_id,
                          isUserWinner
                        });
                        
                        return (
                          <div key={index} className={`p-4 rounded-lg ${
                            isUserWinner 
                              ? 'bg-gradient-to-r from-gold-900/30 to-yellow-900/30 border border-gold-500/30' 
                              : 'bg-slate-700/50 border border-slate-600/30'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{ROOM_CONFIGS[game.room_type]?.icon}</span>
                                <span className="font-medium text-white capitalize">{game.room_type} Room</span>
                              </div>
                              <Badge className={isUserWinner ? 'bg-gold-500 text-slate-900' : 'bg-slate-500 text-white'}>
                                {isUserWinner ? '🏆 Won' : 'Lost'}
                              </Badge>
                            </div>
                            <div className="text-sm text-slate-300 space-y-1">
                              {isUserWinner ? (
                                <div className="text-green-400 font-semibold">🎉 You won this game!</div>
                              ) : (
                                <>
                                  <div>Winner: <span className="text-yellow-400 font-medium">
                                    {game.winner?.first_name || 'Unknown'}
                                  </span></div>
                                  <div className="text-slate-500">You did not win this round</div>
                                </>
                              )}
                              <div>Date: {new Date(game.finished_at).toLocaleDateString()}</div>
                            </div>
                          </div>
                        );
                      })}
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
      
      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setPaymentEurAmount(null);
        }}
        userId={user?.id}
        tokenAmount={paymentTokenAmount}
        initialEurAmount={paymentEurAmount}
      />
    </div>
  );
}

export default App;