import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Progress } from './components/ui/progress';
import { Separator } from './components/ui/separator';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';
import { Crown, Coins, Users, Trophy, Zap, Wallet, Play, Timer } from 'lucide-react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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

  useEffect(() => {
    // Initialize Socket.IO connection
    const newSocket = io(BACKEND_URL);
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
        setShowTokenPurchase(false);
        toast.success(`Purchased ${tokenAmount} tokens!`);
      }
    } catch (error) {
      console.error('Failed to purchase tokens:', error);
      toast.error(error.response?.data?.detail || 'Failed to purchase tokens');
    }
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="container mx-auto p-4">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Crown className="w-8 h-8 text-yellow-400" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
              Casino Battle Royale
            </h1>
          </div>
          
          <div className="flex items-center justify-center gap-6 mb-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-slate-400" />
              <span className="text-slate-300">{user.username}</span>
            </div>
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-yellow-400" />
              <span className="text-xl font-bold text-yellow-400">{user.token_balance}</span>
              <span className="text-slate-400">tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className={`text-sm ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          <Button 
            onClick={() => setShowTokenPurchase(true)}
            className="bg-green-600 hover:bg-green-700"
          >
            <Coins className="w-4 h-4 mr-2" />
            Buy Tokens
          </Button>
        </div>

        <Tabs defaultValue="rooms" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800">
            <TabsTrigger value="rooms" className="data-[state=active]:bg-yellow-600">
              <Users className="w-4 h-4 mr-2" />
              Battle Rooms
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="data-[state=active]:bg-yellow-600">
              <Trophy className="w-4 h-4 mr-2" />
              Leaderboard
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-yellow-600">
              <Timer className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger value="tokens" className="data-[state=active]:bg-yellow-600">
              <Zap className="w-4 h-4 mr-2" />
              Buy Tokens
            </TabsTrigger>
          </TabsList>

          {/* Battle Rooms */}
          <TabsContent value="rooms" className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">Choose Your Battle Arena</h2>
              <p className="text-slate-400">10 players compete, highest bet has better winning odds</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              {['bronze', 'silver', 'gold'].map((roomType) => {
                const room = rooms.find(r => r.room_type === roomType) || { players_count: 0, prize_pool: 0 };
                const config = ROOM_CONFIGS[roomType];
                
                return (
                  <Card key={roomType} className="bg-slate-800/90 border-slate-700 overflow-hidden">
                    <CardHeader className={`bg-gradient-to-r ${config.gradient} text-white`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <span className="text-2xl">{config.icon}</span>
                            {config.name}
                          </CardTitle>
                          <CardDescription className="text-white/80">
                            {config.min} - {config.max} tokens
                          </CardDescription>
                        </div>
                        <Badge variant="secondary" className="bg-white/20 text-white">
                          Round #{room.round_number || 1}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-300">Players:</span>
                          <span className="font-bold text-yellow-400">{room.players_count}/10</span>
                        </div>
                        
                        <Progress 
                          value={(room.players_count / 10) * 100} 
                          className="h-2"
                        />
                        
                        <div className="flex justify-between items-center">
                          <span className="text-slate-300">Prize Pool:</span>
                          <span className="font-bold text-green-400">{room.prize_pool} tokens</span>
                        </div>
                        
                        <Separator className="bg-slate-600" />
                        
                        {selectedRoom === roomType ? (
                          <div className="space-y-3">
                            <Input
                              type="number"
                              value={betAmount}
                              onChange={(e) => setBetAmount(e.target.value)}
                              placeholder={`Bet amount (${config.min}-${config.max})`}
                              className="bg-slate-700 border-slate-600 text-white"
                              min={config.min}
                              max={config.max}
                            />
                            <div className="flex gap-2">
                              <Button 
                                onClick={() => joinRoom(roomType)}
                                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                                disabled={room.players_count >= 10}
                              >
                                Join Battle
                              </Button>
                              <Button 
                                onClick={() => setSelectedRoom(null)}
                                variant="outline"
                                className="border-slate-600 text-slate-300 hover:bg-slate-700"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button 
                            onClick={() => setSelectedRoom(roomType)}
                            className={`w-full bg-gradient-to-r ${config.gradient} hover:opacity-90`}
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
          </TabsContent>

          {/* Leaderboard */}
          <TabsContent value="leaderboard">
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
          </TabsContent>

          {/* Game History */}
          <TabsContent value="history">
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
          </TabsContent>

          {/* Token Purchase */}
          <TabsContent value="tokens">
            <Card className="bg-slate-800/90 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-400">
                  <Coins className="w-5 h-5" />
                  Purchase Casino Tokens
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Exchange SOL for casino tokens. Rate: 1 SOL = 1,000 tokens
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={purchaseTokens} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      SOL Amount
                    </label>
                    <Input
                      type="number"
                      step="0.001"
                      value={solAmount}
                      onChange={(e) => setSolAmount(e.target.value)}
                      placeholder="Enter SOL amount"
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                  {solAmount && (
                    <div className="p-3 bg-slate-700/50 rounded-lg">
                      <div className="text-sm text-slate-300">
                        You will receive: <span className="font-bold text-yellow-400">
                          {Math.floor(parseFloat(solAmount || 0) * 1000)} tokens
                        </span>
                      </div>
                    </div>
                  )}
                  <Button 
                    type="submit" 
                    className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                    disabled={!solAmount || parseFloat(solAmount) <= 0}
                  >
                    Purchase Tokens
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  );
}

export default App;