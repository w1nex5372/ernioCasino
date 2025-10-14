"""
Load Testing Script for Casino Backend
Tests authentication and payment endpoints under high concurrency
"""

import asyncio
import aiohttp
import time
import statistics
from datetime import datetime
import json

# Configuration
API_URL = "https://gamepay-solution.preview.emergentagent.com/api"
CONCURRENT_USERS = 100  # Start with 100, can scale to 1000
TEST_DURATION = 60  # seconds

# Metrics
metrics = {
    "auth_success": 0,
    "auth_failed": 0,
    "auth_times": [],
    "payment_success": 0,
    "payment_failed": 0,
    "payment_times": [],
    "errors": [],
    "total_requests": 0
}


async def test_authentication(session, user_id):
    """Test authentication endpoint"""
    start_time = time.time()
    
    try:
        # Simulate Telegram auth data
        auth_data = {
            "telegram_id": 100000000 + user_id,
            "first_name": f"LoadTest{user_id}",
            "last_name": "User",
            "username": f"loadtest{user_id}",
            "photo_url": "",
            "auth_date": int(time.time()),
            "hash": "test_hash"
        }
        
        async with session.post(
            f"{API_URL}/auth/telegram",
            json={"telegram_data": auth_data},
            timeout=aiohttp.ClientTimeout(total=10)
        ) as response:
            elapsed = time.time() - start_time
            
            if response.status == 200:
                metrics["auth_success"] += 1
                metrics["auth_times"].append(elapsed)
                return True
            else:
                metrics["auth_failed"] += 1
                metrics["errors"].append(f"Auth {response.status}")
                return False
                
    except Exception as e:
        elapsed = time.time() - start_time
        metrics["auth_failed"] += 1
        metrics["errors"].append(f"Auth error: {str(e)[:50]}")
        return False
    finally:
        metrics["total_requests"] += 1


async def test_sol_price(session):
    """Test SOL price endpoint"""
    start_time = time.time()
    
    try:
        async with session.get(
            f"{API_URL}/sol-eur-price",
            timeout=aiohttp.ClientTimeout(total=5)
        ) as response:
            elapsed = time.time() - start_time
            
            if response.status == 200:
                return True, elapsed
            return False, elapsed
                
    except Exception as e:
        return False, time.time() - start_time


async def test_payment_creation(session, user_id):
    """Test payment wallet creation"""
    start_time = time.time()
    
    try:
        async with session.post(
            f"{API_URL}/purchase-tokens",
            json={
                "user_id": f"loadtest-{user_id}",
                "token_amount": 500
            },
            timeout=aiohttp.ClientTimeout(total=15)
        ) as response:
            elapsed = time.time() - start_time
            
            if response.status == 200:
                metrics["payment_success"] += 1
                metrics["payment_times"].append(elapsed)
                return True
            else:
                metrics["payment_failed"] += 1
                metrics["errors"].append(f"Payment {response.status}")
                return False
                
    except Exception as e:
        elapsed = time.time() - start_time
        metrics["payment_failed"] += 1
        metrics["errors"].append(f"Payment error: {str(e)[:50]}")
        return False
    finally:
        metrics["total_requests"] += 1


async def user_simulation(user_id, session):
    """Simulate a single user's actions"""
    try:
        # 1. Authenticate
        auth_success = await test_authentication(session, user_id)
        
        if not auth_success:
            return
        
        await asyncio.sleep(0.1)  # Small delay between actions
        
        # 2. Check SOL price
        await test_sol_price(session)
        
        await asyncio.sleep(0.2)
        
        # 3. Create payment (only some users to avoid overwhelming)
        if user_id % 10 == 0:  # 10% of users create payments
            await test_payment_creation(session, user_id)
            
    except Exception as e:
        metrics["errors"].append(f"User {user_id} error: {str(e)[:50]}")


