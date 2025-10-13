import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Loader2, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function PaymentModal({ isOpen, onClose, userId, tokenAmount: initialTokenAmount }) {
  const [paymentData, setPaymentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(1200); // 20 minutes in seconds
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [checking, setChecking] = useState(false);
  const [eurAmount, setEurAmount] = useState((initialTokenAmount || 1000) / 100); // Dynamic EUR amount
  const [solPrice, setSolPrice] = useState(null); // Live SOL/EUR price
  const [recalculating, setRecalculating] = useState(false);

  // Initialize payment
  useEffect(() => {
    if (!isOpen || !userId || !tokenAmount) return;

    const initializePayment = async () => {
      setLoading(true);
      try {
        const response = await axios.post(`${API}/purchase-tokens`, {
          user_id: userId,
          token_amount: tokenAmount
        });

        if (response.data.status === 'success') {
          setPaymentData(response.data.payment_info);
          toast.success('Payment wallet created!');
        } else {
          toast.error('Failed to create payment');
          onClose();
        }
      } catch (error) {
        console.error('Payment initialization error:', error);
        toast.error(error.response?.data?.detail || 'Failed to initialize payment');
        onClose();
      } finally {
        setLoading(false);
      }
    };

    initializePayment();
  }, [isOpen, userId, tokenAmount]);

  // Countdown timer
  useEffect(() => {
    if (!isOpen || !paymentData) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          toast.error('Payment expired');
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, paymentData, onClose]);

  // Poll for payment status
  useEffect(() => {
    if (!isOpen || !paymentData || paymentStatus !== 'pending') return;

    const checkPaymentStatus = async () => {
      if (checking) return;
      setChecking(true);

      try {
        const response = await axios.get(
          `${API}/purchase-status/${userId}/${paymentData.wallet_address}`
        );

        const status = response.data.purchase_status;
        
        if (status.payment_detected && !status.tokens_credited) {
          setPaymentStatus('processing');
          toast.success('💰 Payment detected! Processing...');
        } else if (status.tokens_credited && !status.sol_forwarded) {
          setPaymentStatus('crediting');
          toast.success('✅ Tokens credited! Finalizing...');
        } else if (status.sol_forwarded) {
          setPaymentStatus('completed');
          toast.success('🎉 Payment complete!');
          setTimeout(() => {
            onClose();
            window.location.reload(); // Refresh to show new balance
          }, 2000);
        }
      } catch (error) {
        console.error('Status check error:', error);
      } finally {
        setChecking(false);
      }
    };

    // Check every 5 seconds
    const interval = setInterval(checkPaymentStatus, 5000);
    
    // Check immediately
    checkPaymentStatus();

    return () => clearInterval(interval);
  }, [isOpen, paymentData, paymentStatus, userId, checking]);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Failed to copy');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-purple-500/30 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-800 p-4 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <QrCode className="w-6 h-6" />
            Payment Invoice
          </h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
            disabled={paymentStatus === 'processing' || paymentStatus === 'crediting'}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
            <p className="text-white text-center">Creating payment wallet...</p>
          </div>
        ) : paymentData ? (
          <div className="p-6 space-y-6">
            {/* Timer */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-yellow-500/30">
              <div className="text-center">
                <div className="text-sm text-slate-400 mb-1">Time Remaining</div>
                <div className="text-3xl font-bold text-yellow-400">
                  {formatTime(timeLeft)}
                </div>
                <div className="text-xs text-slate-500 mt-1">Payment expires after 20 minutes</div>
              </div>
            </div>

            {/* Amount Info */}
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                <span className="text-slate-400">Tokens</span>
                <span className="text-white font-bold">{tokenAmount} tokens</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                <span className="text-slate-400">Amount in EUR</span>
                <span className="text-white font-bold">€{paymentData.required_eur?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <span className="text-green-300">Amount in SOL</span>
                <span className="text-green-400 font-bold">{paymentData.required_sol?.toFixed(6)} SOL</span>
              </div>
              <div className="text-xs text-slate-500 text-center">
                Rate: 1 SOL = €{paymentData.sol_eur_price?.toFixed(2)} | 1 EUR = 100 tokens
              </div>
            </div>

            {/* Payment Address */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white">Send SOL to this address:</label>
              <div className="relative">
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 break-all font-mono text-sm text-green-400">
                  {paymentData.wallet_address}
                </div>
                <button
                  onClick={() => copyToClipboard(paymentData.wallet_address)}
                  className="absolute top-2 right-2 bg-purple-600 hover:bg-purple-700 text-white p-2 rounded-lg transition-all"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Payment ID */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white">Payment ID:</label>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 font-mono text-xs text-slate-400 text-center">
                {paymentData.wallet_address.substring(0, 16)}...
              </div>
            </div>

            {/* Status */}
            {paymentStatus !== 'pending' && (
              <div className={`p-4 rounded-lg border ${
                paymentStatus === 'processing' ? 'bg-yellow-500/10 border-yellow-500/30' :
                paymentStatus === 'crediting' ? 'bg-blue-500/10 border-blue-500/30' :
                'bg-green-500/10 border-green-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  <Loader2 className={`w-5 h-5 animate-spin ${
                    paymentStatus === 'processing' ? 'text-yellow-400' :
                    paymentStatus === 'crediting' ? 'text-blue-400' :
                    'text-green-400'
                  }`} />
                  <div>
                    <div className="font-semibold text-white">
                      {paymentStatus === 'processing' && 'Payment Detected'}
                      {paymentStatus === 'crediting' && 'Crediting Tokens'}
                      {paymentStatus === 'completed' && 'Payment Complete!'}
                    </div>
                    <div className="text-sm text-slate-400">
                      {paymentStatus === 'processing' && 'Processing your payment...'}
                      {paymentStatus === 'crediting' && 'Adding tokens to your account...'}
                      {paymentStatus === 'completed' && 'Tokens added successfully!'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-white text-sm">📝 Instructions:</h3>
              <ul className="text-xs text-slate-300 space-y-1">
                <li>• Send exactly <strong className="text-green-400">{paymentData.required_sol?.toFixed(6)} SOL</strong> to the address above</li>
                <li>• Payment will be detected automatically within 1-2 minutes</li>
                <li>• Tokens will be credited to your account immediately</li>
                <li>• Do not close this window until payment is confirmed</li>
              </ul>
            </div>

            {/* Cancel Button */}
            {paymentStatus === 'pending' && (
              <button
                onClick={onClose}
                className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all"
              >
                Cancel Payment
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
