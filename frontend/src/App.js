import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
// Removed Tabs - using custom sidebar navigation
import { Progress } from './components/ui/progress';
import { Separator } from './components/ui/separator';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';
import { Crown, Coins, Users, Trophy, Zap, Wallet, Play, Timer } from 'lucide-react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ** EDIT THIS LINE TO ADD YOUR SOLANA WALLET ADDRESS **
const [casinoWalletAddress, setCasinoWalletAddress] = useState('Loading...');

// ** EDIT THESE LINES TO ADD YOUR PRIZE LINKS **
const PRIZE_LINKS = {
  bronze: "https://your-prize-link-1.com",  // Prize link for Bronze room
  silver: "https://your-prize-link-2.com",  // Prize link for Silver room  
  gold: "https://your-prize-link-3.com"     // Prize link for Gold room
};

const ROOM_CONFIGS = {
  bronze: { 
    name: 'Bronze Room', 
    color: 'bg-amber-700', 
    icon: '🥉', 
    min: 150, 
    max: 450,
    gradient: 'from-amber-600 to-amber-800'
  },
  silver: { 
    name: 'Silver Room', 
    color: 'bg-slate-400', 
    icon: '🥈', 
    min: 500, 
    max: 1500,
    gradient: 'from-slate-400 to-slate-600'
  },
  gold: { 
    name: 'Gold Room', 
    color: 'bg-yellow-500', 
    icon: '🥇', 
    min: 2000, 
    max: 8000,
    gradient: 'from-yellow-400 to-yellow-600'
  }
};