async def run_load_test():
    """Run load test with concurrent users"""
    print("=" * 80)
    print("🚀 CASINO BACKEND LOAD TEST")
    print("=" * 80)
    print(f"API URL: {API_URL}")
    print(f"Concurrent Users: {CONCURRENT_USERS}")
    print(f"Test Duration: {TEST_DURATION}s")
    print()
    print("Starting in 3 seconds...")
    await asyncio.sleep(3)
    
    start_time = time.time()
    
    # Create session with connection pooling
    connector = aiohttp.TCPConnector(
        limit=CONCURRENT_USERS * 2,  # Max connections
        limit_per_host=CONCURRENT_USERS,
        ttl_dns_cache=300
    )
    
    async with aiohttp.ClientSession(connector=connector) as session:
        # Wave 1: Simultaneous login burst
        print(f"\n🌊 Wave 1: {CONCURRENT_USERS} simultaneous logins...")
        tasks = [user_simulation(i, session) for i in range(CONCURRENT_USERS)]
        await asyncio.gather(*tasks, return_exceptions=True)
        
        wave1_time = time.time() - start_time
        print(f"   Completed in {wave1_time:.2f}s")
        
        # Print interim results
        print_metrics()
        
        # Wave 2: Sustained load
        print(f"\n🌊 Wave 2: Sustained load for {TEST_DURATION - wave1_time:.0f}s...")
        remaining_time = TEST_DURATION - wave1_time
        
        if remaining_time > 0:
            rounds = int(remaining_time / 5)  # Test every 5 seconds
            for round_num in range(rounds):
                print(f"   Round {round_num + 1}/{rounds}...")
                tasks = [user_simulation(i + CONCURRENT_USERS * (round_num + 1), session) 
                        for i in range(CONCURRENT_USERS // 5)]  # 20% concurrent each round
                await asyncio.gather(*tasks, return_exceptions=True)
                await asyncio.sleep(5)
    
    total_time = time.time() - start_time
    
    # Final results
    print("\n" + "=" * 80)
    print("📊 FINAL RESULTS")
    print("=" * 80)
    print_metrics(final=True)
    print(f"\nTotal Test Duration: {total_time:.2f}s")
    print(f"Requests Per Second: {metrics['total_requests'] / total_time:.2f}")
    
    # Performance rating
    success_rate = (metrics["auth_success"] + metrics["payment_success"]) / max(metrics["total_requests"], 1) * 100
    avg_auth_time = statistics.mean(metrics["auth_times"]) if metrics["auth_times"] else 0
    
    print("\n🎯 PERFORMANCE RATING:")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Avg Auth Time: {avg_auth_time:.3f}s")
    
    if success_rate > 95 and avg_auth_time < 1.0:
        print("   Rating: ⭐⭐⭐⭐⭐ EXCELLENT")
    elif success_rate > 90 and avg_auth_time < 2.0:
        print("   Rating: ⭐⭐⭐⭐ GOOD")
    elif success_rate > 80:
        print("   Rating: ⭐⭐⭐ ACCEPTABLE")
    else:
        print("   Rating: ⭐⭐ NEEDS IMPROVEMENT")


def print_metrics(final=False):
    """Print current metrics"""
    print("\n📈 Metrics:")
    print(f"   Authentication: {metrics['auth_success']} success, {metrics['auth_failed']} failed")
    print(f"   Payments: {metrics['payment_success']} success, {metrics['payment_failed']} failed")
    print(f"   Total Requests: {metrics['total_requests']}")
    
    if metrics["auth_times"]:
        print(f"\n⏱️  Auth Response Times:")
        print(f"   Min: {min(metrics['auth_times']):.3f}s")
        print(f"   Max: {max(metrics['auth_times']):.3f}s")
        print(f"   Avg: {statistics.mean(metrics['auth_times']):.3f}s")
        print(f"   Median: {statistics.median(metrics['auth_times']):.3f}s")
    
    if metrics["payment_times"]:
        print(f"\n💳 Payment Response Times:")
        print(f"   Min: {min(metrics['payment_times']):.3f}s")
        print(f"   Max: {max(metrics['payment_times']):.3f}s")
        print(f"   Avg: {statistics.mean(metrics['payment_times']):.3f}s")
    
    if final and metrics["errors"]:
        print(f"\n⚠️  Errors ({len(metrics['errors'])}):")
        # Count error types
        error_counts = {}
        for error in metrics["errors"]:
            error_counts[error] = error_counts.get(error, 0) + 1
        
        for error, count in sorted(error_counts.items(), key=lambda x: x[1], reverse=True)[:5]:
            print(f"   {error}: {count}x")


if __name__ == "__main__":
    print("\n🔧 Load Testing Tool for Casino Backend")
    print("=" * 80)
    
    try:
        asyncio.run(run_load_test())
    except KeyboardInterrupt:
        print("\n\n❌ Test interrupted by user")
        print_metrics(final=True)
    except Exception as e:
        print(f"\n\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
