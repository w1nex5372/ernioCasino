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

// App version for cache busting - WITH SERVICE WORKER v9.1
const APP_VERSION = '9.1-WORK-FOR-CASINO-20250116120000';

// SIMPLIFIED VERSION CHECK - NO AUTO RELOAD
// Just update the version in storage, let service worker handle caching
const storedVersion = localStorage.getItem('app_version');
if (storedVersion !== APP_VERSION) {
  console.log(`📦 Version updated: ${storedVersion} → ${APP_VERSION}`);
  localStorage.setItem('app_version', APP_VERSION);
  
  // Clear other cached data (but keep important user data)
  const keysToKeep = ['casino_last_eur_amount', 'casino_last_sol_eur_price', 'app_version', 'casino_user'];
  const allKeys = Object.keys(localStorage);
  
  allKeys.forEach(key => {
    if (!keysToKeep.includes(key)) {
      localStorage.removeItem(key);
    }
  });
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
    min: 200,
    max: 450,
    gradient: 'from-amber-600 to-amber-800'
  },
  silver: {
    name: 'Silver Room',
    icon: '🥈',
    min: 350,
    max: 800,
    gradient: 'from-slate-400 to-slate-600'
  },
  gold: {
    name: 'Gold Room',
    icon: '🥇',
    min: 650,
    max: 1200,
    gradient: 'from-yellow-400 to-yellow-600'
  },
  platinum: {
    name: 'Platinum Room',
    icon: '💠',
    min: 1200,
    max: 2400,
    gradient: 'from-purple-400 to-purple-600'
  },
  diamond: {
    name: 'Diamond Room',
    icon: '💎',
    min: 2400,
    max: 4800,
    gradient: 'from-blue-400 to-blue-600'
  },
  elite: {
    name: 'Elite Room',
    icon: '👑',
    min: 4500,
    max: 8000,
    gradient: 'from-pink-500 to-red-600'
  }
};

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