function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [gameHistory, setGameHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showTokenPurchase, setShowTokenPurchase] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Form states
  const [username, setUsername] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [solAmount, setSolAmount] = useState('');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [betAmount, setBetAmount] = useState('');
  const [activeTab, setActiveTab] = useState('rooms');
  const [walletMonitoring, setWalletMonitoring] = useState(false);
  const [lastKnownBalance, setLastKnownBalance] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [userPrizes, setUserPrizes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Check if mobile (portrait orientation specifically)
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Consider it mobile if width < 768px OR if in portrait mode on small screen
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

  useEffect(() => {
    // Initialize Socket.IO connection
    const newSocket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      toast.success('Connected to casino!');
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      toast.error('Disconnected from casino');
    });

    newSocket.on('player_joined', (data) => {
      toast.info(`${data.player.username} joined ${data.room_type} room!`);
      loadRooms();
    });

    newSocket.on('game_starting', (data) => {
      toast.success(`Game starting in ${ROOM_CONFIGS[data.room_type].name}!`);
    });

    newSocket.on('game_finished', (data) => {
      toast.success(`🎉 ${data.winner.username} won the ${ROOM_CONFIGS[data.room_type].name} prize!`);
      loadRooms();
      loadGameHistory();
      loadLeaderboard();
    });

    newSocket.on('prize_won', (data) => {
      if (user) {
        toast.success(`🏆 Congratulations! You won a prize! Check your prizes tab.`);
        // Show prize modal or redirect to prize link
        window.open(data.prize_link, '_blank');
      }
    });

    newSocket.on('new_room_available', (data) => {
      toast.info(`New ${ROOM_CONFIGS[data.room_type].name} is available!`);
      loadRooms();
    });

    newSocket.on('rooms_updated', (data) => {
      // Update rooms instantly without API call
      setRooms(data.rooms);
    });

    newSocket.on('token_balance_updated', (data) => {
      // Auto-update user token balance when payment is detected
      if (user && data.user_id === user.id) {
        setUser({...user, token_balance: data.new_balance});
        toast.success(`🎉 Payment confirmed! +${data.tokens_added} tokens (${data.sol_received} SOL)`);
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    loadRooms();
    loadGameHistory();
    loadLeaderboard();
    
    // Auto-authenticate if opened from Telegram
    const autoAuthenticateFromTelegram = async () => {
      try {
        console.log('🔍 Initializing Telegram Web App authentication...');
        
        // Wait for Telegram script to fully load
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if we're in Telegram environment
        if (!window.Telegram || !window.Telegram.WebApp) {
          console.error('❌ Not running in Telegram Web App environment');
          throw new Error('This casino must be opened through Telegram');
        }
        
        const webApp = window.Telegram.WebApp;
        console.log('📱 Telegram WebApp detected:', {
          version: webApp.version,
          platform: webApp.platform,
          colorScheme: webApp.colorScheme,
          isExpanded: webApp.isExpanded
        });
        
        // Initialize WebApp
        webApp.ready();
        webApp.expand();
        
        // Get user data from Telegram
        const initData = webApp.initData;
        const initDataUnsafe = webApp.initDataUnsafe;
        
        console.log('🔐 Telegram auth data:', {
          hasInitData: !!initData,
          hasInitDataUnsafe: !!initDataUnsafe,
          user: initDataUnsafe?.user
        });
        
        const user = initDataUnsafe?.user;
        if (!user || !user.id) {
          throw new Error('No Telegram user data available');
        }
        
        console.log('👤 Telegram user found:', {
          id: user.id,
          first_name: user.first_name,
          username: user.username
        });
        
        // Prepare authentication data
        const authData = {
          id: parseInt(user.id),
          first_name: user.first_name || 'Telegram User',
          last_name: user.last_name || null,
          username: user.username || null,
          photo_url: user.photo_url || null,
          auth_date: Math.floor(Date.now() / 1000),
          hash: 'telegram_webapp',
          telegram_id: parseInt(user.id) // Ensure telegram_id is set for notifications
        };

        console.log('📤 Sending auth data to backend:', authData);

        // Authenticate with backend
        const response = await axios.post(`${API}/auth/telegram`, {
          telegram_auth_data: authData
        }, {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        console.log('✅ Authentication successful:', response.data);
        
        // Set user and stop loading
        setUser(response.data);
        setIsLoading(false);
        
        // Show welcome message
        toast.success(`🎰 Welcome to Casino Battle, ${user.first_name}!`);
        
        // Configure WebApp settings
        webApp.enableClosingConfirmation();
        if (webApp.setHeaderColor) {
          webApp.setHeaderColor('#1e293b');
        }
        if (webApp.setBackgroundColor) {
          webApp.setBackgroundColor('#0f172a');
        }
        
        // Load user data
        setTimeout(() => {
          loadUserPrizes();
          loadPersonalWallet();
        }, 1000);
        
        return true;
        
      } catch (error) {
        console.error('❌ Telegram authentication failed:', error);
        
        // Show error and keep in loading state (don't show manual login)
        setIsLoading(true);
        
        if (error.message.includes('Telegram')) {
          toast.error('❌ Please open this casino through Telegram');
        } else if (error.response?.status >= 500) {
          toast.error('🔧 Server error - please try again in a moment');
        } else {
          toast.error(`🚫 Authentication failed: ${error.message}`);
        }
        
        // Retry after delay
        setTimeout(() => {
          console.log('🔄 Retrying authentication...');
          autoAuthenticateFromTelegram();
        }, 5000);
        
        return false;
      }
    };

    // Auto-authenticate from Telegram on app load - Telegram ONLY
    let mounted = true;
    
    const initializeCasino = async () => {
      if (!mounted) return;
      
      console.log('🎰 Starting Casino Battle Royale...');
      
      // Only try Telegram authentication - no fallback
      await autoAuthenticateFromTelegram();
    };

    // Start authentication immediately
    const initTimeout = setTimeout(initializeCasino, 500);

    return () => {
      mounted = false;
      clearTimeout(initTimeout);
    };
  }, []);

  const loadRooms = async () => {
    try {
      const response = await axios.get(`${API}/rooms`);
      setRooms(response.data.rooms);
    } catch (error) {
      console.error('Failed to load rooms:', error);
      toast.error('Failed to load rooms');
    }
  };

  const loadPersonalWallet = async () => {
    try {
      if (!user || !user.id) {
        console.log('No user ID available for wallet loading');
        return;
      }
      
      const response = await axios.get(`${API}/user/${user.id}/wallet`);
      setCasinoWalletAddress(response.data.personal_wallet_address);
      console.log('👤 Personal wallet loaded:', response.data.personal_wallet_address);
      console.log('🔄 Conversion rate:', response.data.conversion_rate);
      toast.success('Personal wallet address loaded! 💳');
    } catch (error) {
      console.error('Failed to load personal wallet:', error);
      setCasinoWalletAddress('Error loading personal wallet');
      toast.error('Failed to load your personal wallet address');
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
    if (!user) return;
    try {
      const response = await axios.get(`${API}/user/${user.id}/prizes`);
      setUserPrizes(response.data.prizes);
    } catch (error) {
      console.error('Failed to load user prizes:', error);
    }
  };

  // Load prizes when user changes
  useEffect(() => {
    if (user) {
      loadUserPrizes();
    }
  }, [user]);

  const purchaseTokens = async (e) => {
    e.preventDefault();
    if (!solAmount || parseFloat(solAmount) <= 0) {
      toast.error('Please enter a valid SOL amount');
      return;
    }

    if (casinoWalletAddress === "YOUR_SOLANA_WALLET_ADDRESS_HERE") {
      toast.error('Casino wallet not configured. Using demo mode.');
      
      // Demo mode - instant credit
      const tokenAmount = Math.floor(parseFloat(solAmount) * 1000);
      try {
        const response = await axios.post(`${API}/purchase-tokens`, {
          user_id: user.id,
          sol_amount: parseFloat(solAmount),
          token_amount: tokenAmount
        });

        if (response.data.success) {
          setUser(prev => ({
            ...prev,
            token_balance: prev.token_balance + tokenAmount
          }));
          setSolAmount('');
          toast.success(`Demo: Received ${tokenAmount} tokens!`);
        }
      } catch (error) {
        console.error('Failed to purchase tokens:', error);
        toast.error(error.response?.data?.detail || 'Failed to purchase tokens');
      }
      return;
    }

    // Start monitoring wallet for the expected amount
    toast.info(`Monitoring wallet for ${solAmount} SOL payment...`);
    monitorWalletBalance(parseFloat(solAmount));
  };

  // Monitor Solana wallet balance
  const monitorWalletBalance = async (expectedAmount) => {
    if (!casinoWalletAddress || casinoWalletAddress === "YOUR_SOLANA_WALLET_ADDRESS_HERE") {
      toast.error('Casino wallet address not configured');
      return;
    }

    setWalletMonitoring(true);
    const startTime = Date.now();
    const timeout = 300000; // 5 minutes

    const checkBalance = async () => {
      try {
        // Using Solana Web3.js to check balance
        const response = await fetch(`https://api.devnet.solana.com`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [casinoWalletAddress]
          })
        });

        const data = await response.json();
        if (data.result) {
          const currentBalance = data.result.value / 1000000000; // Convert lamports to SOL
          
          if (lastKnownBalance === 0) {
            setLastKnownBalance(currentBalance);
            return;
          }

          const increase = currentBalance - lastKnownBalance;
          
          if (increase >= expectedAmount - 0.001) { // Allow small precision differences
            setWalletMonitoring(false);
            setLastKnownBalance(currentBalance);
            
            // Automatically credit tokens
            const tokenAmount = Math.floor(expectedAmount * 1000);
            try {
              const response = await axios.post(`${API}/purchase-tokens`, {
                user_id: user.id,
                sol_amount: expectedAmount,
                token_amount: tokenAmount
              });

              if (response.data.success) {
                setUser(prev => ({
                  ...prev,
                  token_balance: prev.token_balance + tokenAmount
                }));
                toast.success(`🎉 Received ${tokenAmount} tokens automatically!`);
              }
            } catch (error) {
              console.error('Failed to credit tokens:', error);
              toast.error('Payment detected but failed to credit tokens. Contact support.');
            }
            return;
          }
        }
      } catch (error) {
        console.error('Balance check failed:', error);
      }

      // Continue monitoring if timeout not reached
      if (Date.now() - startTime < timeout) {
        setTimeout(checkBalance, 10000); // Check every 10 seconds
      } else {
        setWalletMonitoring(false);
        toast.error('Payment monitoring timeout. Please contact support if you sent SOL.');
      }
    };

    // Get initial balance
    checkBalance();
  };

  // Load prizes when socket events fire
  useEffect(() => {
    if (user) {
      loadUserPrizes();
    }
  }, [user]);

  const joinRoom = async (roomType) => {
    console.log('Attempting to join room:', roomType);
    console.log('Current user:', user);
    console.log('Bet amount:', betAmount);

    if (!betAmount || parseInt(betAmount) <= 0) {
      toast.error('Please enter a valid bet amount');
      return;
    }

    const bet = parseInt(betAmount);
    const config = ROOM_CONFIGS[roomType];

    console.log('Bet validation:', { bet, min: config.min, max: config.max, userBalance: user.token_balance });

    if (bet < config.min || bet > config.max) {
      toast.error(`Bet must be between ${config.min} and ${config.max} tokens`);
      return;
    }

    if (bet > (user.token_balance || 0)) {
      toast.error('Insufficient token balance - Buy tokens first!');
      return;
    }

    if (!user.id) {
      toast.error('User not properly authenticated');
      return;
    }

    try {
      const joinData = {
        room_type: roomType,
        user_id: user.id,
        bet_amount: bet
      };

      console.log('Sending join room request:', joinData);

      const response = await axios.post(`${API}/join-room`, joinData);

      console.log('Join room response:', response.data);

      if (response.data.success) {
        setUser(prev => ({
          ...prev,
          token_balance: (prev.token_balance || 0) - bet
        }));
        setBetAmount('');
        setSelectedRoom(null);
        toast.success(`Joined ${config.name}! Position ${response.data.position}/2`);
        
        if (response.data.position === 2) {
          toast.info('🔥 Battle starting! Winner will be announced shortly...');
        }
        loadRooms();
      }
    } catch (error) {
      console.error('Failed to join room - Full error:', error);
      console.error('Error response:', error.response);
      
      let errorMessage = 'Failed to join room';
      
      if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(`Join failed: ${errorMessage}`);
    }
  };

  // Telegram Web App authentication
  const authenticateWithTelegram = async () => {
    setIsLoading(true);
    try {
      // Check if running inside Telegram Web App
      if (window.Telegram && window.Telegram.WebApp) {
        const webApp = window.Telegram.WebApp;
        webApp.ready();
        
        const initData = webApp.initData;
        if (!initData) {
          toast.error('Please open this app through Telegram');
          return;
        }

        // Parse init data
        const urlParams = new URLSearchParams(initData);
        const userParam = urlParams.get('user');
        
        if (!userParam) {
          toast.error('No user data found');
          return;
        }

        const userData = JSON.parse(userParam);
        
        // Send auth data to backend
        const response = await axios.post(`${API}/auth/telegram`, {
          telegram_auth_data: {
            id: userData.id,
            first_name: userData.first_name,
            last_name: userData.last_name,
            username: userData.username,
            photo_url: userData.photo_url,
            auth_date: Math.floor(Date.now() / 1000),
            hash: urlParams.get('hash')
          }
        });

        setUser(response.data);
        setIsLoading(false);
        toast.success(`Welcome, ${userData.first_name}!`);
        
        // Load user prizes after authentication
        setTimeout(() => {
          loadUserPrizes();
        }, 500);

      } else {
        // Fallback for non-Telegram environment
        setIsLoading(false);
        toast.error('This app must be opened through Telegram');
      }
    } catch (error) {
      console.error('Telegram auth failed:', error);
      setIsLoading(false);
      toast.error(error.response?.data?.detail || 'Authentication failed');
    }
  };

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

  // No manual login - app only works through Telegram Web App
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/90 border-slate-700">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold text-white mb-2">Loading Casino...</h3>
            <p className="text-slate-400">Connecting to Telegram Web App</p>
            <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-300">
                💡 This casino works only as a Telegram Web App. Please open through Telegram.
              </p>
            </div>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // Debug log to see user state
  console.log('Current user state:', user);

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white ${
      isMobile ? 'overflow-x-hidden max-w-full' : 'overflow-x-hidden'
    }`}>
      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-50">
        <div className="px-4 py-3">
          {isMobile ? (
            /* Mobile Header - Simplified */
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="w-6 h-6 text-yellow-400" />
                <h1 className="text-lg font-bold text-white">Casino</h1>
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
            /* Desktop Header - Full */
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown 
                  className="w-8 h-8 text-yellow-400 cursor-pointer hover:text-yellow-300 transition-colors" 
                  onClick={() => setActiveTab('rooms')}
                />
                <h1 
                  className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent cursor-pointer"
                  onClick={() => setActiveTab('rooms')}
                >
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
        {/* Sidebar Navigation - Desktop Only */}
        {!isMobile && (
          <nav className="w-64 bg-slate-800/50 backdrop-blur-sm border-r border-slate-700 min-h-screen p-4">
            <div className="space-y-2">
          <div className="space-y-2">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`w-full flex items-center ${isMobile ? 'justify-center p-3' : 'gap-3 px-4 py-3'} rounded-lg transition-all duration-200 ${
                activeTab === 'rooms' 
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="Battle Rooms"
            >
              <Users className="w-5 h-5" />
              {!isMobile && <span>Battle Rooms</span>}
            </button>
            
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`w-full flex items-center ${isMobile ? 'justify-center p-3' : 'gap-3 px-4 py-3'} rounded-lg transition-all duration-200 ${
                activeTab === 'leaderboard' 
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="Leaderboard"
            >
              <Trophy className="w-5 h-5" />
              {!isMobile && <span>Leaderboard</span>}
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`w-full flex items-center ${isMobile ? 'justify-center p-3' : 'gap-3 px-4 py-3'} rounded-lg transition-all duration-200 ${
                activeTab === 'history' 
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="History"
            >
              <Timer className="w-5 h-5" />
              {!isMobile && <span>History</span>}
            </button>
            
            <button
              onClick={() => setActiveTab('tokens')}
              className={`w-full flex items-center ${isMobile ? 'justify-center p-3' : 'gap-3 px-4 py-3'} rounded-lg transition-all duration-200 ${
                activeTab === 'tokens' 
                  ? 'bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold' 
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="Buy Tokens"
            >
              <Coins className="w-5 h-5" />
              {!isMobile && <span>Buy Tokens</span>}
            </button>
            
            <button
              onClick={() => setActiveTab('prizes')}
              className={`w-full flex items-center ${isMobile ? 'justify-center p-3' : 'gap-3 px-4 py-3'} rounded-lg transition-all duration-200 ${
                activeTab === 'prizes' 
                  ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold' 
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="My Prizes"
            >
              <Trophy className="w-5 h-5" />
              {!isMobile && <span>My Prizes</span>}
              {!isMobile && userPrizes.length > 0 && (
                <Badge className="bg-green-500 text-white">{userPrizes.length}</Badge>
              )}
            </button>
          </div>
          
          {/* Quick Stats - Only on Desktop */}
          {!isMobile && (
            <div className="mt-8 space-y-4">
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Your Balance</div>
                <div className="text-2xl font-bold text-yellow-400">{user.token_balance}</div>
                <div className="text-xs text-slate-500">Casino Tokens</div>
              </div>
            </div>
          )}
            </div>
          </nav>
        )}

        {/* Main Content */}
        <main className={`flex-1 ${isMobile ? 'p-2 pb-20 max-w-full overflow-x-hidden' : 'p-6'}`}>
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
                        <p className="text-green-200">Send SOL to get tokens for betting • Rate: 1 SOL = 1,000 tokens</p>
                        <p className="text-yellow-400 font-semibold">Your Balance: {user.token_balance || 0} tokens</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => setActiveTab('tokens')}
                      size="lg"
                      className="bg-green-600 hover:bg-green-700 text-white font-bold px-8 py-4 text-lg"
                    >
                      <Coins className="w-5 h-5 mr-2" />
                      Buy Tokens Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Battle Rooms */}
            {activeTab === 'rooms' && (
              <div className="space-y-8">
                <div className={`text-center ${isMobile ? 'py-3 px-4' : 'py-6'}`}>
                  <div className={`inline-flex items-center justify-center ${isMobile ? 'w-10 h-10' : 'w-16 h-16'} bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full mb-3`}>
                    <Users className={`${isMobile ? 'w-5 h-5' : 'w-8 h-8'} text-slate-900`} />
                  </div>
                  <h2 className={`${isMobile ? 'text-lg' : 'text-3xl'} font-bold mb-2 bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent`}>
                    {isMobile ? 'Battle Rooms' : 'Choose Your Battle Arena'}
                  </h2>
                  <p className={`text-slate-400 ${isMobile ? 'text-xs' : 'text-lg'} max-w-2xl mx-auto`}>
                    {isMobile ? '2 players compete for prizes!' : 'Join one of our three exclusive rooms where 2 players battle for the prize!'}
                    {!isMobile && <br />}
                    <span className="text-yellow-400 font-medium">
                      {isMobile ? ' Higher bet = better odds!' : 'Higher bet = Better winning odds!'}
                    </span>
                  </p>
                </div>
                
                <div className={`grid gap-4 md:gap-8 max-w-7xl mx-auto ${isMobile ? 'grid-cols-1' : 'lg:grid-cols-3 md:grid-cols-2 grid-cols-1'}`}>
                {['bronze', 'silver', 'gold'].map((roomType) => {
                  const room = rooms.find(r => r.room_type === roomType) || { players_count: 0, prize_pool: 0 };
                  const config = ROOM_CONFIGS[roomType];
                  
                  return (
                    <Card key={roomType} className={`bg-slate-800/90 border-slate-700 overflow-hidden hover:border-yellow-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-yellow-500/10 ${
                      isMobile ? 'max-w-full w-full' : ''
                    }`}>
                      <CardHeader className={`bg-gradient-to-br ${config.gradient} text-white relative overflow-hidden`}>
                        <div className="absolute inset-0 bg-black/10"></div>
                        <div className="relative z-10">
                          <div className={`flex items-center justify-between mb-2 ${isMobile ? 'flex-wrap gap-2' : ''}`}>
                            <div className="flex items-center gap-3">
                              <div className={`${isMobile ? 'w-10 h-10' : 'w-12 h-12'} bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm`}>
                                <span className={`${isMobile ? 'text-xl' : 'text-2xl'}`}>{config.icon}</span>
                              </div>
                              <div>
                                <CardTitle className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold`}>
                                  {config.name}
                                </CardTitle>
                                <CardDescription className={`text-white/90 font-medium ${isMobile ? 'text-sm' : ''}`}>
                                  {config.min} - {config.max} tokens
                                </CardDescription>
                              </div>
                            </div>
                            <Badge variant="secondary" className={`bg-white/25 text-white font-semibold backdrop-blur-sm ${
                              isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1'
                            }`}>
                              Round #{room.round_number || 1}
                            </Badge>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 mt-4">
                            <div className="bg-white/15 rounded-lg p-3 backdrop-blur-sm">
                              <div className="text-white/80 text-xs uppercase tracking-wide font-medium">Players</div>
                              <div className="text-white font-bold text-lg">{room.players_count}/2</div>
                            </div>
                            <div className="bg-white/15 rounded-lg p-3 backdrop-blur-sm">
                              <div className="text-white/80 text-xs uppercase tracking-wide font-medium">Prize Pool</div>
                              <div className="text-white font-bold text-lg">{room.prize_pool}</div>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className={`${isMobile ? 'p-4' : 'p-6'}`}>
                        <div className={`space-y-${isMobile ? '4' : '6'}`}>
                          <div className="space-y-3">
                            <div className="flex justify-between items-center">
                              <span className={`text-slate-400 font-medium ${isMobile ? 'text-sm' : ''}`}>Battle Status</span>
                              <span className={`font-bold text-yellow-400 ${isMobile ? 'text-sm' : ''}`}>{room.players_count}/2 Players</span>
                            </div>
                            
                            <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-yellow-400 to-yellow-600 h-3 rounded-full transition-all duration-500 ease-out relative"
                                style={{ width: `${(room.players_count / 2) * 100}%` }}
                              >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20"></div>
                              </div>
                            </div>
                            
                            <div className="text-center text-xs text-slate-500">
                              {room.players_count === 2 ? '🔥 Battle Starting!' : 
                               room.players_count === 1 ? '⏳ Waiting for opponent...' :
                               '🎯 Join the Battle!'}
                            </div>
                          </div>
                          
                          <Separator className="bg-slate-700" />
                          
                          {selectedRoom === roomType ? (
                            <div className="space-y-3">
                              <Input
                                type="number"
                                value={betAmount}
                                onChange={(e) => setBetAmount(e.target.value)}
                                placeholder={`Bet ${config.min}-${config.max}`}
                                className={`bg-slate-700 border-slate-600 text-white ${isMobile ? 'h-12 text-lg' : ''}`}
                                min={config.min}
                                max={config.max}
                              />
                              <div className={`flex gap-2 ${isMobile ? 'flex-col' : ''}`}>
                                <Button 
                                  onClick={() => joinRoom(roomType)}
                                  className={`flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 ${isMobile ? 'h-12 text-lg' : ''}`}
                                  disabled={room.players_count >= 2}
                                >
                                  Join Battle
                                </Button>
                                <Button 
                                  onClick={() => setSelectedRoom(null)}
                                  variant="outline"
                                  className={`border-slate-600 text-slate-300 hover:bg-slate-700 ${isMobile ? 'h-12' : ''}`}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button 
                              onClick={() => setSelectedRoom(roomType)}
                              className={`w-full bg-gradient-to-r ${config.gradient} hover:opacity-90 ${isMobile ? 'h-12 text-lg font-semibold' : ''}`}
                              disabled={room.players_count >= 2 || room.status !== 'waiting'}
                            >
                              {room.players_count >= 2 ? 'Room Full' : 
                               room.status === 'playing' ? 'Game In Progress' : 'Enter Battle'}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                </div>
              </div>
            )}

            {/* Leaderboard */}
            {activeTab === 'leaderboard' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-yellow-400">
                    <Trophy className="w-5 h-5" />
                    Top Players
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {leaderboard.map((player, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary" className={`
                            ${index === 0 ? 'bg-yellow-500 text-black' : 
                              index === 1 ? 'bg-slate-400 text-black' :
                              index === 2 ? 'bg-amber-600 text-white' : 'bg-slate-600'}
                          `}>
                            #{index + 1}
                          </Badge>
                          <span className="font-medium text-white">{player.first_name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Coins className="w-4 h-4 text-yellow-400" />
                          <span className="font-bold text-yellow-400">{player.token_balance}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Game History */}
            {activeTab === 'history' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-100">Recent Battle Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {gameHistory.map((game, index) => {
                      const config = ROOM_CONFIGS[game.room_type];
                      return (
                        <div key={index} className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-lg">{config.icon}</span>
                                <span className="font-medium text-white">{config.name}</span>
                                <Badge variant="outline" className="border-slate-500 text-slate-300">
                                  Round #{game.round_number}
                                </Badge>
                              </div>
                              <div className="text-sm text-slate-400">
                                Winner: <span className="text-green-400 font-medium">{game.winner?.username || 'Unknown'}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-bold text-yellow-400">{game.prize_pool} tokens</div>
                              <div className="text-xs text-slate-400">
                                {new Date(game.finished_at).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Token Purchase */}
            {activeTab === 'tokens' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-400">
                    <Coins className="w-5 h-5" />
                    Buy Casino Tokens
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Send SOL to YOUR PERSONAL wallet address below. Tokens credited automatically! (Rate: 1 SOL = 1,000 tokens)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Casino Wallet Address */}
                  <div className={`${isMobile ? 'p-4' : 'p-6'} bg-gradient-to-r from-green-600/20 to-emerald-600/20 rounded-lg border border-green-500/30`}>
                    <h3 className={`${isMobile ? 'text-lg' : 'text-xl'} font-semibold text-white mb-4 text-center`}>
                      {isMobile ? 'Your Personal Address' : 'Your Personal Solana Address'}
                    </h3>
                    <div className={`bg-slate-800 ${isMobile ? 'p-3' : 'p-4'} rounded-lg border border-slate-600`}>
                      <code className={`text-green-400 font-mono ${isMobile ? 'text-sm' : 'text-lg'} break-all block text-center`}>
                        {casinoWalletAddress}
                      </code>
                    </div>
                    <div className="flex justify-center mt-4">
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(casinoWalletAddress);
                          toast.success('Wallet address copied!');
                        }}
                        className={`bg-green-600 hover:bg-green-700 text-white font-semibold ${isMobile ? 'px-4 py-3 w-full' : 'px-6 py-2'}`}
                      >
                        📋 {isMobile ? 'Copy Address' : 'Copy Address'}
                      </Button>
                    </div>
                    <p className={`text-center text-slate-300 ${isMobile ? 'text-sm' : 'text-sm'} mt-4`}>
                      💰 Balance: <span className="text-yellow-400 font-bold">{user.token_balance || 0} tokens</span>
                    </p>
                    {isMobile && (
                      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <p className="text-xs text-blue-300 text-center">
                          📝 Send SOL to this address, then tokens will be added to your account
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* My Prizes */}
            {activeTab === 'prizes' && (
              <Card className="bg-slate-800/90 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-purple-400">
                    <Trophy className="w-5 h-5" />
                    My Prizes
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Your won prizes from battle royale games
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {userPrizes.length === 0 ? (
                    <div className="text-center py-8">
                      <Trophy className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-slate-400 mb-2">No Prizes Yet</h3>
                      <p className="text-slate-500">
                        Win battle royale games to earn prizes! Join a room and compete with other players.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {userPrizes.map((prize, index) => (
                        <div key={index} className={`${isMobile ? 'p-3' : 'p-4'} bg-slate-700/30 rounded-lg border border-slate-600`}>
                          <div className={`${isMobile ? 'space-y-3' : 'flex justify-between items-start'}`}>
                            <div className="flex items-center gap-3">
                              <div className={`${isMobile ? 'w-10 h-10' : 'w-12 h-12'} rounded-full flex items-center justify-center ${
                                prize.room_type === 'gold' ? 'bg-yellow-500' :
                                prize.room_type === 'silver' ? 'bg-slate-400' : 'bg-amber-600'
                              }`}>
                                <span className={`${isMobile ? 'text-xl' : 'text-2xl'}`}>
                                  {prize.room_type === 'gold' ? '🥇' :
                                   prize.room_type === 'silver' ? '🥈' : '🥉'}
                                </span>
                              </div>
                              <div className="flex-1">
                                <h4 className={`font-semibold text-white ${isMobile ? 'text-sm' : ''}`}>
                                  {ROOM_CONFIGS[prize.room_type].name} Winner
                                </h4>
                                <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400`}>
                                  Round #{prize.round_number} • {prize.prize_pool} tokens won
                                </p>
                                <p className="text-xs text-slate-500">
                                  {new Date(prize.won_at).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <Button
                              onClick={() => window.open(prize.prize_link, '_blank')}
                              className={`bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 ${
                                isMobile ? 'w-full mt-2' : ''
                              }`}
                            >
                              🎁 Claim Prize
                            </Button>
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

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 z-50">
          <div className="flex justify-around items-center py-2">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 ${
                activeTab === 'rooms' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Users className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">Rooms</span>
            </button>
            
            <button
              onClick={() => setActiveTab('tokens')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 ${
                activeTab === 'tokens' 
                  ? 'text-green-400 bg-green-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Coins className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">Tokens</span>
            </button>
            
            <button
              onClick={() => setActiveTab('prizes')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 relative ${
                activeTab === 'prizes' 
                  ? 'text-purple-400 bg-purple-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Trophy className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">Prizes</span>
              {userPrizes.length > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {userPrizes.length}
                </div>
              )}
            </button>
            
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 ${
                activeTab === 'leaderboard' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Crown className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">Leaders</span>
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center p-2 rounded-lg transition-all duration-200 ${
                activeTab === 'history' 
                  ? 'text-blue-400 bg-blue-400/10' 
                  : 'text-slate-400 active:bg-slate-700/50'
              }`}
            >
              <Timer className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">History</span>
            </button>
          </div>
        </nav>
      )}

      <Toaster richColors position={isMobile ? "top-center" : "top-right"} />
    </div>
  );
}

export default App;