import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Loader2, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function PaymentModal({ isOpen, onClose, userId, tokenAmount: initialTokenAmount, initialEurAmount, onConfirm, isWorkPurchase = false, giftCount = 0 }) {
  const [paymentData, setPaymentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(1200); // 20 minutes in seconds
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [checking, setChecking] = useState(false);
  
  // Load EUR amount from localStorage or use provided/calculated value
  const getInitialEurAmount = () => {
    if (initialEurAmount) return initialEurAmount;
    const saved = localStorage.getItem('casino_last_eur_amount');
    if (saved) return parseFloat(saved);
    return (initialTokenAmount || 1000) / 100;
  };
  
  const [eurAmount, setEurAmount] = useState(getInitialEurAmount()); // Dynamic EUR amount
  const [eurInput, setEurInput] = useState(getInitialEurAmount().toString()); // Input field value
  const [solPrice, setSolPrice] = useState(null); // Live SOL/EUR price
  const [recalculating, setRecalculating] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Update EUR amount when initialEurAmount prop changes
  useEffect(() => {
    if (isOpen && initialEurAmount !== null && initialEurAmount !== undefined) {
      console.log('💶 PaymentModal: Updating EUR amount from prop:', initialEurAmount);
      setEurAmount(initialEurAmount);
      setEurInput(initialEurAmount.toString());
    }
  }, [isOpen, initialEurAmount]);

  // Prevent body scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
      document.body.style.overflow = 'hidden';
    } else {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      // Reset state when modal closes
      setPaymentData(null);
      setLoading(true);
      setPaymentStatus('pending');
      setValidationError('');
    }
    
    return () => {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Fetch live SOL/EUR price with auto-refresh every 3 minutes
  useEffect(() => {
    if (!isOpen) return;

    const fetchPrice = async () => {
      try {
        const response = await axios.get(`${API}/sol-eur-price`);
        if (response.data && response.data.sol_eur_price) {
          const newPrice = response.data.sol_eur_price;
          setSolPrice(newPrice);
          // Store as fallback
          localStorage.setItem('casino_last_sol_eur_price', newPrice.toString());
          console.log('💰 Updated SOL/EUR price:', newPrice);
        }
      } catch (error) {
        console.error('Failed to fetch SOL price:', error);
        // Use fallback from localStorage or default
        const fallback = parseFloat(localStorage.getItem('casino_last_sol_eur_price')) || 180;
        setSolPrice(fallback);
        console.log('Using fallback price:', fallback);
      }
    };

    fetchPrice(); // Immediate fetch
    // Refresh price every 3 minutes (180000ms)
    const interval = setInterval(fetchPrice, 180000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Initialize payment with dynamic EUR amount
  useEffect(() => {
    if (!isOpen || !userId || !eurAmount || !solPrice) return;

    const initializePayment = async () => {
      console.log('💳 Initializing payment:', { eurAmount, tokenAmount: Math.floor(eurAmount * 100), solPrice, userId });
      setLoading(true);
      try {
        const tokenAmount = Math.floor(eurAmount * 100); // 1 EUR = 100 tokens
        const response = await axios.post(`${API}/purchase-tokens`, {
          user_id: userId,
          token_amount: tokenAmount
        });

        if (response.data.status === 'success') {
          console.log('✅ Payment wallet created:', response.data.payment_info);
          setPaymentData(response.data.payment_info);
          toast.success('Payment wallet created!');
        } else {
          toast.error('Failed to create payment');
          onClose();
        }
      } catch (error) {
        console.error('❌ Payment initialization error:', error);
        toast.error(error.response?.data?.detail || 'Failed to initialize payment');
        onClose();
      } finally {
        setLoading(false);
      }
    };

    initializePayment();
  }, [isOpen, userId, eurAmount, solPrice]);

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

  // Poll for payment status with timeout
  useEffect(() => {
    if (!isOpen || !paymentData) return;
    
    // Don't poll if already completed or failed
    if (paymentStatus === 'completed' || paymentStatus === 'failed' || paymentStatus === 'timeout') return;

    const checkPaymentStatus = async () => {
      if (checking) return;
      setChecking(true);

      try {
        const response = await axios.get(
          `${API}/purchase-status/${userId}/${paymentData.wallet_address}`
        );

        const status = response.data.purchase_status;
        
        console.log('💳 Payment status check:', status);
        
        if (status.payment_detected && !status.tokens_credited) {
          // State 1: Payment detected, waiting for token credit
          if (paymentStatus !== 'processing') {
            setPaymentStatus('processing');
            toast.success('💰 Payment detected! Processing...');
          }
        } else if (status.tokens_credited) {
          // State 2: Tokens credited (for token purchase) OR payment confirmed (for work purchase)
          setPaymentStatus('completed');
          
          if (isWorkPurchase) {
            // Work for Casino purchase - no tokens, just access
            toast.success('🎉 Payment successful! Work access granted.');
            
            // Call the confirmation callback with payment signature
            if (onConfirm && paymentData?.wallet_address) {
              await onConfirm(paymentData.wallet_address);
            }
            
            // Close modal after 2 seconds
            setTimeout(() => {
              onClose();
              // No page reload for work purchase
            }, 2000);
          } else {
            // Regular token purchase
            toast.success('🎉 Payment successful! Tokens credited.');
            
            // Close modal after 2 seconds with animation
            setTimeout(() => {
              onClose();
              
              // Refresh user data without full page reload
              if (window.location.hash !== '#tokens') {
                window.location.hash = '#tokens';
              }
              
              // Trigger app to reload user data
              window.dispatchEvent(new CustomEvent('payment-completed'));
              
              // Fallback: full reload if no event listener
              setTimeout(() => {
                window.location.reload();
              }, 500);
            }, 2000);
          }
        }
      } catch (error) {
        console.error('Status check error:', error);
      } finally {
        setChecking(false);
      }
    };

    // Check every 3 seconds for faster updates
    const interval = setInterval(checkPaymentStatus, 3000);
    
    // Check immediately
    checkPaymentStatus();

    return () => clearInterval(interval);
  }, [isOpen, paymentData, paymentStatus, userId, checking, onClose]);
  
  // Timeout handler - 5 minutes
  useEffect(() => {
    if (!isOpen || !paymentData) return;
    
    const timeout = setTimeout(() => {
      if (paymentStatus === 'pending' || paymentStatus === 'processing') {
        setPaymentStatus('timeout');
        toast.error('⚠️ Payment not detected. Please check your transaction or try again.');
      }
    }, 300000); // 5 minutes
    
    return () => clearTimeout(timeout);
  }, [isOpen, paymentData, paymentStatus]);

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
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
      style={{
        animation: 'fadeIn 0.3s ease-out',
        overflow: 'hidden' // Prevent background scrolling
      }}
      onClick={(e) => {
        // Close on backdrop click (only if not processing)
        if (e.target === e.currentTarget && paymentStatus !== 'processing' && paymentStatus !== 'crediting') {
          onClose();
        }
      }}
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        body.modal-open {
          overflow: hidden;
        }
      `}</style>
      <div 
        className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-purple-500/30 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        style={{
          animation: 'slideUp 0.3s ease-out'
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-800 p-4 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <QrCode className="w-6 h-6" />
            Payment Invoice
          </h2>
          <button
            onClick={onClose}
            className={`transition-colors ${
              paymentStatus === 'processing' || paymentStatus === 'crediting' 
                ? 'text-white/40 cursor-not-allowed' 
                : 'text-white/80 hover:text-white'
            }`}
            disabled={paymentStatus === 'processing' || paymentStatus === 'crediting'}
            title={paymentStatus === 'processing' || paymentStatus === 'crediting' ? 'Please wait...' : 'Close'}
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

            {/* Amount Info - DYNAMIC */}
            <div className="space-y-3">
              {/* Editable EUR Amount - FULLY MANUAL (disabled for work purchases) */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-white">
                  {isWorkPurchase ? 'Package Price' : 'Amount in EUR (Any amount ≥ 0.1)'}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-lg">€</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={eurInput}
                    onChange={(e) => {
                      // Don't allow changes for work purchases
                      if (isWorkPurchase) return;
                      
                      let value = e.target.value;
                      
                      // Replace comma with dot for decimal
                      value = value.replace(',', '.');
                      
                      // Allow only numbers and one decimal point
                      if (value !== '' && !/^\d*\.?\d*$/.test(value)) {
                        return; // Reject invalid characters
                      }
                      
                      // Allow typing freely
                      setEurInput(value);
                      
                      // Only validate if value is not empty and not just a dot
                      if (value === '' || value === '.') {
                        setValidationError('');
                        return;
                      }
                      
                      const newEur = parseFloat(value);
                      
                      // Check if it's a valid number
                      if (isNaN(newEur)) {
                        setValidationError('Please enter a valid number');
                        return;
                      }
                      
                      // Check minimum only, NO MAXIMUM
                      if (newEur < 0.1) {
                        setValidationError('Minimum amount is 0.1 EUR');
                        return;
                      }
                      
                      // Valid amount - accept ANY value >= 0.1
                      setValidationError('');
                      setEurAmount(newEur);
                      localStorage.setItem('casino_last_eur_amount', newEur.toString());
                      setRecalculating(true);
                      setTimeout(() => setRecalculating(false), 500);
                    }}
                    onBlur={() => {
                      // Format on blur, ensuring minimum
                      let value = eurInput.replace(',', '.');
                      const numValue = parseFloat(value);
                      
                      if (isNaN(numValue) || numValue < 0.1) {
                        // Reset to minimum if invalid
                        setEurAmount(0.1);
                        setEurInput('0.10');
                        setValidationError('');
                        localStorage.setItem('casino_last_eur_amount', '0.1');
                        toast.info('Amount set to minimum: €0.10');
                      } else {
                        // Format to 2 decimals
                        setEurInput(numValue.toFixed(2));
                        setEurAmount(numValue);
                        localStorage.setItem('casino_last_eur_amount', numValue.toString());
                      }
                    }}
                    className={`flex-1 bg-slate-900 border border-slate-700 text-white text-xl font-bold rounded-lg px-4 py-3 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none ${isWorkPurchase ? 'opacity-70 cursor-not-allowed' : ''}`}
                    disabled={loading || paymentStatus !== 'pending' || isWorkPurchase}
                    placeholder="0.10"
                    readOnly={isWorkPurchase}
                  />
                </div>
                {validationError && (
                  <p className="text-xs text-red-400">⚠️ {validationError}</p>
                )}
                {!isWorkPurchase && (
                  <p className="text-xs text-slate-500">
                    Type any amount ≥ 0.1 EUR • Use dot (.) or comma (,) for decimals
                  </p>
                )}
                {isWorkPurchase && (
                  <p className="text-xs text-purple-400">
                    🎁 Fixed package price - includes {giftCount} gifts
                  </p>
                )}
              </div>

              {/* Calculated Tokens or Gifts (updates automatically) */}
              <div className="flex justify-between items-center p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <span className="text-purple-300">
                  {isWorkPurchase ? "Gifts You'll Receive" : "Tokens You'll Get"}
                </span>
                <span className="text-purple-400 font-bold">
                  {isWorkPurchase 
                    ? `${giftCount} gifts` 
                    : `${recalculating ? '...' : Math.floor(eurAmount * 100)} tokens`
                  }
                </span>
              </div>

              {/* Calculated SOL Amount (updates automatically) - COPYABLE */}
              <div 
                className="flex justify-between items-center p-3 bg-green-500/10 border border-green-500/30 rounded-lg cursor-pointer hover:bg-green-500/20 transition-colors group"
                onClick={() => {
                  const solAmount = recalculating ? '0' : solPrice ? (eurAmount / solPrice).toFixed(6) : paymentData?.required_sol?.toFixed(6);
                  navigator.clipboard.writeText(solAmount);
                  toast.success('✅ SOL amount copied to clipboard!');
                }}
                title="Click to copy SOL amount"
              >
                <span className="text-green-300">Amount in SOL</span>
                <div className="flex items-center gap-2">
                  <span className="text-green-400 font-bold select-all">
                    {recalculating ? '...' : solPrice ? (eurAmount / solPrice).toFixed(6) : paymentData?.required_sol?.toFixed(6)} SOL
                  </span>
                  <Copy className="w-4 h-4 text-green-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>

              {/* Exchange Rate */}
              <div className="text-xs text-slate-500 text-center space-y-1">
                <div>Rate: 1 SOL = €{solPrice?.toFixed(2) || paymentData?.sol_eur_price?.toFixed(2)} | 1 EUR = 100 tokens</div>
                {recalculating && <div className="text-yellow-400">⚡ Recalculating...</div>}
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
              <div className={`p-4 rounded-lg border transition-all duration-500 ${
                paymentStatus === 'processing' ? 'bg-yellow-500/10 border-yellow-500/30' :
                paymentStatus === 'crediting' ? 'bg-blue-500/10 border-blue-500/30' :
                paymentStatus === 'completed' ? 'bg-green-500/10 border-green-500/30' :
                paymentStatus === 'timeout' ? 'bg-red-500/10 border-red-500/30' :
                'bg-gray-500/10 border-gray-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  {paymentStatus !== 'timeout' && paymentStatus !== 'failed' ? (
                    <Loader2 className={`w-5 h-5 animate-spin ${
                      paymentStatus === 'processing' ? 'text-yellow-400' :
                      paymentStatus === 'crediting' ? 'text-blue-400' :
                      'text-green-400'
                    }`} />
                  ) : (
                    <X className="w-5 h-5 text-red-400" />
                  )}
                  <div>
                    <div className="font-semibold text-white">
                      {paymentStatus === 'processing' && '💰 Payment Detected'}
                      {paymentStatus === 'crediting' && '💫 Crediting Tokens'}
                      {paymentStatus === 'completed' && '✅ Payment Complete!'}
                      {paymentStatus === 'timeout' && '⚠️ Payment Timeout'}
                      {paymentStatus === 'failed' && '❌ Payment Failed'}
                    </div>
                    <div className="text-sm text-slate-400">
                      {paymentStatus === 'processing' && 'Processing your payment...'}
                      {paymentStatus === 'crediting' && 'Adding tokens to your account...'}
                      {paymentStatus === 'completed' && 'Tokens added successfully! Closing...'}
                      {paymentStatus === 'timeout' && 'Payment not detected. Please try again or check your transaction.'}
                      {paymentStatus === 'failed' && 'Something went wrong. Please try again.'}
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
