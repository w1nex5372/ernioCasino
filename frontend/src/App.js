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
  const [gameHistory, setGameHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [userPrizes, setUserPrizes] = useState([]);
  
  // UI state
  const [activeTab, setActiveTab] = useState('rooms');
  const [isMobile, setIsMobile] = useState(false);
  const [casinoWalletAddress, setCasinoWalletAddress] = useState('Loading...');

  // Form state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmount, setBetAmount] = useState('');

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setIsMobile(width < 768 || (width < 1024 && height > width));
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
      loadRooms();
    });

    newSocket.on('game_starting', (data) => {
      console.log('🎮 Game starting:', data);
      toast.info(`🎮 Game starting in ${data.room_type} room!`);
      setActiveRoom(data);
    });

    newSocket.on('game_finished', (data) => {
      console.log('🏁 Game finished:', data);
      toast.success(`🏆 Game finished! Winner: ${data.winner_name}`);
      setActiveRoom(null);
      loadRooms();
      loadGameHistory();
      loadLeaderboard();
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
    // Clear any cached data
    localStorage.clear();
    sessionStorage.clear();
    
    loadRooms();
    loadGameHistory();
    loadLeaderboard();
    
    // Telegram authentication
    const authenticateFromTelegram = async () => {
      try {
        console.log('🔍 Initializing Telegram Web App authentication...');
        
        // Quick check - if no Telegram, use demo mode for mobile testing
        if (typeof window.Telegram === 'undefined') {
          console.log('No Telegram found, activating demo mode');
          setUser({
            id: 'demo-user-123',
            first_name: 'Demo',
            last_name: 'User',
            token_balance: 1500,
            telegram_id: 123456789
          });
          setIsLoading(false);
          toast.success('Demo mode activated for testing');
          return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        if (!window.Telegram || !window.Telegram.WebApp) {
          throw new Error('This casino must be opened through Telegram');
        }
        
        const webApp = window.Telegram.WebApp;
        
        // Check for valid user data
        if (!webApp.initData && (!webApp.initDataUnsafe || !webApp.initDataUnsafe.user)) {
          throw new Error('This casino must be opened through Telegram');
        }
        
        console.log('📱 Telegram WebApp detected');
        
        webApp.ready();
        webApp.expand();
        
        const telegramUser = webApp.initDataUnsafe?.user;
        if (!telegramUser || !telegramUser.id) {
          throw new Error('No Telegram user data available');
        }
        
        const authData = {
          id: parseInt(telegramUser.id),
          first_name: telegramUser.first_name || 'Telegram User',
          last_name: telegramUser.last_name || null,
          username: telegramUser.username || null,
          photo_url: telegramUser.photo_url || null,
          auth_date: Math.floor(Date.now() / 1000),
          hash: 'telegram_webapp',
          telegram_id: parseInt(telegramUser.id)
        };

        const response = await axios.post(`${API}/auth/telegram`, {
          telegram_auth_data: authData
        }, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        });
        
        setUser(response.data);
        setIsLoading(false);
        
        toast.success(`Welcome to Casino Battle, ${telegramUser.first_name}!`);
        
        webApp.enableClosingConfirmation();
        if (webApp.setHeaderColor) webApp.setHeaderColor('#1e293b');
        if (webApp.setBackgroundColor) webApp.setBackgroundColor('#0f172a');
        
        setTimeout(() => {
          loadUserPrizes();
          loadDerivedWallet();
        }, 1000);
        
      } catch (error) {
        console.error('❌ Authentication failed:', error);
        
        if (error.message.includes('Telegram')) {
          // For testing mobile layout, add a demo user
          console.log('Adding demo user for mobile layout testing');
          setUser({
            id: 'demo-user-123',
            first_name: 'Demo',
            last_name: 'User',
            token_balance: 1000,
            telegram_id: 123456789
          });
          setIsLoading(false);
          toast.success('Demo mode for mobile testing');
        } else if (error.response?.status >= 500) {
          setIsLoading(true);
          setTimeout(() => authenticateFromTelegram(), 5000);
        } else {
          setIsLoading(false);
          toast.error(`Authentication failed: ${error.message}`);
        }
      }
    };

    const initTimeout = setTimeout(authenticateFromTelegram, 200);
    return () => clearTimeout(initTimeout);
  }, []);

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

  const loadLeaderboard = async () => {
    try {
      const response = await axios.get(`${API}/leaderboard`);
      setLeaderboard(response.data.leaderboard);
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
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
            <h3 className="text-xl font-bold text-white mb-2">Telegram Required</h3>
            <p className="text-slate-400 mb-4">This casino is a Telegram Web App and must be opened through Telegram.</p>
            <div className="space-y-3 text-left">
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold">1.</span>
                <p className="text-sm text-slate-300">Open Telegram on your device</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold">2.</span>
                <p className="text-sm text-slate-300">Search for the casino bot</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 font-bold">3.</span>
                <p className="text-sm text-slate-300">Launch the Web App from Telegram</p>
              </div>
            </div>
            <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-300">
                💡 For security, this app only works within Telegram.
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
      isMobile ? 'overflow-x-hidden max-w-full' : ''
    }`}>
      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-50">
        <div className="px-4 py-3">
          {isMobile ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Crown className="w-6 h-6 text-yellow-400 flex-shrink-0" />
                <h1 className="text-lg font-bold text-white truncate">Casino Battle</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right min-w-0 flex-shrink-0">
                  <div className="text-xs text-slate-400 leading-tight">Balance</div>
                  <div className="text-sm font-bold text-yellow-400 truncate">{user.token_balance || 0}</div>
                </div>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
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
          <nav className="w-64 bg-slate-800/50 backdrop-blur-sm border-r border-slate-700 min-h-screen p-4">
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
                onClick={() => setActiveTab('leaderboard')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'leaderboard' 
                    ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Crown className="w-5 h-5" />
                <span>Leaderboard</span>
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
        <main className={`flex-1 ${isMobile ? 'p-3 pb-24 max-w-full overflow-x-hidden' : 'p-6'}`}>
          <div className={`${isMobile ? 'space-y-3 max-w-full' : 'space-y-6'}`}>

            {/* Welcome Card - Desktop Only */}
            {!isMobile && (
              <Card className="bg-gradient-to-r from-green-600/20 to-emerald-600/20 border-green-500/30">
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

            {/* Battle Rooms Tab */}
            {activeTab === 'rooms' && (
              <div className="space-y-6">
                {isMobile ? (
                  <div className="text-center py-3 px-4">
                    <h2 className="text-lg font-bold text-white mb-2 leading-tight">Casino Rooms</h2>
                    <p className="text-xs text-slate-400 leading-relaxed">
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
                
                <div className={`grid gap-4 md:gap-8 max-w-7xl mx-auto ${isMobile ? 'grid-cols-1 px-2' : 'lg:grid-cols-3 md:grid-cols-2 grid-cols-1'}`}>
                  {['bronze', 'silver', 'gold'].map((roomType) => {
                    const room = rooms.find(r => r.room_type === roomType) || { players_count: 0 };
                    const config = ROOM_CONFIGS[roomType];
                    
                    return (
                      <Card key={roomType} className={`bg-slate-800/90 border-slate-700 overflow-hidden hover:border-yellow-500/50 transition-all duration-300 ${
                        isMobile ? 'max-w-full w-full mx-auto' : ''
                      }`}>
                        <CardHeader className={`bg-gradient-to-br ${config.gradient} text-white relative overflow-hidden`}>
                          <div className="absolute inset-0 bg-black/10"></div>
                          <div className="relative z-10">
                            <div className={`flex items-center justify-between mb-2 ${isMobile ? 'flex-col gap-3' : ''}`}>
                              <div className="flex items-center gap-3">
                                <div className={`${isMobile ? 'w-10 h-10' : 'w-12 h-12'} bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm`}>
                                  <span className={`${isMobile ? 'text-xl' : 'text-2xl'}`}>{config.icon}</span>
                                </div>
                                <div className={isMobile ? 'text-center' : ''}>
                                  <CardTitle className={`${isMobile ? 'text-base' : 'text-xl'} font-bold leading-tight`}>
                                    {config.name}
                                  </CardTitle>
                                  <CardDescription className={`text-white/90 font-medium ${isMobile ? 'text-xs' : ''} leading-tight`}>
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
                                onClick={() => joinRoom(roomType)}
                                disabled={room.players_count >= 2 || !betAmount || user.token_balance < betAmount}
                                className={`w-full ${
                                  room.players_count >= 2 
                                    ? 'bg-slate-600 cursor-not-allowed' 
                                    : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600'
                                } text-white font-bold py-3`}
                              >
                                <Play className="w-4 h-4 mr-2" />
                                {room.players_count >= 2 ? 'Room Full' : 'Join Battle'}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Token Purchase Tab */}
            {activeTab === 'tokens' && (
              isMobile ? (
                <div className="space-y-4">
                  <Card className="bg-slate-800/90 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <h2 className="text-lg font-bold text-white mb-2">Token Balance</h2>
                      <div className="text-2xl font-bold text-yellow-400">{user.token_balance || 0}</div>
                      <div className="text-sm text-slate-400">tokens</div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800/90 border-slate-700">
                    <CardContent className="p-4">
                      <h3 className="text-center text-white font-semibold mb-3 leading-tight">Your Personal Address</h3>
                      <div className="bg-slate-900 p-3 rounded-lg mb-3 overflow-hidden">
                        <code className="text-green-400 text-xs font-mono break-all block text-center leading-relaxed">
                          {casinoWalletAddress}
                        </code>
                      </div>
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(casinoWalletAddress);
                          toast.success('Address copied!');
                        }}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3"
                      >
                        📋 Copy Address
                      </Button>
                      <div className="mt-3 p-2 bg-green-500/10 border border-green-500/20 rounded text-center">
                        <p className="text-xs text-green-300">
                          Send SOL here → Get tokens automatically!
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Rate based on current SOL/EUR price
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

            {/* Leaderboard Tab */}
            {activeTab === 'leaderboard' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-yellow-400">
                    <Crown className="w-5 h-5" />
                    Leaderboard
                  </CardTitle>
                  <CardDescription>Top players by total winnings</CardDescription>
                </CardHeader>
                <CardContent>
                  {leaderboard.length === 0 ? (
                    <p className="text-center text-slate-400 py-8">No games played yet. Be the first to compete!</p>
                  ) : (
                    <div className="space-y-2">
                      {leaderboard.map((player, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center font-bold text-slate-900">
                              {index + 1}
                            </div>
                            <div>
                              <div className="font-medium text-white">{player.first_name}</div>
                              <div className="text-sm text-slate-400">{player.games_won} wins</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-yellow-400">{player.total_winnings}</div>
                            <div className="text-xs text-slate-400">tokens</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
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
                      {userPrizes.map((prize, index) => (
                        <div key={index} className="p-4 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded-lg">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{ROOM_CONFIGS[prize.room_type]?.icon}</span>
                              <span className="font-medium text-white capitalize">{prize.room_type} Room Win</span>
                            </div>
                            <Badge className="bg-purple-500 text-white">Won</Badge>
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
        <nav className="fixed bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 z-50">
          <div className="flex justify-around items-center py-3 px-2">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 min-w-0 ${
                activeTab === 'rooms' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Users className="w-5 h-5 mb-1" />
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
              <Coins className="w-5 h-5 mb-1" />
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
              <Trophy className="w-5 h-5 mb-1" />
              <span className="text-xs font-medium leading-tight">Prizes</span>
              {userPrizes.length > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {userPrizes.length}
                </div>
              )}
            </button>
            
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 min-w-0 ${
                activeTab === 'leaderboard' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Crown className="w-5 h-5 mb-1" />
              <span className="text-xs font-medium leading-tight">Leaders</span>
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 min-w-0 ${
                activeTab === 'history' 
                  ? 'text-blue-400 bg-blue-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Timer className="w-5 h-5 mb-1" />
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