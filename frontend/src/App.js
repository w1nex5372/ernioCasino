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
const CASINO_WALLET_ADDRESS = "YOUR_SOLANA_WALLET_ADDRESS_HERE";

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
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
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
      toast.success(`🎉 ${data.winner.username} won ${data.prize_pool} tokens in ${ROOM_CONFIGS[data.room_type].name}!`);
      if (user && data.winner.user_id === user.id) {
        // Update user balance if they won
        setUser(prev => ({ ...prev, token_balance: prev.token_balance + data.prize_pool }));
      }
      loadRooms();
      loadGameHistory();
      loadLeaderboard();
    });

    newSocket.on('new_room_available', (data) => {
      toast.info(`New ${ROOM_CONFIGS[data.room_type].name} is available!`);
      loadRooms();
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    loadRooms();
    loadGameHistory();
    loadLeaderboard();
    
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((registration) => {
            console.log('SW registered: ', registration);
          })
          .catch((registrationError) => {
            console.log('SW registration failed: ', registrationError);
          });
      });
    }
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

  const createUser = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error('Please enter a username');
      return;
    }

    try {
      const response = await axios.post(`${API}/users`, {
        username: username.trim(),
        wallet_address: walletAddress.trim() || null
      });
      setUser(response.data);
      setUsername('');
      setWalletAddress('');
      toast.success('Welcome to the casino!');
    } catch (error) {
      console.error('Failed to create user:', error);
      toast.error('Failed to create user');
    }
  };

  const purchaseTokens = async (e) => {
    e.preventDefault();
    if (!solAmount || parseFloat(solAmount) <= 0) {
      toast.error('Please enter a valid SOL amount');
      return;
    }

    if (CASINO_WALLET_ADDRESS === "YOUR_SOLANA_WALLET_ADDRESS_HERE") {
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
    if (!CASINO_WALLET_ADDRESS || CASINO_WALLET_ADDRESS === "YOUR_SOLANA_WALLET_ADDRESS_HERE") {
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
            params: [CASINO_WALLET_ADDRESS]
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

  const joinRoom = async (roomType) => {
    if (!betAmount || parseInt(betAmount) <= 0) {
      toast.error('Please enter a valid bet amount');
      return;
    }

    const bet = parseInt(betAmount);
    const config = ROOM_CONFIGS[roomType];

    if (bet < config.min || bet > config.max) {
      toast.error(`Bet must be between ${config.min} and ${config.max} tokens`);
      return;
    }

    if (bet > user.token_balance) {
      toast.error('Insufficient token balance');
      return;
    }

    try {
      const response = await axios.post(`${API}/join-room`, {
        room_type: roomType,
        user_id: user.id,
        bet_amount: bet
      });

      if (response.data.success) {
        setUser(prev => ({
          ...prev,
          token_balance: prev.token_balance - bet
        }));
        setBetAmount('');
        setSelectedRoom(null);
        toast.success(`Joined ${config.name}! Position ${response.data.position}/10`);
        loadRooms();
      }
    } catch (error) {
      console.error('Failed to join room:', error);
      toast.error(error.response?.data?.detail || 'Failed to join room');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/90 border-slate-700">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
              <Crown className="w-8 h-8 text-slate-900" />
            </div>
            <CardTitle className="text-2xl text-white">Casino Battle Royale</CardTitle>
            <CardDescription className="text-slate-300">
              Join the ultimate betting arena where 10 players compete for the prize pool
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Username
                </label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="bg-slate-700 border-slate-600 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Solana Wallet Address (Optional)
                </label>
                <Input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="Your Solana wallet address"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <Button type="submit" className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700">
                <Play className="w-4 h-4 mr-2" />
                Enter Casino
              </Button>
            </form>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-x-hidden">
      {/* Mobile Header */}
      <header className="bg-slate-900/90 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-50">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-6 h-6 md:w-8 md:h-8 text-yellow-400" />
              <h1 className="text-lg md:text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
                {isMobile ? 'Casino' : 'Casino Battle Royale'}
              </h1>
            </div>
            
            <div className="flex items-center gap-2 md:gap-6">
              {!isMobile && (
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">{user.username}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-sm md:text-lg font-bold text-yellow-400">{user.token_balance}</span>
                {!isMobile && <span className="text-slate-400">tokens</span>}
              </div>
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                {!isMobile && (
                  <span className={`text-xs ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className={`${isMobile ? 'pb-20' : 'flex'}`}>
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
                Battle Rooms
              </button>
              
              <button
                onClick={() => setActiveTab('leaderboard')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'leaderboard' 
                    ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Trophy className="w-5 h-5" />
                Leaderboard
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
                History
              </button>
              
              <button
                onClick={() => setActiveTab('tokens')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeTab === 'tokens' 
                    ? 'bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold' 
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white bg-green-600/20'
                }`}
              >
                <Coins className="w-5 h-5" />
                Buy Tokens
              </button>
            </div>
            
            {/* Quick Stats */}
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
        <main className={`flex-1 p-3 md:p-6 ${isMobile ? 'min-h-screen' : ''}`}>
          <div className="space-y-6">

            {/* Battle Rooms */}
            {activeTab === 'rooms' && (
              <div className="space-y-8">
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full mb-4">
                    <Users className="w-8 h-8 text-slate-900" />
                  </div>
                  <h2 className="text-3xl font-bold mb-3 bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
                    Choose Your Battle Arena
                  </h2>
                  <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                    Join one of our three exclusive rooms where 10 players compete for the ultimate prize pool. 
                    <br />
                    <span className="text-yellow-400 font-medium">Higher bets = Better winning odds!</span>
                  </p>
                </div>
                
                <div className={`grid gap-4 md:gap-8 max-w-7xl mx-auto ${isMobile ? 'grid-cols-1' : 'lg:grid-cols-3 md:grid-cols-2 grid-cols-1'}`}>
                {['bronze', 'silver', 'gold'].map((roomType) => {
                  const room = rooms.find(r => r.room_type === roomType) || { players_count: 0, prize_pool: 0 };
                  const config = ROOM_CONFIGS[roomType];
                  
                  return (
                    <Card key={roomType} className="bg-slate-800/90 border-slate-700 overflow-hidden hover:border-yellow-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-yellow-500/10">
                      <CardHeader className={`bg-gradient-to-br ${config.gradient} text-white relative overflow-hidden`}>
                        <div className="absolute inset-0 bg-black/10"></div>
                        <div className="relative z-10">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                                <span className="text-2xl">{config.icon}</span>
                              </div>
                              <div>
                                <CardTitle className="text-xl font-bold">
                                  {config.name}
                                </CardTitle>
                                <CardDescription className="text-white/90 font-medium">
                                  {config.min} - {config.max} tokens
                                </CardDescription>
                              </div>
                            </div>
                            <Badge variant="secondary" className="bg-white/25 text-white font-semibold px-3 py-1 backdrop-blur-sm">
                              Round #{room.round_number || 1}
                            </Badge>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 mt-4">
                            <div className="bg-white/15 rounded-lg p-3 backdrop-blur-sm">
                              <div className="text-white/80 text-xs uppercase tracking-wide font-medium">Players</div>
                              <div className="text-white font-bold text-lg">{room.players_count}/10</div>
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
                              <span className={`text-slate-400 font-medium ${isMobile ? 'text-sm' : ''}`}>Battle Progress</span>
                              <span className={`font-bold text-yellow-400 ${isMobile ? 'text-sm' : ''}`}>{room.players_count}/10 Players</span>
                            </div>
                            
                            <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-yellow-400 to-yellow-600 h-3 rounded-full transition-all duration-500 ease-out relative"
                                style={{ width: `${(room.players_count / 10) * 100}%` }}
                              >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20"></div>
                              </div>
                            </div>
                            
                            <div className="text-center text-xs text-slate-500">
                              {room.players_count === 10 ? '🔥 Battle in Progress!' : 
                               room.players_count >= 7 ? '⚡ Almost Full!' :
                               room.players_count >= 4 ? '🎯 Halfway There!' :
                               '🚀 Join the Battle!'}
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
                                  disabled={room.players_count >= 10}
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
                              disabled={room.players_count >= 10 || room.status !== 'waiting'}
                            >
                              {room.players_count >= 10 ? 'Room Full' : 
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
                          <span className="font-medium text-white">{player.username}</span>
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
                                Winner: <span className="text-green-400 font-medium">{game.winner?.username}</span>
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
                    Purchase Casino Tokens
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Send SOL to our wallet address below to receive casino tokens at rate: 1 SOL = 1,000 tokens
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  {/* Casino Wallet Address */}
                  <div className="p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                    <h3 className="text-lg font-semibold text-white mb-2">Casino Wallet Address</h3>
                    <div className="flex items-center justify-between bg-slate-800 p-3 rounded-lg">
                      <code className="text-green-400 font-mono text-sm break-all">
                        {CASINO_WALLET_ADDRESS}
                      </code>
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(CASINO_WALLET_ADDRESS);
                          toast.success('Wallet address copied!');
                        }}
                        size="sm"
                        variant="outline"
                        className="ml-2 border-slate-600 text-slate-300 hover:bg-slate-700"
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      Send your SOL to this address, then use the form below to claim your tokens
                    </p>
                  </div>

                  {/* Token Claim Form */}
                  <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
                    <h3 className="text-lg font-semibold text-white mb-3">
                      {walletMonitoring ? 'Monitoring Payment...' : 'Send SOL & Get Tokens'}
                    </h3>
                    
                    {walletMonitoring ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-center p-6">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
                        </div>
                        <div className="text-center">
                          <div className="text-yellow-400 font-medium">Monitoring wallet for payment...</div>
                          <div className="text-slate-400 text-sm mt-1">
                            Waiting for {solAmount} SOL payment to arrive
                          </div>
                          <div className="text-xs text-slate-500 mt-2">
                            This may take a few moments. Do not refresh the page.
                          </div>
                        </div>
                        <Button 
                          onClick={() => setWalletMonitoring(false)}
                          variant="outline"
                          className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
                        >
                          Cancel Monitoring
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={purchaseTokens} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">
                            SOL Amount to Send
                          </label>
                          <Input
                            type="number"
                            step="0.001"
                            value={solAmount}
                            onChange={(e) => setSolAmount(e.target.value)}
                            placeholder="Enter SOL amount (e.g., 0.5)"
                            className="bg-slate-700 border-slate-600 text-white"
                          />
                        </div>
                        {solAmount && (
                          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                            <div className="text-sm text-green-300">
                              You will receive: <span className="font-bold text-green-400">
                                {Math.floor(parseFloat(solAmount || 0) * 1000)} casino tokens
                              </span>
                            </div>
                          </div>
                        )}
                        <Button 
                          type="submit" 
                          className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                          disabled={!solAmount || parseFloat(solAmount) <= 0}
                        >
                          <Coins className="w-4 h-4 mr-2" />
                          Start Monitoring ({solAmount ? Math.floor(parseFloat(solAmount) * 1000) : 0} tokens)
                        </Button>
                      </form>
                    )}
                  </div>

                  {/* Instructions */}
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <h4 className="font-semibold text-blue-400 mb-2">📝 How to Purchase Tokens:</h4>
                    <ol className="text-sm text-slate-300 space-y-1 list-decimal list-inside">
                      <li>Copy the casino wallet address above</li>
                      <li>Send SOL from your wallet to this address</li>
                      <li>Enter the amount you sent in the form</li>
                      <li>Click "Start Monitoring" to automatically receive your tokens</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 z-50">
          <div className="grid grid-cols-4 h-16">
            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex flex-col items-center justify-center transition-all duration-200 ${
                activeTab === 'rooms' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-5 h-5 mb-1" />
              <span className="text-xs">Rooms</span>
            </button>
            
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`flex flex-col items-center justify-center transition-all duration-200 ${
                activeTab === 'leaderboard' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Trophy className="w-5 h-5 mb-1" />
              <span className="text-xs">Leaders</span>
            </button>
            
            <button
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center justify-center transition-all duration-200 ${
                activeTab === 'history' 
                  ? 'text-yellow-400 bg-yellow-400/10' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Timer className="w-5 h-5 mb-1" />
              <span className="text-xs">History</span>
            </button>
            
            <button
              onClick={() => setActiveTab('tokens')}
              className={`flex flex-col items-center justify-center transition-all duration-200 ${
                activeTab === 'tokens' 
                  ? 'text-green-400 bg-green-400/10' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Coins className="w-5 h-5 mb-1" />
              <span className="text-xs">Tokens</span>
            </button>
          </div>
        </nav>
      )}

      <Toaster richColors position={isMobile ? "top-center" : "top-right"} />
    </div>
  );
}

export default App;