// Roulette Wheel Component
function RouletteWheel({ players, winner, onComplete, currentUser }) {
  const canvasRef = React.useRef(null);
  const rotRef = React.useRef(0);
  const targetRotRef = React.useRef(null);
  const animatingRef = React.useRef(true);
  const rafRef = React.useRef(null);
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [displayRot, setDisplayRot] = React.useState(0);
  const [showResult, setShowResult] = React.useState(false);

  const COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];

  const playerData = React.useMemo(() => {
    if (!players || players.length === 0) return [];
    const totalBets = players.reduce((sum, p) => sum + (Number(p.bet_amount) || 1), 0);
    let cum = 0;
    return players.map((p, i) => {
      const bet = Number(p.bet_amount) || 1;
      const angleDeg = (bet / totalBets) * 360;
      const start = cum;
      cum += angleDeg;
      return { ...p, bet, pct: ((bet / totalBets) * 100).toFixed(1), angleDeg, startDeg: start, color: COLORS[i % COLORS.length] };
    });
  }, [players]);

  // Draw wheel segments once
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || playerData.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const cx = W / 2, cy = W / 2, R = W / 2 - 6;
    ctx.clearRect(0, 0, W, W);

    playerData.forEach(p => {
      const startRad = (p.startDeg * Math.PI) / 180;
      const endRad = ((p.startDeg + p.angleDeg) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, startRad, endRad);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = '#0f0f23';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (p.angleDeg > 18) {
        const midRad = startRad + (endRad - startRad) / 2;
        const lr = R * 0.64;
        ctx.save();
        ctx.translate(cx + lr * Math.cos(midRad), cy + lr * Math.sin(midRad));
        ctx.rotate(midRad + Math.PI / 2);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((p.first_name || 'P').substring(0, 8), 0, -6);
        ctx.font = '9px Arial';
        ctx.fillText(p.pct + '%', 0, 6);
        ctx.restore();
      }
    });

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Decorative inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, R - 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(124,58,237,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a3e';
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 3;
    ctx.stroke();
  }, [playerData]);

  // Set target rotation when winner arrives
  // Needle at CSS rotate(0) points UP = canvas 270°
  // To point at canvas angle midDeg: CSS rotation = midDeg + 90
  React.useEffect(() => {
    if (winner && targetRotRef.current === null && playerData.length > 0) {
      const idx = playerData.findIndex(p =>
        String(p.user_id) === String(winner.user_id) ||
        String(p.telegram_id) === String(winner.telegram_id)
      );
      const i = idx >= 0 ? idx : 0;
      const midDeg = playerData[i].startDeg + playerData[i].angleDeg / 2;
      const needleTargetMod = ((midDeg + 90) % 360 + 360) % 360;
      const currentMod = rotRef.current % 360;
      const delta = ((needleTargetMod - currentMod) + 360) % 360;
      targetRotRef.current = rotRef.current + 360 * 5 + (delta === 0 ? 360 : delta);
    }
  }, [winner, playerData]);

  // Safety fallback: if winner never arrives within 15s, call onComplete anyway
  React.useEffect(() => {
    const safeguard = setTimeout(() => {
      if (animatingRef.current) {
        animatingRef.current = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onCompleteRef.current();
      }
    }, 15000);
    return () => clearTimeout(safeguard);
  }, []);

  // Animation loop - runs once on mount, uses refs for callbacks
  React.useEffect(() => {
    animatingRef.current = true;
    const animate = () => {
      if (!animatingRef.current) return;
      if (targetRotRef.current !== null) {
        const remaining = targetRotRef.current - rotRef.current;
        if (remaining <= 0.3) {
          rotRef.current = targetRotRef.current;
          setDisplayRot(rotRef.current);
          animatingRef.current = false;
          setTimeout(() => {
            setShowResult(true);
            setTimeout(() => onCompleteRef.current(), 3500);
          }, 300);
          return;
        }
        const speed = Math.max(0.2, Math.min(8, remaining / 25));
        rotRef.current += speed;
      } else {
        rotRef.current += Math.min(8, rotRef.current < 720 ? rotRef.current / 90 + 1 : 8);
      }
      setDisplayRot(rotRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      animatingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const isUserWinner = winner && currentUser && (
    String(currentUser.id) === String(winner.user_id) ||
    String(currentUser.telegram_id) === String(winner.telegram_id)
  );

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)' }}>

      {/* Animated stars */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(25)].map((_, i) => (
          <div key={i} className="absolute w-1 h-1 bg-white rounded-full animate-pulse"
            style={{ left: `${(i * 37 + 11) % 100}%`, top: `${(i * 53 + 7) % 100}%`, opacity: 0.3 + (i % 5) * 0.1, animationDelay: `${i * 0.3}s` }} />
        ))}
      </div>

      {/* Title */}
      <h2 className="text-xl font-bold text-white mb-3 z-10 tracking-wider">
        {showResult ? '🏆 WINNER REVEALED!' : '🎰 SPINNING...'}
      </h2>

      {/* Wheel */}
      <div className="relative flex items-center justify-center z-10">
        {/* Static wheel */}
        <div style={{ borderRadius: '50%', boxShadow: '0 0 50px rgba(124,58,237,0.6), 0 0 20px rgba(124,58,237,0.3)' }}>
          <canvas ref={canvasRef} width={260} height={260} style={{ borderRadius: '50%', display: 'block' }} />
        </div>

        {/* Spinning needle — rotates around center */}
        <div className="absolute inset-0 pointer-events-none" style={{ width: 260, height: 260 }}>
          <div style={{
            position: 'absolute',
            bottom: '50%',
            left: '50%',
            marginLeft: '-4px',
            width: '8px',
            height: '108px',
            transformOrigin: 'bottom center',
            transform: `rotate(${displayRot}deg)`,
            borderRadius: '4px 4px 0 0',
            background: 'linear-gradient(to top, #7c3aed 0%, #a855f7 40%, #f59e0b 100%)',
            boxShadow: '0 0 14px rgba(168,85,247,0.9), 0 0 6px rgba(245,158,11,0.8)',
          }} />
        </div>

        {/* Center hub - does NOT rotate */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Outer glow ring */}
          <div style={{
            position: 'absolute',
            width: 56, height: 56,
            borderRadius: '50%',
            background: 'conic-gradient(from 0deg, #7c3aed, #a855f7, #f59e0b, #7c3aed)',
            animation: 'spin 3s linear infinite',
            zIndex: 9,
          }} />
          {/* Inner hub */}
          <div style={{
            width: 48, height: 48,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #2e1065, #1a1a3e)',
            border: '2px solid rgba(168,85,247,0.6)',
            boxShadow: '0 0 20px rgba(124,58,237,0.8), inset 0 0 10px rgba(0,0,0,0.5)',
            zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {showResult && winner?.photo_url ? (
              <img src={winner.photo_url} alt="winner" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                onError={e => { e.target.style.display = 'none'; }} />
            ) : showResult && winner ? (
              <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: 20 }}>{(winner.first_name || '?').charAt(0)}</span>
            ) : (
              <span style={{ fontSize: 20 }}>🎰</span>
            )}
          </div>
        </div>
      </div>

      {/* Result text */}
      <div className="mt-4 text-center z-10 px-6 min-h-[70px]">
        {showResult && winner ? (
          <div>
            <p className="text-2xl font-black text-yellow-400 animate-bounce">
              🏆 {winner.first_name} {winner.last_name || ''} 🏆
            </p>
            <p className={`mt-2 text-base font-semibold ${isUserWinner ? 'text-green-400' : 'text-slate-300'}`}>
              {isUserWinner ? '🎉 Congratulations! You Won!' : 'You lose this time... 🍀'}
            </p>
            {!isUserWinner && (
              <p className="text-slate-400 text-sm mt-1">Next time will be your time! Keep going!</p>
            )}
          </div>
        ) : (
          <p className="text-purple-300 text-sm animate-pulse mt-2">Determining the winner...</p>
        )}
      </div>

      {/* Players list */}
      <div className="mt-3 w-full max-w-xs px-4 z-10">
        <div className="bg-black/40 backdrop-blur rounded-xl p-3 border border-purple-500/20">
          <p className="text-purple-300 text-xs text-center mb-2 font-semibold tracking-wider">PLAYERS</p>
          {playerData.map((p, i) => (
            <div key={p.user_id || i} className="flex items-center gap-2 py-0.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
              <span className="text-white text-sm flex-1 truncate">
                {p.first_name} {p.last_name || ''}
                {currentUser && String(currentUser.id) === String(p.user_id) && (
                  <span className="text-blue-400 text-xs ml-1">(you)</span>
                )}
              </span>
              <span className="text-xs font-bold" style={{ color: p.color }}>{p.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  // Core state
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const userRef = React.useRef(null);
  const isLoadingRef = React.useRef(true);
  const authTimeoutRef = React.useRef(null);
  const fallbackTimeoutRef = React.useRef(null);

  const cancelAuthTimeout = () => {
    if (authTimeoutRef.current) {
      clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;
    }
  };

  const cancelFallbackTimeout = () => {
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
  };

  // Wrap setUser to always log telegram_id
  const setUserWithLog = (newUser) => {
    console.log('🔧 SET_USER CALLED:', {
      hasTelegramId: !!newUser?.telegram_id,
      telegram_id: newUser?.telegram_id,
      isAdmin: newUser?.telegram_id === 7983427898,
      caller: new Error().stack.split('\n')[2] // Show where it was called from
    });
    userRef.current = newUser;
    setUser(newUser);
  };
  
  // Use setUserWithLog everywhere instead of setUser
  const originalSetUser = setUser;
  React.useEffect(() => {
    // Override setUser globally
    window.__setUserDebug = setUserWithLog;
  }, []);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [telegramError, setTelegramError] = useState(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Data state
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomParticipants, setRoomParticipants] = useState({}); // Track participants per room
  const [gameHistory, setGameHistory] = useState([]);
  const [recentWinners, setRecentWinners] = useState([]);
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
  
  // New synchronization states
  // Single atomic roulette state - null=hidden, {players,winner}=show wheel
  const [rouletteConfig, setRouletteConfig] = useState(null);
  const [floatingReactions, setFloatingReactions] = useState([]); // [{id, emoji, name, x}]
  const [shownMatchIds, setShownMatchIds] = useState(new Set()); // Track shown match IDs to prevent duplicates
  const showGetReadyRef = React.useRef(false); // Ref to track roulette state for socket listeners
  const blockWinnerScreenRef = React.useRef(false); // Block winner screen after redirect_home
  const [forceHideLobby, setForceHideLobby] = useState(false); // Force hide lobby after redirect
  const currentGameRoomRef = React.useRef(null); // Track current game room for socket reconnects
  const [activeGameRoomId, setActiveGameRoomId] = useState(() => sessionStorage.getItem('active_game_room') || null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('rooms');
  const [isMobile, setIsMobile] = useState(false);
  const [casinoWalletAddress, setCasinoWalletAddress] = useState('Loading...');
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [anonModal, setAnonModal] = useState(null); // { roomType, betAmount } when open
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Form state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmounts, setBetAmounts] = useState({
    bronze: '',
    silver: '',
    gold: '',
    platinum: '',
    diamond: '',
    elite: ''
  }); // Separate bet amount for each room
  const [userActiveRooms, setUserActiveRooms] = useState({}); // Track which rooms user is in: {roomType: {roomId}}

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


  // Debug user state changes - especially telegram_id
  useEffect(() => {
    console.log('👤 USER STATE CHANGED:', {
      hasTelegram_id: !!user?.telegram_id,
      telegram_id: user?.telegram_id,
      isAdmin: user?.telegram_id === 7983427898,
      allKeys: user ? Object.keys(user) : []
    });
  }, [user]);

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

  // GAME STATE POLLING — primary mechanism for showing roulette (socket events are unreliable)
  // Polls /api/room/{room_id} every 1s while user is in a game room
  useEffect(() => {
    const roomId = activeGameRoomId;
    if (!roomId) return;

    let lastStatus = '';
    let lastMatchId = '';

    const pollGameState = async () => {
      try {
        const response = await axios.get(`${API}/room/${roomId}`);
        const data = response.data;
        const status = data.status;
        const matchId = data.match_id || '';
        const playerCount = (data.players || []).length;

        // Status: ready → show roulette wheel
        if ((status === 'ready' || status === 'playing' || status === 'finished') &&
            lastStatus !== 'ready' && lastStatus !== 'playing' && lastStatus !== 'finished' &&
            !showGetReadyRef.current) {
          blockWinnerScreenRef.current = false;
          showGetReadyRef.current = true;
          setInLobby(false);
          setLobbyData(null);
          setGameInProgress(false);
          setShowWinnerScreen(false);
          setWinnerData(null);
          setForceHideLobby(true);
          setRouletteConfig({ players: data.players || [], winner: null });
        }

        // Status: finished + winner → inject winner into roulette
        if (status === 'finished' && data.winner && matchId && matchId !== lastMatchId) {
          if (showGetReadyRef.current) {
            lastMatchId = matchId;
            setShownMatchIds(prev => new Set([...prev, matchId]));
            setRouletteConfig(prev => prev ? { ...prev, winner: data.winner } : prev);
          }
        }

        lastStatus = status;
      } catch (e) {
        // Room gone (game ended, room reset) — stop polling
        if (e.response && e.response.status === 404) {
          clearInterval(interval);
        }
      }
    };

    const interval = setInterval(pollGameState, 500);
    pollGameState(); // immediate first check

    return () => clearInterval(interval);
  }, [activeGameRoomId]);

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
      
      if (currentRoomPlayers.length === 3 && !showGetReadyRef.current) {
        console.log('✅ [Room Monitor] ROOM IS FULL - room_ready socket event will handle roulette');
        // The room_ready socket event handles showing the roulette with proper player data
        // This polling fallback only hides the lobby - no roulette logic here
        setInLobby(false);
        setLobbyData(null);
        setForceHideLobby(true);
      }
    }
  }, [roomParticipants, inLobby, lobbyData])

  // Detect platform
  const detectPlatform = () => {
    const ua = navigator.userAgent.toLowerCase();
    if (window.Telegram && window.Telegram.WebApp) {
      if (ua.includes('android')) return 'Telegram Android';
      if (ua.includes('iphone') || ua.includes('ipad')) return 'Telegram iOS';
      return 'Telegram WebView';
    }
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'Mobile Browser';
    }
    return 'Desktop Browser';
  };
  
  const platform = detectPlatform();
  
  // Socket connection with robust reconnection
  useEffect(() => {
    console.log('🔌🔌🔌 CONNECTING TO WEBSOCKET 🔌🔌🔌');
    console.log('Backend URL:', BACKEND_URL);
    console.log('Platform:', platform);
    console.log('User Agent:', navigator.userAgent);
    
    // Socket.IO connection
    const socketUrl = BACKEND_URL;
    console.log('🔌 Socket URL:', socketUrl);
    
    const newSocket = io(socketUrl, {
      path: '/api/socket.io',  // Match engineio_path in backend
      transports: ['polling'],
      timeout: 60000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      forceNew: false,
      autoConnect: true
    });
    
    newSocket.on('connect', () => {
      console.log('✅✅✅ WebSocket CONNECTED! ✅✅✅');
      console.log('Socket ID:', newSocket.id);
      console.log('Platform:', platform);
      console.log('Connected:', newSocket.connected);
      console.log('Transport:', newSocket.io.engine.transport.name);
      
      setIsConnected(true);
      // Don't show "Connected" toast - it confuses users before authentication
      // Only authentication success/failure will show toasts
      
      // Register user to socket mapping if user is logged in
      const storedUser = JSON.parse(localStorage.getItem('casino_user_session') || '{}');
      if (storedUser && storedUser.id) {
        console.log('📝 Registering user to socket:', storedUser.id, platform);
        newSocket.emit('register_user', {
          user_id: storedUser.id,
          platform: platform
        });

        // Re-join game room if user was in one (survives reconnect AND full remount)
        const activeGameRoom = sessionStorage.getItem('active_game_room');
        if (activeGameRoom) {
          console.log('🔄 Re-joining game room on connect:', activeGameRoom);
          currentGameRoomRef.current = activeGameRoom;
          newSocket.emit('join_game_room', {
            room_id: activeGameRoom,
            user_id: storedUser.id,
            platform: platform
          });
        }
      } else {
        console.warn('⚠️ No user in localStorage to register');
      }
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('❌❌❌ WebSocket connection error:', error);
      setIsConnected(false);
      // Only show error toast if we've been trying for more than 3 attempts
      // This prevents spam during initial connection or temporary network blips
    });
    
    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}...`);
      setIsConnected(false);
      // Only show reconnection toast after 5 attempts to reduce spam
      if (attemptNumber === 5) {
        toast.info(`Reconnecting...`, { duration: 1000 });
      }
    });
    
    newSocket.on('reconnect_failed', () => {
      console.error('❌ All reconnection attempts failed');
      setIsConnected(false);
      toast.error('Unable to connect to server. Please refresh the page.', { 
        duration: 5000 
      });
    });
    
    newSocket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts!`);
      setIsConnected(true);
      
      // Only show success toast if it took more than 2 attempts
      if (attemptNumber > 2) {
        toast.success('Reconnected!', { duration: 1000 });
      }
      
      // Re-register user after reconnection
      const storedUser = JSON.parse(localStorage.getItem('casino_user_session') || '{}');
      if (storedUser && storedUser.id) {
        console.log('📝 Re-registering user after reconnection:', storedUser.id);
        newSocket.emit('register_user', {
          user_id: storedUser.id,
          platform: platform
        });

        // Re-join game room if we were in one (socket loses room membership on reconnect)
        const reconnectRoom = currentGameRoomRef.current || sessionStorage.getItem('active_game_room');
        if (reconnectRoom) {
          console.log('🔄 Re-joining game room after reconnect:', reconnectRoom);
          newSocket.emit('join_game_room', {
            room_id: reconnectRoom,
            user_id: storedUser.id,
            platform: platform
          });
        }
      }

      // Reload rooms after reconnection
      loadRooms();
    });
    
    newSocket.on('disconnect', (reason) => {
      console.warn('⚠️⚠️⚠️ WebSocket disconnected:', reason);
      setIsConnected(false);
      
      if (reason === 'io server disconnect') {
        // Server disconnected us, manually reconnect
        console.log('🔄 Server disconnected, attempting to reconnect...');
        newSocket.connect();
      }
      
      // Don't show disconnect toast for normal disconnects or quick reconnects
      // Only show if it's a server issue and not a normal close
      if (reason !== 'io client disconnect' && reason !== 'transport close') {
        // Delay showing the toast to avoid spam on quick reconnects
        setTimeout(() => {
          if (!newSocket.connected) {
            toast.warning('Connection lost. Reconnecting...', { duration: 1500 });
          }
        }, 2000);
      }
    });

    setSocket(newSocket);

    // Room management events
    newSocket.on('user_registered', (data) => {
      console.log('✅✅✅ USER REGISTERED TO SOCKET ✅✅✅');
      console.log('User ID:', data.user_id);
      console.log('Platform:', data.platform);
      console.log('Status:', data.status);
    });

    newSocket.on('room_joined_confirmed', (data) => {
      console.log('✅✅✅ ROOM JOINED CONFIRMED VIA SOCKET.IO ✅✅✅');
      console.log('Room ID:', data.room_id);
      console.log('Socket count in room:', data.socket_count);
    });

    newSocket.on('room_full', (data) => {
      console.log('🚀 ROOM FULL event received:', data);
      // Removed toast - silent transition to GET READY
    });

    // Game events - CRITICAL: These must maintain strict order
    newSocket.on('player_joined', (data) => {
      console.log('📥 EVENT: player_joined', {
        room: data.room_type,
        player: data.player.first_name,
        count: data.players_count,
        status: data.room_status
      });
      
      // REPLACE (not append) room participants with full list from server
      setRoomParticipants(prev => ({
        ...prev,
        [data.room_type]: data.all_players || []
      }));
      
      console.log(`✅ Participant list REPLACED for ${data.room_type}`);
      // Removed toast - silent player join
      
      // Reload rooms to update lobby counts (skip if GET READY is active)
      if (!showGetReadyRef.current) {
        loadRooms();
      }
    });

    // NEW EVENT: room_ready - Show "GET READY!" full-screen animation
    newSocket.on('room_ready', (data) => {
      console.log('🚀🚀🚀 EVENT: room_ready RECEIVED 🚀🚀🚀');
      console.log('📥 room_ready data:', data);

      // Filter: only process if current user is a participant in this game
      const currentUser = userRef.current;
      const isParticipant = currentUser && data.players && data.players.some(p =>
        String(p.user_id) === String(currentUser.id) ||
        String(p.telegram_id) === String(currentUser.telegram_id)
      );
      if (!isParticipant) {
        return;
      }

      // Reset all block flags for new game
      blockWinnerScreenRef.current = false;
      showGetReadyRef.current = false; // force-clear any stuck state from previous game
      
      // AGGRESSIVELY CLOSE EVERYTHING IMMEDIATELY
      console.log('🚪🚪🚪 FORCE CLOSING ALL SCREENS 🚪🚪🚪');
      console.log('BEFORE:', { inLobby, rouletteActive: showGetReadyRef.current, showWinnerScreen, gameInProgress, forceHideLobby });

      setInLobby(false);
      setLobbyData(null);
      setGameInProgress(false);
      setShowWinnerScreen(false);
      setWinnerData(null);
      setForceHideLobby(true);

      // Atomic: set players + show wheel in ONE state update — no timing issues
      showGetReadyRef.current = true;
      const roomPlayers = data.players || [];
      setRouletteConfig({ players: roomPlayers, winner: null });

    });

    newSocket.on('game_starting', (data) => {
      console.log('📥 EVENT: game_starting', {
        room: data.room_type,
        match_id: data.match_id,
        players: data.players?.length
      });
      
      // Removed toast - silent game start
      
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
      const matchId = data.match_id;

      // Always refresh history for all users when any game finishes
      loadGameHistory();

      // Filter: only process if current user was a participant (check via showGetReadyRef or player list)
      // If roulette is active (showGetReadyRef=true), we're definitely a participant
      // Otherwise check active_game_room sessionStorage to confirm participation
      const activeRoom = sessionStorage.getItem('active_game_room');
      const isParticipatingRoom = showGetReadyRef.current || (activeRoom && activeRoom === data.room_id);
      if (!isParticipatingRoom) {
        console.log('⏭️ game_finished: not a participant in this game, ignoring');
        return;
      }

      // FIRST CHECK - Before any logging or processing
      if (blockWinnerScreenRef.current) {
        console.log('🚫 BLOCKED by ref');
        return;
      }

      if (!matchId || shownMatchIds.has(matchId)) {
        console.log('🚫 BLOCKED by matchId');
        return;
      }

      if (showWinnerScreen) {
        console.log('🚫 BLOCKED - already showing');
        return;
      }
      
      console.log('✅ game_finished PASSED all checks - Match:', matchId);
      
      // Mark IMMEDIATELY before any processing
      setShownMatchIds(prev => new Set([...prev, matchId]));
      
      // Determine winner
      const winnerName = data.winner_name || `${data.winner?.first_name || ''} ${data.winner?.last_name || ''}`.trim();
      const gameTime = data.finished_at ? new Date(data.finished_at).toLocaleTimeString() : new Date().toLocaleTimeString();
      const isWinner = user && (
        String(user.id) === String(data.winner?.user_id) ||
        String(user.telegram_id) === String(data.winner?.telegram_id)
      );
      
      // Close game/lobby screens
      setGameInProgress(false);
      setCurrentGameData(null);
      setInLobby(false);
      setLobbyData(null);
      setActiveRoom(null);

      // Prepare winner data
      const winnerInfo = {
        winner: data.winner,
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
        match_id: matchId
      };

      if (showGetReadyRef.current) {
        // Roulette is spinning - inject winner into existing config atomically
        console.log('🎡 Roulette active - injecting winner into wheel');
        setRouletteConfig(prev => prev ? { ...prev, winner: data.winner } : prev);
        // DEBUG TOAST - remove after testing
        toast.success(`🏆 Winner: ${data.winner?.first_name || '?'}`, { duration: 4000 });
        setWinnerDisplayedForGame(matchId);
        if (user) loadUserPrizes();
      } else {
        // No roulette - show winner screen directly
        // DEBUG TOAST - remove after testing
        toast.error(`⚠️ No roulette active when winner arrived`, { duration: 5000 });
        setRouletteConfig(null);
        showGetReadyRef.current = false;
        setWinnerData(winnerInfo);
        setShowWinnerScreen(true);
        setWinnerDisplayedForGame(matchId);
        console.log('✅ Winner screen displayed');

        setTimeout(() => {
          console.log('⏰ 5 seconds elapsed - auto-redirecting to home');
          setShowWinnerScreen(false);
          setWinnerData(null);
          setActiveTab('rooms');
          if (user && user.id) {
            axios.get(`${API}/user/${user.id}`)
              .then(response => setUser(response.data))
              .catch(error => console.error('Failed to reload user:', error));
          }
          loadRooms();
          loadGameHistory();
        }, 5000);

        if (user) loadUserPrizes();
      }
    });

    newSocket.on('prize_won', (data) => {
      console.log('🎉 Prize won:', data);
      // Removed toast - silent prize notification
      if (user) loadUserPrizes();
    });

    // NEW EVENT: player_left - Handle player disconnection
    newSocket.on('player_left', (data) => {
      console.log('📥 EVENT: player_left', {
        room: data.room_type,
        player: data.player?.first_name,
        remaining: data.players_count
      });
      
      // REPLACE participant list with updated full list
      setRoomParticipants(prev => ({
        ...prev,
        [data.room_type]: data.all_players || []  // FULL list replacement
      }));
      
      console.log(`✅ Participant list updated after ${data.player?.first_name} left`);
      
      toast.warning(
        `👋 ${data.player?.first_name || 'Player'} left the room (${data.players_count}/3)`,
        { duration: 2000 }
      );
      
      loadRooms();
    });

    newSocket.on('rooms_updated', () => {
      console.log('📥 EVENT: rooms_updated');
      // DON'T reload if GET READY is showing - prevents state reset
      if (!showGetReadyRef.current) {
        console.log('✅ Reloading room list');
        loadRooms();
      } else {
        console.log('⏭️ Skipping rooms reload - GET READY animation in progress');
      }
    });

    // NEW EVENT: redirect_home - Backend signals all players to return to home
    newSocket.on('redirect_home', (data) => {
      console.log('🟢🟢🟢 EVENT: redirect_home RECEIVED 🟢🟢🟢');
      console.log('Match ID:', data.match_id);

      // Filter: only process if we're an active participant
      const activeRoomForRedirect = sessionStorage.getItem('active_game_room');
      const isParticipatingRedirect = showGetReadyRef.current || (activeRoomForRedirect && activeRoomForRedirect === data.room_id);
      if (!isParticipatingRedirect) {
        console.log('⏭️ redirect_home: not a participant, ignoring');
        return;
      }

      // CRITICAL: Block any future winner screens from this game
      blockWinnerScreenRef.current = true;
      console.log('🚫 Winner screen BLOCKED for future events');
      
      // FORCE RESET ALL GAME STATE IMMEDIATELY
      console.log('🏠🏠🏠 FORCING HOME SCREEN RETURN 🏠🏠🏠');
      
      // Mark this match as fully processed
      if (data.match_id) {
        setShownMatchIds(prev => new Set([...prev, data.match_id]));
      }
      
      // Batch all state updates together
      setShowWinnerScreen(false);
      setWinnerData(null);
      setInLobby(false);
      setLobbyData(null);
      setGameInProgress(false);
      setActiveRoom(null);
      setRoomParticipants({});
      setForceHideLobby(false);
      // Always reset roulette ref + config on redirect_home (game is fully over)
      showGetReadyRef.current = false;
      currentGameRoomRef.current = null;
      sessionStorage.removeItem('active_game_room');
      setActiveGameRoomId(null);
      setRouletteConfig(null);
      setActiveTab('rooms');
      
      console.log('AFTER - inLobby:', false, 'showWinner:', false, 'gameInProgress:', false);
      console.log('AFTER - activeTab:', 'rooms');
      
      // Force re-render by updating a dummy state
      console.log('Forcing component re-render...');
      
      // Reload user data to get updated balance
      console.log('Reloading user data...');
      if (user && user.id) {
        axios.get(`${API}/user/${user.id}`)
          .then(response => {
            console.log('✅ User data reloaded:', response.data);
            setUser(response.data);
          })
          .catch(error => {
            console.error('❌ Failed to reload user:', error);
          });
      }
      
      // Reload all data with delays
      console.log('Reloading rooms, history, and bonus...');
      loadRooms();
      loadGameHistory();
      
      // Double-check lobby is hidden after 1 second
      setTimeout(() => {
        console.log('🔍 Double-checking state after 1s...');
        console.log('inLobby should be false:', inLobby);
        if (inLobby) {
          console.error('⚠️⚠️⚠️ LOBBY STILL VISIBLE - FORCING AGAIN');
          setInLobby(false);
          setLobbyData(null);
        }
      }, 1000);
      
      console.log('✅ redirect_home complete');
      // Removed "Game finished! Returning home..." toast - clean silent redirect
    });

    newSocket.on('new_room_available', (data) => {
      console.log('🆕 New room available:', data);
      loadRooms();
    });

    newSocket.on('reaction_received', (data) => {
      // Only show if we're in the same room
      const activeRoom = sessionStorage.getItem('active_game_room');
      if (data.room_id && activeRoom && data.room_id !== activeRoom) return;
      const id = Date.now() + Math.random();
      const x = 15 + Math.random() * 70;
      setFloatingReactions(prev => [...prev, { id, emoji: data.emoji, name: data.name, x }]);
      setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
    });

    newSocket.on('token_balance_updated', (data) => {
      if (user && data.user_id === user.id) {
        setUser({...user, token_balance: data.new_balance});
        toast.success(`🎉 Payment confirmed! +${data.tokens_added} tokens (${data.sol_received} SOL)`);
      }
    });

    newSocket.on('balance_updated', (data) => {
      setUser(prev => prev && data.user_id === prev.id ? {...prev, token_balance: data.new_balance} : prev);
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
        
        // CRITICAL: Validate telegram_id exists in cached data
        if (!userData.telegram_id) {
          console.warn('⚠️ Cached user missing telegram_id - forcing re-authentication');
          localStorage.removeItem('casino_user');
          authenticateFromTelegram();
          return;
        }
        
        // CRITICAL: For admin, always force fresh authentication to prevent stale data
        // DISABLED: This prevents admin from staying logged in
        // if (userData.telegram_id === 7983427898) {
        //   console.warn('👑 Admin detected in cache - forcing fresh authentication for data integrity');
        //   localStorage.removeItem('casino_user');
        //   authenticateFromTelegram();
        //   return;
        // }
        
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

              // Check for a missed game result (user was offline when game ended)
              try {
                const pendingRes = await axios.get(`${API}/pending-result/${response.data.id}`);
                const pending = pendingRes.data?.result;
                if (pending) {
                  const winnerName = `${pending.winner.first_name} ${pending.winner.last_name || ''}`.trim();
                  setWinnerData({
                    winner: pending.winner,
                    winner_name: winnerName,
                    winner_username: pending.winner.username,
                    winner_photo: pending.winner.photo_url,
                    room_type: pending.room_type,
                    prize_pool: pending.prize_pool,
                    prize_link: pending.prize_link,
                    game_id: pending.match_id,
                    finished_at: pending.finished_at,
                    all_players: pending.all_players || [],
                    is_winner: String(pending.winner.user_id) === String(response.data.id),
                    missed: true,
                  });
                  setShowWinnerScreen(true);
                }
              } catch (e) {
                console.error('Failed to fetch pending result:', e);
              }
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

          cancelFallbackTimeout();
          setUser(response.data);
          saveUserSession(response.data);
          setIsLoading(false);

          // Show welcome message for returning users
          if (response.data.token_balance >= 1000) {
            toast.success(`🎉 Welcome back, ${response.data.first_name}! Balance: ${response.data.token_balance} tokens`);
          } else if (response.data.token_balance > 0) {
            toast.success(`Welcome, ${response.data.first_name}! Balance: ${response.data.token_balance} tokens`);
          } else {
            toast.success(`👋 Welcome, ${response.data.first_name}!`);
          }

          // Load additional data for returning users
          setTimeout(() => {
            loadUserPrizes();
            loadDerivedWallet();
          }, 500);
          
          // Configure WebApp
          webApp.enableClosingConfirmation();
          if (webApp.setHeaderColor) webApp.setHeaderColor('#1e293b');
          if (webApp.setBackgroundColor) webApp.setBackgroundColor('#0f172a');

          cancelAuthTimeout();
          return; // Exit successfully
        }
        
      } catch (error) {
        console.error('❌ Telegram authentication failed:', error);
        console.error('Error details:', {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data
        });
        
        // Don't show multiple error toasts - just log and proceed to fallback
        console.log('⚠️ Auth failed - attempting fallback authentication...');
        
        // If we have Telegram user data, try to find existing account
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
          const telegramUser = window.Telegram.WebApp.initDataUnsafe.user;
          if (telegramUser && telegramUser.id) {
            try {
              console.log('Trying to find existing user by Telegram ID:', telegramUser.id);
              const response = await axios.get(`${API}/users/telegram/${telegramUser.id}`);
              
              if (response.data) {
                console.log('Found existing user with tokens!', response.data);

                cancelFallbackTimeout();
                setUser(response.data);
                saveUserSession(response.data);
                setIsLoading(false);
                cancelAuthTimeout();

                toast.success(`Welcome back, ${response.data.first_name}!`);
                  
                setTimeout(() => {
                  loadUserPrizes();
                  loadDerivedWallet();
                }, 1000);
                
                return;
              }
            } catch (lookupError) {
              console.log('User not found by Telegram ID - will create new account');
              // Don't show error toast here - fallback will handle it
            }
          }
        }
        
        // If all else fails, fallback will handle user creation
        console.log('⚠️ Auth failed - fallback will create user in 2 seconds...');
        // Note: isLoading stays true so fallback can detect and handle it
      }
    };

    // Start authentication immediately
    authTimeoutRef.current = setTimeout(authenticateFromTelegram, 100);

    // Fallback timeout - ALWAYS ensures loading completes (reduced to 3s for better UX)
    fallbackTimeoutRef.current = setTimeout(async () => {
      const currentUser = userRef.current;
      const currentLoading = isLoadingRef.current;
      console.log(`⏰ Fallback timeout triggered! user=${currentUser ? 'exists' : 'null'}, isLoading=${currentLoading}`);

      // Ensure we don't run fallback twice
      cancelFallbackTimeout();

      // If user already exists, just stop loading
      if (currentUser) {
        console.log('✅ User already exists - just stopping loading state');
        setIsLoading(false);
        cancelAuthTimeout();
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
              cancelFallbackTimeout();
              setUser(response.data);
              saveUserSession(response.data);
              setIsLoading(false);
              cancelAuthTimeout();

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
            cancelFallbackTimeout();
            setUser(response.data);
            saveUserSession(response.data);
            cancelAuthTimeout();

            toast.success('Account created successfully!');
          }
        } catch (error) {
          console.error('Fallback account creation failed:', error);

          // Small delay before retrying fetch in case the user was created concurrently
          if (telegramUser && telegramUser.id) {
            try {
              await new Promise((resolve) => setTimeout(resolve, 500));
              const retryResponse = await axios.get(`${API}/users/telegram/${telegramUser.id}`);

              if (retryResponse.data) {
                cancelFallbackTimeout();
                setUser(retryResponse.data);
                saveUserSession(retryResponse.data);
                setIsLoading(false);
                cancelAuthTimeout();
                toast.success(`Welcome back, ${telegramUser.first_name}!`);
                return;
              }
            } catch (retryError) {
              console.error('Retry lookup after fallback failure also failed:', retryError);
            }
          }

          // If backend save fails, use frontend-only fallback
          cancelFallbackTimeout();
          setUser({
            id: 'fallback-' + Date.now(),
            first_name: fallbackTelegramData.first_name,
            last_name: fallbackTelegramData.last_name,
            token_balance: 0,
            telegram_id: fallbackTelegramData.id,
            username: fallbackTelegramData.username
          });
          cancelAuthTimeout();
          toast.warning('Using temporary account - limited functionality');
        }
      // Always ensure loading is stopped
      setIsLoading(false);
    }, 3000); // 3 seconds - gives real auth time to complete, but not too long

    return () => {
      cancelAuthTimeout();
      cancelFallbackTimeout();
    };
  }, []);


  // User session management
  const saveUserSession = (userData) => {
    try {
      console.log('💾 Saving user session:', {
        hasTelegramId: !!userData?.telegram_id,
        telegram_id: userData?.telegram_id,
        keys: userData ? Object.keys(userData) : []
      });

      localStorage.setItem('casino_user', JSON.stringify(userData));
      console.log('✅ User session saved to localStorage');
    } catch (e) {
      console.error('❌ Failed to save user session:', e);
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

      // Load user's active rooms
      loadAllUserRooms();
    } catch (error) {
      console.error('Failed to load rooms:', error);
      // Only show error toast if explicitly requested (not on initial load)
      if (showError) {
        toast.error('Failed to load rooms. Please refresh.');
      }
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
    
    // AUTO-REDIRECT to home after 2 seconds
    setTimeout(() => {
      console.log('🏠 AUTO-REDIRECTING to home after winner screen...');
      setShowWinnerScreen(false);
      setWinnerData(null);
      setInLobby(false);
      setLobbyData(null);
      setForceHideLobby(false);  // Allow joining new rooms
      setActiveTab('rooms');
      
      // Reload rooms
      loadRooms();
      
      toast.success('Redirected to home! Join another game.', { duration: 2000 });
    }, 2000);  // 2 seconds to view winner
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
  const checkUserRoomStatus = async (specificRoomType = null) => {
    if (!user || !user.id) return null;
    
    try {
      const response = await axios.get(`${API}/user-room-status/${user.id}`);
      
      // Update active rooms state with ALL rooms
      if (response.data.in_room && response.data.rooms) {
        const newActiveRooms = {};
        response.data.rooms.forEach(room => {
          const roomType = room.room_type.toLowerCase();
          newActiveRooms[roomType] = {
            roomId: room.room_id
          };
        });
        setUserActiveRooms(newActiveRooms);

        // If checking for specific room type, return that room's data
        if (specificRoomType) {
          const specificRoom = response.data.rooms.find(r => r.room_type.toLowerCase() === specificRoomType);
          return specificRoom || null;
        }
      }
      
      return response.data;
    } catch (error) {
      console.error('Failed to check room status:', error);
      return null;
    }
  };

  const loadAllUserRooms = async () => {
    if (!user || !user.id) return;
    
    try {
      // Get current room status
      const response = await axios.get(`${API}/user-room-status/${user.id}`);
      
      console.log('🔍 API Response for user rooms:', response.data);
      
      const newActiveRooms = {};
      
      if (response.data.in_room && response.data.rooms) {
        // Loop through all rooms user is in
        response.data.rooms.forEach(room => {
          const roomType = room.room_type.toLowerCase(); // Ensure lowercase
          newActiveRooms[roomType] = {
            roomId: room.room_id
          };
        });

        console.log('✅ User active rooms loaded:', {
          totalRooms: response.data.total_rooms,
          fullState: newActiveRooms
        });
        setUserActiveRooms(newActiveRooms);
      } else {
        // Clear active rooms if user is not in any room
        console.log('❌ No active rooms');
        setUserActiveRooms({});
      }
    } catch (error) {
      console.error('Failed to load user rooms:', error);
    }
  };

  // Called by the "Enter Bet" / "Join" button — shows anonymous choice modal
  const promptJoinRoom = (roomType) => {
    const betAmount = betAmounts[roomType];
    if (!user) { toast.error('Please authenticate first'); return; }
    if (userActiveRooms[roomType]) { joinRoom(roomType, false); return; } // return-to-room, skip modal
    const parsedBetAmount = parseInt(betAmount);
    if (!parsedBetAmount || isNaN(parsedBetAmount)) { toast.error('Please enter a valid bet amount'); return; }
    if (parsedBetAmount < ROOM_CONFIGS[roomType].min || parsedBetAmount > ROOM_CONFIGS[roomType].max) {
      toast.error(`Bet amount must be between ${ROOM_CONFIGS[roomType].min} - ${ROOM_CONFIGS[roomType].max} tokens`); return;
    }
    if (user.token_balance < parsedBetAmount) { toast.error('Insufficient tokens'); return; }
    setAnonModal({ roomType, betAmount });
  };

  const joinRoom = async (roomType, isAnonymous = false) => {
    const betAmount = betAmounts[roomType];
    
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
    
    // Check if user is already in THIS specific room type
    if (userActiveRooms[roomType]) {
      // Show the lobby (Return to Room)
      console.log('✅ User already in this room, showing lobby');
      
      // Fetch current room state for this specific room type
      const specificRoomData = await checkUserRoomStatus(roomType);
      toast.info(`🔍 Return to Room: ${specificRoomData ? 'found room ' + specificRoomData.room_id?.substring(0,8) : 'NO ROOM'}`, { duration: 5000 });
      if (specificRoomData) {
        setInLobby(true);
        setLobbyData({
          room_type: roomType,
          room_id: specificRoomData.room_id,
          bet_amount: betAmount
        });
        setRoomParticipants(specificRoomData.players);

        // Always set game room for polling — regardless of socket state
        currentGameRoomRef.current = specificRoomData.room_id;
        sessionStorage.setItem('active_game_room', specificRoomData.room_id);
        setActiveGameRoomId(specificRoomData.room_id);

        // Also join Socket.IO room if connected
        if (socket && socket.connected) {
          socket.emit('join_game_room', {
            room_id: specificRoomData.room_id,
            user_id: user.id,
            platform: platform
          });
        }
      }

      // Silently return to room, no toast needed
      return;
    }
    
    // User can join this room (not participating yet in this room type)

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
        bet_amount: parsedBetAmount,
        is_anonymous: isAnonymous
      });
      console.log('✅ API Response:', response.data);

      if (response.data.status === 'joined') {
        // Removed toast - silent room join
        setUser({...user, token_balance: response.data.new_balance});
        setBetAmounts(prev => ({ ...prev, [roomType]: '' })); // Clear only this room's bet
        setSelectedRoom(null);
        setForceHideLobby(false);
        
        // Track that user is now in this room
        setUserActiveRooms(prev => ({
          ...prev,
          [roomType]: {
            roomId: response.data.room_id
          }
        }));
        
        // DON'T manually set roomParticipants here - let the player_joined socket event handle it
        console.log('✅ Joined room, waiting for player_joined socket event...');
        
        // Always set game room for polling — regardless of socket state
        currentGameRoomRef.current = response.data.room_id;
        sessionStorage.setItem('active_game_room', response.data.room_id);
        setActiveGameRoomId(response.data.room_id);
        toast.info(`✅ JOINED: polling room ${response.data.room_id?.substring(0,8)}`, { duration: 5000 });

        // Join the Socket.IO room for room-specific events
        if (socket && socket.connected) {
          socket.emit('join_game_room', {
            room_id: response.data.room_id,
            user_id: user.id,
            platform: platform
          });
        } else {
          console.error('❌❌❌ SOCKET NOT CONNECTED!');
          console.log('Socket exists:', !!socket);
          console.log('Socket connected:', socket?.connected);
          console.log('Socket ID:', socket?.id);
          console.log('Platform:', platform);
        }
        
        // Enter lobby mode and reset winner screen block
        blockWinnerScreenRef.current = false; // Allow winner screen for new game
        console.log('✅ Winner screen block RESET for new game');
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
      const errorDetail = error.response?.data?.detail || 'Failed to join room';
      toast.error(errorDetail);
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

  // Auto-fetch recent winners every 10 seconds
  useEffect(() => {
    if (!user) return;
    const fetchWinners = async () => {
      try {
        const res = await axios.get(`${API}/game-history?limit=5`);
        setRecentWinners(res.data.games || []);
      } catch (e) {}
    };
    fetchWinners();
    const interval = setInterval(fetchWinners, 10000);
    return () => clearInterval(interval);
  }, [user]); // eslint-disable-line

  // Error screen for non-Telegram access
  if (telegramError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background: 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)'}}>
        <Card className="w-full max-w-md bg-[#0d0d1a]/95 border-red-900/40">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Telegram Web App Required</h3>
            <p className="text-slate-400 mb-4">SpinWar must be opened as a Telegram Web App, not in a regular browser.</p>
            
            <div className="space-y-3 text-left mb-4">
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">📱</span>
                <p className="text-sm text-slate-300">Open Telegram on your mobile device</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold text-lg">🔍</span>
                <p className="text-sm text-slate-300">Find your SpinWar bot or Web App</p>
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
    console.log('🔄 Rendering: LOADING screen');
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background: 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)'}}>
        <Card className="w-full max-w-md bg-[#0d0d1a]/95 border-red-900/40">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold text-white mb-2">Connecting to Telegram...</h3>
            <p className="text-slate-400">Authenticating your account</p>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  if (!user) {
    console.log('🔄 Rendering: NO USER screen');
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background: 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)'}}>
        <Card className="w-full max-w-md bg-[#0d0d1a]/95 border-red-900/40">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold text-white mb-2">Loading SpinWar...</h3>
            <p className="text-slate-400">Connecting to Telegram Web App</p>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // Main app
  console.log('🔄 Rendering: MAIN APP', {
    hasUser: !!user,
    telegram_id: user?.telegram_id
  });
  return (
    <div className={`min-h-screen text-white overflow-y-auto ${
      isMobile ? 'overflow-x-hidden max-w-full w-full' : ''
    }`} style={isMobile ? {maxWidth: '100vw', width: '100vw', background: 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)'} : {background: 'linear-gradient(135deg, #08080f 0%, #1a0320 40%, #08080f 100%)'}}>
      
      {/* Roulette Wheel Animation */}
      {rouletteConfig && (
        <RouletteWheel
          players={rouletteConfig.players}
          winner={rouletteConfig.winner}
          currentUser={user}
          onComplete={() => {
            setRouletteConfig(null);
            showGetReadyRef.current = false;
            currentGameRoomRef.current = null;
            sessionStorage.removeItem('active_game_room');
            setActiveGameRoomId(null);
            setActiveTab('rooms');
            setInLobby(false);
            setGameInProgress(false);
            if (user && user.id) {
              axios.get(`${API}/user/${user.id}`)
                .then(response => setUser(response.data))
                .catch(() => {});
            }
            loadRooms();
            loadGameHistory();
          }}
        />
      )}
      
      {/* Header */}
      <header className="spinwar-header sticky top-0 z-50">
        <div className="px-4 py-3">
          {isMobile ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Crown className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div>
                    <h1 className="text-sm font-bold spinwar-title">SpinWar</h1>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Balance</div>
                    <div className="text-sm font-bold" style={{color: 'var(--sw-gold)'}}>{user.token_balance || 0}</div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>
              </div>
              
              {/* Mobile Action Buttons */}
              <div className="flex flex-col gap-2 px-3 pb-2">
                <Button
                  onClick={() => setActiveTab('tokens')}
                  className="w-full bg-green-600 hover:bg-green-700 text-white text-xs py-2"
                >
                  💰 Buy Tokens
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="w-8 h-8 text-red-500" />
                <h1 className="text-2xl spinwar-title">
                  SpinWar
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
                    <Coins className="w-4 h-4" style={{color: 'var(--sw-gold)'}} />
                    <span className="text-lg font-bold" style={{color: 'var(--sw-gold)'}}>{user.token_balance || 0}</span>
                    <span className="text-slate-400">tokens</span>
                  </div>
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
          <nav className="desktop-sidebar w-64 backdrop-blur-sm border-r min-h-screen p-4" style={{background: 'rgba(8,8,15,0.85)', borderColor: 'rgba(220,38,38,0.2)'}}>
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab('rooms')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'rooms'
                    ? 'bg-gradient-to-r from-red-700 to-red-800 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Users className="w-5 h-5" />
                <span>Spin Rooms</span>
              </button>
              
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'history'
                    ? 'bg-gradient-to-r from-purple-700 to-purple-800 text-white font-semibold'
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

              {(user?.is_admin || user?.is_owner || user?.telegram_id === 7983427898) && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    activeTab === 'admin'
                      ? 'bg-gradient-to-r from-red-600 to-red-700 text-white font-semibold'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Crown className="w-5 h-5" />
                  <span>Admin Panel</span>
                </button>
              )}

            </div>

            {/* Stats Sidebar */}
            <div className="mt-8 space-y-4">
              <div className="rounded-lg p-4" style={{background: 'rgba(13,13,26,0.8)', border: '1px solid rgba(220,38,38,0.2)'}}>
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Your Balance</div>
                <div className="text-2xl font-bold" style={{color: 'var(--sw-gold)'}}>{user.token_balance}</div>
                <div className="text-xs text-slate-500">SpinWar Tokens</div>
              </div>
            </div>
          </nav>
        )}

        {/* Main Content */}
        <main className={`flex-1 ${isMobile ? 'p-2 pb-24 w-full overflow-x-hidden' : 'p-6'}`} style={isMobile ? {maxWidth: '100vw'} : {}}>
          <div className={`${isMobile ? 'space-y-3 w-full max-w-full' : 'space-y-6'}`}>

            {/* Mobile Welcome Header - Compact */}
            {isMobile && (
              <div className="bg-gradient-to-r from-red-900/15 to-purple-900/15 border border-red-800/20 rounded-lg p-3 mb-3">
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
                    <p className="font-medium text-sm" style={{color: 'var(--sw-gold)'}}>Balance: {user.token_balance || 0} tokens</p>
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
                      
                      {/* Missed game badge */}
                      {winnerData.missed && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700/80 border border-slate-500 text-slate-300 text-xs font-medium mb-1">
                          📵 You were offline — here's what happened
                        </div>
                      )}

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
                              <p className="text-blue-400 text-sm font-medium">In Spin</p>
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

            {/* LOBBY SCREEN - Show when player is waiting in room - HIDDEN when GET READY animation is showing */}
            {!showWinnerScreen && !gameInProgress && inLobby && !rouletteConfig && !forceHideLobby && lobbyData && (
              <Card className="bg-[#0d0d1a]/95 border-2 border-red-500/40" style={{boxShadow: '0 0 24px rgba(220,38,38,0.15), 0 0 48px rgba(124,58,237,0.1)'}}>
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl text-red-400 flex items-center justify-center gap-2">
                    <Users className="w-6 h-6" />
                    {ROOM_CONFIGS[lobbyData.room_type]?.icon} {ROOM_CONFIGS[lobbyData.room_type]?.name} Spin Lobby
                  </CardTitle>
                  <CardDescription className="text-lg">
                    Bet Amount: {lobbyData.bet_amount} tokens
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Prize Pool */}
                    <div className="bg-gradient-to-r from-red-900/25 to-purple-900/25 border border-red-500/30 rounded-xl p-4 text-center" style={{boxShadow: '0 0 20px rgba(220,38,38,0.15)'}}>
                      <p className="text-red-400 text-xs font-semibold uppercase tracking-widest mb-1">Prize Pool</p>
                      <p className="text-3xl font-black" style={{background: 'linear-gradient(135deg, #dc2626, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'}}>
                        💰 {(roomParticipants[lobbyData.room_type] || []).reduce((sum, p) => sum + (p.bet_amount || lobbyData.bet_amount || 0), 0)} tokens
                      </p>
                      <p className="text-red-500/70 text-xs mt-1">Winner takes all!</p>
                    </div>

                    {/* Current room participants */}
                    <div>
                      <h3 className="text-white font-semibold mb-3 text-center">Players in Room:</h3>
                      <div className="space-y-3" key={`lobby-${lobbyData.room_type}-${roomParticipants[lobbyData.room_type]?.length || 0}`}>
                        {roomParticipants[lobbyData.room_type]?.length > 0 ? (
                          roomParticipants[lobbyData.room_type].map((player, index) => (
                            <div key={`player-${player.user_id}-${index}`} className="flex items-center gap-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                              {/* Profile Picture */}
                              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600 flex items-center justify-center text-slate-900 font-bold text-xl flex-shrink-0">
                                {player.is_anonymous ? (
                                  <span className="text-2xl">🥷</span>
                                ) : player.photo_url ? (
                                  <img src={player.photo_url} alt={player.first_name} className="w-12 h-12 rounded-full" />
                                ) : (
                                  player.first_name?.charAt(0).toUpperCase()
                                )}
                              </div>

                              {/* Player Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-white font-semibold truncate">
                                    {player.first_name} {player.is_anonymous ? '' : (player.last_name || '')}
                                  </p>
                                  {player.user_id === user?.id && (
                                    <Badge className="bg-green-500 text-black text-xs">You</Badge>
                                  )}
                                </div>
                                {!player.is_anonymous && player.username && (
                                  <p className="text-slate-400 text-sm">@{player.username}</p>
                                )}
                                <p className="text-purple-400 text-sm font-medium">Ready to play · <span style={{color: 'var(--sw-gold)'}}>{player.bet_amount || lobbyData.bet_amount} tokens</span></p>
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
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mb-2"></div>
                              <p className="text-red-400 font-semibold text-lg">
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
                                <div className="w-40 h-40 bg-gradient-to-r from-red-600 via-red-500 to-purple-600 rounded-full opacity-20 animate-ping"></div>
                                <div className="w-32 h-32 bg-gradient-to-r from-red-600 to-purple-700 rounded-full opacity-30 animate-pulse absolute"></div>
                              </div>
                              
                              {/* Main Content */}
                              <div className="relative z-10">
                                <div className="text-6xl mb-4 animate-bounce">🚀</div>
                                <div className="mb-4 space-y-2">
                                  <p className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-red-400 to-purple-400 animate-pulse" style={{fontFamily: 'Orbitron, monospace'}}>
                                    GET READY!
                                  </p>
                                  <p className="text-xl md:text-2xl font-bold text-white animate-pulse">
                                    THE GAME IS ABOUT TO BEGIN!
                                  </p>
                                </div>
                                
                                {/* Ready indicator */}
                                <div className="flex items-center justify-center gap-3 mt-6">
                                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                                  <p className="text-purple-400 font-bold text-lg">
                                    All 3 Players Ready
                                  </p>
                                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
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

                    {/* Reaction Buttons */}
                    <div style={{ marginTop: 12, marginBottom: 4 }}>
                      <p style={{ fontSize: 10, color: '#64748b', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Taunt your opponents</p>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                        {['🔥', '👊', '🎯', '😤', '💀'].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => {
                              if (!socket || !lobbyData?.room_id) return;
                              if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
                              socket.emit('send_reaction', {
                                room_id: lobbyData.room_id,
                                user_id: user.id,
                                name: user.first_name || 'Player',
                                emoji,
                              });
                            }}
                            style={{ fontSize: 22, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 44, height: 44, cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.2)'; e.currentTarget.style.transform = 'scale(1.15)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.transform = 'scale(1)'; }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Lobby Action Buttons */}
                    <div className="flex gap-3 pt-2">
                      {/* Browse Menu — keeps spot in room */}
                      <Button
                        onClick={() => {
                          setInLobby(false);
                          // lobbyData and userActiveRooms kept — player still in room
                          toast.info('Your spot is saved! Hit "Return to Room" to come back.');
                        }}
                        variant="outline"
                        className="flex-1 border-slate-500 text-slate-300 hover:bg-slate-700 hover:text-white"
                      >
                        🏠 Browse Menu
                      </Button>

                      {/* Leave & Refund — shows confirmation first */}
                      <Button
                        onClick={() => setConfirmLeave(true)}
                        variant="outline"
                        className="flex-1 border-red-500 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        💸 Leave & Refund
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Battle Rooms Tab */}
            {activeTab === 'rooms' && !inLobby && !showWinnerScreen && !gameInProgress && (
              <div className={isMobile ? 'space-y-4' : 'space-y-6'}>

                {/* Live Winners Feed */}
                {recentWinners.length > 0 && (
                  <div style={{ background: 'linear-gradient(135deg, #0d0d1a 0%, #1a0a20 100%)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 12, padding: isMobile ? '10px 12px' : '12px 16px' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Live Winners</span>
                    </div>
                    {/* Winners list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {recentWinners.map((game, i) => {
                        const config = ROOM_CONFIGS[game.room_type];
                        const winnerName = game.winner?.first_name || game.winner?.username || 'Unknown';
                        const pool = game.prize_pool || 0;
                        const finishedAt = game.finished_at ? new Date(game.finished_at) : null;
                        const minsAgo = finishedAt ? Math.max(0, Math.floor((Date.now() - finishedAt.getTime()) / 60000)) : null;
                        const timeLabel = minsAgo === null ? '' : minsAgo < 1 ? 'just now' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo/60)}h ago`;
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, background: i === 0 ? 'rgba(220,38,38,0.1)' : 'rgba(255,255,255,0.03)', border: i === 0 ? '1px solid rgba(220,38,38,0.2)' : '1px solid transparent' }}>
                            <span style={{ fontSize: 14, flexShrink: 0 }}>{config?.icon || '🎯'}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {winnerName}
                                {i === 0 && <span style={{ marginLeft: 5, fontSize: 9, background: 'rgba(220,38,38,0.3)', color: '#fca5a5', borderRadius: 4, padding: '1px 4px', fontFamily: 'Orbitron, monospace', fontWeight: 700 }}>LATEST</span>}
                              </span>
                              <span style={{ color: '#64748b', fontSize: 10 }}>{config?.name} · {timeLabel}</span>
                            </div>
                            <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, fontWeight: 700, color: '#fbbf24', flexShrink: 0 }}>+{pool.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {isMobile ? (
                  <div className="text-center py-2 px-2">
                    <h2 className="text-base font-bold text-white mb-2">Spin Rooms</h2>
                    <p className="text-xs text-slate-400">
                      3 players • Higher bet = better odds
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-red-700 to-purple-700 rounded-full mb-3" style={{boxShadow: '0 0 20px rgba(220,38,38,0.4)'}}>
                      <Users className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-3xl font-bold mb-2 spinwar-title">
                      Choose Your Spin Room
                    </h2>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                      Join one of our six exclusive rooms where 3 players spin for the prize!
                      <br />
                      <span className="font-medium" style={{color: 'var(--sw-gold)'}}>Higher bet = Better winning odds!</span>
                    </p>
                  </div>
                )}

                <div className={`grid gap-3 w-full ${isMobile ? 'grid-cols-1 px-1' : 'lg:grid-cols-3 md:grid-cols-2 grid-cols-1 max-w-7xl mx-auto'}`}>
                  {['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite'].map((roomType) => {
                    const room = rooms.find(r => r.room_type === roomType) || { players_count: 0 };
                    const config = ROOM_CONFIGS[roomType];

                    return (
                      <Card key={roomType} className="spinwar-room-card overflow-hidden">
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
                                value={betAmounts[roomType] || ''}
                                onChange={(e) => {
                                  console.log('📝 Bet amount changed:', e.target.value, 'for room:', roomType);
                                  setSelectedRoom(roomType);
                                  setBetAmounts(prev => ({ ...prev, [roomType]: e.target.value }));
                                }}
                                disabled={!!userActiveRooms[roomType]}
                                className="bg-slate-700 border-slate-500 text-white text-center h-9 text-sm placeholder:text-slate-400 focus:border-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              />

                              <Button
                                onClick={async () => {
                                  console.log('🔘 MOBILE Join button clicked!', {
                                    roomType,
                                    betAmount: betAmounts[roomType],
                                    selectedRoom,
                                    userBalance: user?.token_balance,
                                    playersCount: room.players_count,
                                    roomStatus: room.status
                                  });
                                  promptJoinRoom(roomType);
                                  console.log('🔘 Join room function completed');
                                }}
                                disabled={!userActiveRooms[roomType] && (room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmounts[roomType] || parseInt(betAmounts[roomType]) < config.min || parseInt(betAmounts[roomType]) > config.max || user.token_balance < parseInt(betAmounts[roomType]))}
                                className={`w-full h-9 text-white font-semibold text-sm ${
                                  userActiveRooms[roomType] ? 'bg-blue-600 hover:bg-blue-700' :
                                  (room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmounts[roomType] || parseInt(betAmounts[roomType]) < config.min || parseInt(betAmounts[roomType]) > config.max || user.token_balance < parseInt(betAmounts[roomType]))
                                    ? 'bg-slate-600 cursor-not-allowed'
                                    : 'spinwar-btn-primary'
                                }`}
                              >
                                <Play className="w-3 h-3 mr-1" />
                                {userActiveRooms[roomType] ? '↩️ Return to Room' :
                                 room.status === 'playing' || room.status === 'finished' ? '🔒 FULL - Game in Progress' :
                                 room.players_count >= 3 ? 'Full' :
                                 !betAmounts[roomType] ? 'Enter Bet' :
                                 parseInt(betAmounts[roomType]) < config.min || parseInt(betAmounts[roomType]) > config.max ? 'Invalid' :
                                 user.token_balance < parseInt(betAmounts[roomType]) ? 'Low Balance' : 'Join'}
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
                                <>
                                  {room.players_count === 0 && (
                                    <p className="text-slate-400 text-sm text-center">No players yet. Be the first to join!</p>
                                  )}
                                  {room.players_count === 1 && (
                                    <p className="text-purple-400 text-sm text-center font-medium">1 player waiting. Join now!</p>
                                  )}
                                  {room.players_count >= 3 && (
                                    <p className="text-red-400 text-sm text-center font-medium">Room full - game in progress</p>
                                  )}
                                </>

                                <div className="space-y-3">
                                  <Input
                                    type="number"
                                    placeholder={`Bet amount (${config.min}-${config.max})`}
                                    value={betAmounts[roomType] || ''}
                                    onChange={(e) => {
                                      setSelectedRoom(roomType);
                                      setBetAmounts(prev => ({ ...prev, [roomType]: e.target.value }));
                                    }}
                                    min={config.min}
                                    max={config.max}
                                    disabled={!!userActiveRooms[roomType]}
                                    className="bg-slate-700 border-slate-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  />

                                  <Button
                                    onClick={async () => {
                                      console.log('🖥️ DESKTOP Join button clicked!', {
                                        roomType,
                                        betAmount: betAmounts[roomType],
                                        selectedRoom,
                                        userBalance: user?.token_balance,
                                        playersCount: room.players_count,
                                        roomStatus: room.status
                                      });
                                      promptJoinRoom(roomType);
                                      console.log('🖥️ Join room function completed');
                                    }}
                                    disabled={!userActiveRooms[roomType] && (room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmounts[roomType] || parseInt(betAmounts[roomType]) < config.min || parseInt(betAmounts[roomType]) > config.max || user.token_balance < parseInt(betAmounts[roomType]))}
                                    className={`w-full ${
                                      userActiveRooms[roomType] ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600' :
                                      (room.status === 'playing' || room.status === 'finished' || room.players_count >= 3 || !betAmounts[roomType] || parseInt(betAmounts[roomType]) < config.min || parseInt(betAmounts[roomType]) > config.max || user.token_balance < parseInt(betAmounts[roomType]))
                                        ? 'bg-slate-600 cursor-not-allowed'
                                        : 'spinwar-btn-primary'
                                    } text-white font-bold py-3`}
                                  >
                                    <Play className="w-4 h-4 mr-2" />
                                    {userActiveRooms[roomType] ? '↩️ Return to Room' :
                                     room.status === 'playing' || room.status === 'finished' ? '🔒 FULL - Game in Progress' :
                                     room.players_count >= 3 ? 'Room Full' :
                                     !betAmounts[roomType] ? 'Enter Bet Amount' :
                                     parseInt(betAmounts[roomType]) < config.min || parseInt(betAmounts[roomType]) > config.max ? 'Invalid Amount' :
                                     user.token_balance < parseInt(betAmounts[roomType]) ? 'Insufficient Tokens' : 'Join Spin'}
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
                <div className="space-y-3 max-w-full px-1">
                  {/* Balance Card */}
                  <div style={{ background: 'linear-gradient(135deg, #1a0320 0%, #0d0d1a 100%)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Wallet className="w-4 h-4" style={{ color: '#a855f7' }} />
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Your Balance</span>
                    </div>
                    <div className="text-2xl font-black text-yellow-400" style={{ fontFamily: 'Orbitron, monospace' }}>{(user.token_balance || 0).toLocaleString()}</div>
                    <div className="text-xs text-slate-500">SW Tokens</div>
                  </div>

                  {/* Add Tokens Button */}
                  <button
                    onClick={() => setShowPaymentModal(true)}
                    style={{ width: '100%', background: 'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)', border: 'none', borderRadius: 10, padding: '10px 16px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 0 16px rgba(220,38,38,0.4)' }}
                  >
                    <Zap className="w-4 h-4" />
                    + Add Tokens
                  </button>
                  <p className="text-xs text-slate-500 text-center">⚡ Solana Mainnet · Real SOL payments</p>

                  {/* Package grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {[500, 1000, 2000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => {
                          if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
                          setShowPaymentModal(true);
                          setPaymentEurAmount(amount / 100);
                        }}
                        style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a20 100%)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 10, padding: '10px 6px', color: 'white', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(220,38,38,0.8)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(220,38,38,0.35)'}
                      >
                        <div className="text-yellow-400 font-black text-base" style={{ fontFamily: 'Orbitron, monospace' }}>{amount}</div>
                        <div className="text-slate-400 text-xs">tokens</div>
                        <div style={{ marginTop: 4, background: 'rgba(220,38,38,0.2)', borderRadius: 6, padding: '2px 6px', display: 'inline-block', fontSize: 11, color: '#f87171' }}>€{(amount / 100).toFixed(0)}</div>
                      </button>
                    ))}
                  </div>

                  {/* Info box */}
                  <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: '10px 12px' }}>
                    <p className="text-xs text-slate-400 text-center">
                      <span style={{ color: '#a855f7', fontWeight: 600 }}>1 EUR = 100 tokens</span> · Auto-credited in 1–2 min
                    </p>
                  </div>

                  {/* Buy Items with Tokens */}
                  <div style={{ borderTop: '1px solid rgba(220,38,38,0.15)', paddingTop: 12 }}>
                    <p className="text-xs text-slate-500 text-center mb-2">Spend your tokens in the shop</p>
                    <button
                      onClick={() => {
                        const startParam = `spinwar_${user.telegram_id}`;
                        if (window.Telegram?.WebApp?.openTelegramLink) {
                          window.Telegram.WebApp.openTelegramLink(`https://t.me/SpinWarPlayBot?start=${startParam}`);
                        } else {
                          window.open(`https://t.me/SpinWarPlayBot?start=${startParam}`, '_blank');
                        }
                      }}
                      style={{ width: '100%', background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 10, padding: '10px 16px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                    >
                      🛍️ Buy Items with Tokens
                    </button>
                    <p className="text-xs text-slate-600 text-center mt-1">Balance: {user.token_balance || 0} tokens available</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 max-w-2xl mx-auto">
                  {/* Balance Card */}
                  <div style={{ background: 'linear-gradient(135deg, #1a0320 0%, #0d0d1a 100%)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Wallet className="w-4 h-4" style={{ color: '#a855f7' }} />
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Balance</span>
                      </div>
                      <div className="text-4xl font-black text-yellow-400" style={{ fontFamily: 'Orbitron, monospace' }}>{(user.token_balance || 0).toLocaleString()}</div>
                      <div className="text-xs text-slate-500 mt-1">SpinWar Tokens</div>
                    </div>
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      style={{ marginLeft: 'auto', background: 'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)', border: 'none', borderRadius: 10, padding: '10px 20px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 0 16px rgba(220,38,38,0.4)', whiteSpace: 'nowrap' }}
                    >
                      <Zap className="w-4 h-4" /> + Add Tokens
                    </button>
                  </div>

                  {/* Package grid */}
                  <div style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 14, padding: '20px' }}>
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-3">Quick Buy</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {[500, 1000, 2000, 5000].map(amount => (
                        <button
                          key={amount}
                          onClick={() => { setShowPaymentModal(true); setPaymentEurAmount(amount / 100); }}
                          style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a0a20 100%)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 10, padding: '12px 8px', color: 'white', cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                          <div className="text-yellow-400 font-black text-lg" style={{ fontFamily: 'Orbitron, monospace' }}>{amount}</div>
                          <div className="text-slate-400 text-xs mb-1">tokens</div>
                          <div style={{ background: 'rgba(220,38,38,0.2)', borderRadius: 6, padding: '2px 8px', display: 'inline-block', fontSize: 12, color: '#f87171' }}>€{(amount / 100).toFixed(0)}</div>
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-3">
                      <Input
                        type="number"
                        placeholder="Custom amount (min 100)"
                        min="100"
                        style={{ background: '#0a0a12', border: '1px solid rgba(124,58,237,0.3)', color: 'white', borderRadius: 8, fontSize: 13 }}
                        onChange={(e) => setPaymentTokenAmount(parseInt(e.target.value) || 100)}
                      />
                      <button
                        onClick={() => setShowPaymentModal(true)}
                        style={{ background: 'linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)', border: 'none', borderRadius: 8, padding: '8px 18px', color: 'white', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        <Zap className="w-3.5 h-3.5" /> Buy
                      </button>
                    </div>

                    <div style={{ marginTop: 16, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                      <p className="text-xs text-slate-400 mb-2 font-semibold" style={{ color: '#a855f7' }}>How it works</p>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• Pick a package or enter a custom amount</li>
                        <li>• Send SOL to the generated address (20 min timer)</li>
                        <li>• Tokens credited automatically in 1–2 min</li>
                        <li>• <span style={{ color: '#a855f7', fontWeight: 600 }}>1 EUR = 100 tokens</span> (live SOL/EUR rate)</li>
                      </ul>
                    </div>
                  </div>

                  {/* Buy Items with Tokens - Desktop */}
                  <div style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 14, padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <p className="text-sm font-bold text-white mb-1">🛍️ Shop — Buy Items with Tokens</p>
                      <p className="text-xs text-slate-400">Use your SpinWar tokens to purchase items in the shop</p>
                      <p className="text-xs mt-1" style={{ color: '#a855f7' }}>Available: <span className="font-bold text-yellow-400">{(user.token_balance || 0).toLocaleString()} tokens</span></p>
                    </div>
                    <button
                      onClick={() => {
                        const startParam = `spinwar_${user.telegram_id}`;
                        if (window.Telegram?.WebApp?.openTelegramLink) {
                          window.Telegram.WebApp.openTelegramLink(`https://t.me/SpinWarPlayBot?start=${startParam}`);
                        } else {
                          window.open(`https://t.me/SpinWarPlayBot?start=${startParam}`, '_blank');
                        }
                      }}
                      style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 10, padding: '10px 20px', color: 'white', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}
                    >
                      🛍️ Open Shop
                    </button>
                  </div>
                </div>
              )
            )}

            {/* Admin Panel Tab */}
            {activeTab === 'admin' && (user?.is_admin || user?.is_owner || user?.telegram_id === 7983427898) && (
              <AdminPanel API={API} rooms={rooms} isMobile={isMobile} />
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <div>
                    <CardTitle className="flex items-center gap-2 text-blue-400">
                      <Timer className="w-5 h-5" />
                      Game History
                    </CardTitle>
                    <CardDescription>Recent completed games</CardDescription>
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
                              <Badge className={isUserWinner ? 'bg-gradient-to-r from-yellow-400 to-gold-500 text-slate-900 font-bold border border-gold-600' : 'bg-slate-600 text-white border border-slate-500'}>
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
        <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 backdrop-blur-sm border-t z-50" style={{background: 'rgba(8,8,16,0.95)', borderColor: 'rgba(220,38,38,0.3)'}}>
          <div className="flex justify-evenly items-center py-3 px-2 safe-area-inset-bottom max-w-md mx-auto">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex flex-col items-center p-3 rounded-xl transition-all duration-200 min-w-[100px] ${
                activeTab === 'rooms'
                  ? 'text-red-400 bg-red-500/20 scale-105'
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
              className={`flex flex-col items-center p-3 rounded-xl transition-all duration-200 min-w-[80px] ${
                activeTab === 'history'
                  ? 'text-blue-400 bg-blue-400/20 scale-105'
                  : 'text-slate-300 active:bg-slate-700/50'
              }`}
            >
              <Timer className="w-7 h-7 mb-1" />
              <span className="text-sm font-semibold">History</span>
            </button>
            {(user?.is_admin || user?.is_owner || user?.telegram_id === 7983427898) && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex flex-col items-center p-3 rounded-xl transition-all duration-200 min-w-[80px] ${
                  activeTab === 'admin'
                    ? 'text-red-400 bg-red-400/20 scale-105'
                    : 'text-slate-300 active:bg-slate-700/50'
                }`}
              >
                <Crown className="w-7 h-7 mb-1" />
                <span className="text-sm font-semibold">Admin</span>
              </button>
            )}
          </div>
        </nav>
      )}

      <Toaster richColors position={isMobile ? "top-center" : "top-right"} />

      {/* Floating Reactions Overlay */}
      {floatingReactions.map(r => (
        <div key={r.id} style={{ position: 'fixed', bottom: 120, left: `${r.x}%`, transform: 'translateX(-50%)', zIndex: 99999, pointerEvents: 'none', animation: 'reactionFloat 2.5s ease-out forwards', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' }}>{r.emoji}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600, background: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: '1px 5px', whiteSpace: 'nowrap' }}>{r.name}</span>
        </div>
      ))}

      {/* Leave & Refund Confirmation Modal */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">💸</div>
              <h2 className="text-white text-xl font-bold mb-1">Leave the room?</h2>
              <p className="text-slate-400 text-sm">
                Your bet of <span className="text-yellow-400 font-semibold">{lobbyData?.bet_amount} tokens</span> will be refunded to your balance.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmLeave(false)}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-all active:scale-95"
              >
                No, stay
              </button>
              <button
                onClick={async () => {
                  setConfirmLeave(false);
                  if (!lobbyData?.room_id || !user?.id) return;
                  try {
                    const res = await axios.post(`${API}/leave-room`, {
                      room_id: lobbyData.room_id,
                      user_id: user.id,
                    });
                    setUser(prev => ({ ...prev, token_balance: res.data.new_balance }));
                    setInLobby(false);
                    setLobbyData(null);
                    setUserActiveRooms(prev => { const next = { ...prev }; delete next[lobbyData.room_type]; return next; });
                    setActiveGameRoomId(null);
                    currentGameRoomRef.current = null;
                    sessionStorage.removeItem('active_game_room');
                    toast.success(`💸 Left room — ${res.data.refund} tokens refunded`);
                    loadRooms();
                  } catch (err) {
                    toast.error(err.response?.data?.detail || 'Could not leave room');
                  }
                }}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold transition-all active:scale-95"
              >
                Yes, leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anonymous Choice Modal */}
      {anonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white text-xl font-bold text-center mb-1">How do you want to play?</h2>
            <p className="text-slate-400 text-sm text-center mb-6">Choose your identity for this game</p>
            <div className="space-y-3">
              <button
                onClick={() => { setAnonModal(null); joinRoom(anonModal.roomType, false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all active:scale-95"
              >
                {user?.photo_url ? (
                  <img src={user.photo_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-400 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {user?.first_name?.[0] || '?'}
                  </div>
                )}
                <div className="text-left">
                  <div className="text-white font-semibold">{user?.first_name} {user?.last_name || ''}</div>
                  {user?.telegram_username && <div className="text-blue-200 text-xs">@{user.telegram_username}</div>}
                </div>
              </button>
              <button
                onClick={() => { setAnonModal(null); joinRoom(anonModal.roomType, true); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-all active:scale-95 border border-slate-500"
              >
                <div className="w-8 h-8 rounded-full bg-slate-500 flex items-center justify-center text-2xl flex-shrink-0">🥷</div>
                <div className="text-left">
                  <div className="text-white font-semibold">Play Anonymously</div>
                  <div className="text-slate-400 text-xs">Others will see you as "Anonymous"</div>
                </div>
              </button>
            </div>
            <button
              onClick={() => setAnonModal(null)}
              className="w-full mt-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >Cancel</button>
          </div>
        </div>
      )}

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

function AdminPanel({ API, rooms, isMobile }) {
  const ADMIN_KEY = 'PRODUCTION_CLEANUP_2025';
  const [tgId, setTgId] = React.useState('');
  const [tokenAmount, setTokenAmount] = React.useState('');
  const [userInfo, setUserInfo] = React.useState(null);
  const [lookupLoading, setLookupLoading] = React.useState(false);
  const [fakeRoom, setFakeRoom] = React.useState('bronze');
  const [fakeName, setFakeName] = React.useState('');
  const [fakeBet, setFakeBet] = React.useState('');
  const [userList, setUserList] = React.useState([]);
  const [searchTerm, setSearchTerm] = React.useState('');

  const lookupUser = async () => {
    if (!tgId) return;
    setLookupLoading(true);
    setUserInfo(null);
    try {
      const r = await axios.get(`${API}/users/telegram/${tgId}`);
      setUserInfo(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'User not found');
    } finally {
      setLookupLoading(false);
    }
  };

  const adjustTokens = async (delta) => {
    const amt = parseInt(tokenAmount);
    if (!tgId || !amt) return toast.error('Enter Telegram ID and token amount');
    try {
      const r = await axios.post(`${API}/admin/adjust-tokens/${tgId}?admin_key=${ADMIN_KEY}&tokens=${delta * amt}`);
      toast.success(`✅ ${delta > 0 ? 'Added' : 'Removed'} ${amt} tokens. New balance: ${r.data.new_balance}`);
      setUserInfo(prev => prev ? { ...prev, token_balance: r.data.new_balance } : null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const addFakePlayer = async () => {
    if (!fakeName || !fakeBet) return toast.error('Enter name and bet amount');
    try {
      const r = await axios.post(
        `${API}/admin/add-fake-player?room_type=${fakeRoom}&player_name=${encodeURIComponent(fakeName)}&bet_amount=${fakeBet}&admin_key=${ADMIN_KEY}`
      );
      toast.success(`✅ ${r.data.message}. Players: ${r.data.players_count}/3`);
      setFakeName('');
      setFakeBet('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to add fake player');
    }
  };

  const loadUsers = async () => {
    try {
      const r = await axios.get(`${API}/admin/list-users?admin_key=${ADMIN_KEY}&limit=20&search=${encodeURIComponent(searchTerm)}`);
      setUserList(r.data.users);
    } catch (e) {
      toast.error('Failed to load users');
    }
  };

  const ROOM_MIN_BETS = { bronze: 200, silver: 350, gold: 650, platinum: 1200, diamond: 2400, elite: 4500 };

  return (
    <div className="space-y-4 pb-6">
      <div className="text-center py-2">
        <h2 className="text-xl font-bold text-red-400">🛡️ Admin Panel</h2>
        <p className="text-xs text-slate-500">Only visible to admins</p>
      </div>

      {/* Token Management */}
      <div className="bg-slate-800/90 border border-red-700/40 rounded-xl p-4 space-y-3">
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2">
          <span>💰</span> Token Management
        </h3>
        <div className="flex gap-2">
          <input
            type="number"
            value={tgId}
            onChange={e => setTgId(e.target.value)}
            placeholder="Telegram ID"
            className="flex-1 bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 min-w-0"
          />
          <button
            onClick={lookupUser}
            disabled={lookupLoading}
            className="bg-slate-600 hover:bg-slate-500 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap"
          >
            {lookupLoading ? '...' : 'Lookup'}
          </button>
        </div>
        {userInfo && (
          <div className="bg-slate-700/50 rounded-lg p-2 text-xs text-slate-300">
            <span className="text-white font-semibold">{userInfo.first_name}</span>
            {userInfo.username && <span className="text-slate-400"> @{userInfo.username}</span>}
            <span className="ml-2 text-yellow-400 font-bold">{userInfo.token_balance} tokens</span>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="number"
            value={tokenAmount}
            onChange={e => setTokenAmount(e.target.value)}
            placeholder="Amount"
            className="flex-1 bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 min-w-0"
          />
          <button
            onClick={() => adjustTokens(1)}
            className="bg-green-700 hover:bg-green-600 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap"
          >
            + Add
          </button>
          <button
            onClick={() => adjustTokens(-1)}
            className="bg-red-700 hover:bg-red-600 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap"
          >
            − Remove
          </button>
        </div>
      </div>

      {/* Add Fake Player to Room */}
      <div className="bg-slate-800/90 border border-red-700/40 rounded-xl p-4 space-y-3">
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2">
          <span>🤖</span> Add Fake Player to Room
        </h3>
        <select
          value={fakeRoom}
          onChange={e => { setFakeRoom(e.target.value); setFakeBet(String(ROOM_MIN_BETS[e.target.value])); }}
          className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
        >
          {['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite'].map(r => (
            <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)} (min {ROOM_MIN_BETS[r]})</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="text"
            value={fakeName}
            onChange={e => setFakeName(e.target.value)}
            placeholder="Bot name (e.g. Alex)"
            className="flex-1 bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 min-w-0"
          />
          <input
            type="number"
            value={fakeBet}
            onChange={e => setFakeBet(e.target.value)}
            placeholder="Bet"
            className="w-24 bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
          />
        </div>
        <button
          onClick={addFakePlayer}
          className="w-full bg-purple-700 hover:bg-purple-600 text-white text-sm py-2 rounded-lg font-semibold"
        >
          Add Bot to Room
        </button>
        {/* Live room status */}
        <div className="grid grid-cols-3 gap-1">
          {rooms.filter(r => r.status === 'waiting').map(r => (
            <div key={r.room_type} className="bg-slate-700/50 rounded p-1 text-center text-xs">
              <div className="text-white capitalize">{r.room_type}</div>
              <div className="text-yellow-400">{r.players_count || 0}/3</div>
            </div>
          ))}
        </div>
      </div>

      {/* User Search */}
      <div className="bg-slate-800/90 border border-red-700/40 rounded-xl p-4 space-y-3">
        <h3 className="text-red-400 font-bold text-sm flex items-center gap-2">
          <span>👥</span> Users (top by balance)
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by name or username"
            className="flex-1 bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 min-w-0"
          />
          <button
            onClick={loadUsers}
            className="bg-blue-700 hover:bg-blue-600 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap"
          >
            Search
          </button>
        </div>
        {userList.length > 0 && (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {userList.map(u => (
              <div
                key={u.telegram_id}
                className="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2 text-xs cursor-pointer hover:bg-slate-600/50"
                onClick={() => { setTgId(String(u.telegram_id)); setUserInfo(u); }}
              >
                <div>
                  <span className="text-white font-semibold">{u.first_name}</span>
                  {u.username && <span className="text-slate-400 ml-1">@{u.username}</span>}
                  <span className="text-slate-500 ml-1">#{u.telegram_id}</span>
                </div>
                <span className="text-yellow-400 font-bold ml-2 whitespace-nowrap">{u.token_balance} tkn</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;