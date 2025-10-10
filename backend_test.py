import requests
import sys
import json
import time
from datetime import datetime

class SolanaCasinoAPITester:
    def __init__(self, base_url="https://crypto-bet-pwa.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.test_user1 = None
        self.test_user2 = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - FAILED: {details}")

    def test_api_root(self):
        """Test API root endpoint"""
        try:
            response = requests.get(f"{self.api_url}/")
            success = response.status_code == 200
            details = f"Status: {response.status_code}"
            if success:
                data = response.json()
                details += f", Message: {data.get('message', 'No message')}"
            self.log_test("API Root", success, details)
            return success
        except Exception as e:
            self.log_test("API Root", False, str(e))
            return False

    def test_telegram_auth(self, user_number=1):
        """Test Telegram authentication"""
        try:
            # Create mock Telegram auth data
            telegram_id = 123456789 + user_number
            user_data = {
                "telegram_auth_data": {
                    "id": telegram_id,
                    "first_name": f"TestUser{user_number}",
                    "last_name": "Casino",
                    "username": f"testuser{user_number}",
                    "photo_url": "https://example.com/photo.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"  # Using auto hash for testing
                }
            }
            
            response = requests.post(f"{self.api_url}/auth/telegram", json=user_data)
            success = response.status_code == 200
            
            if success:
                user = response.json()
                if user_number == 1:
                    self.test_user1 = user
                else:
                    self.test_user2 = user
                details = f"Created user: {user['first_name']}, ID: {user['id']}, Balance: {user['token_balance']}, Telegram ID: {user['telegram_id']}"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"Telegram Auth User {user_number}", success, details)
            return success
        except Exception as e:
            self.log_test(f"Telegram Auth User {user_number}", False, str(e))
            return False

    def test_get_user(self, user_number=1):
        """Test getting user by ID"""
        test_user = self.test_user1 if user_number == 1 else self.test_user2
        if not test_user:
            self.log_test(f"Get User {user_number}", False, "No test user available")
            return False
        
        try:
            response = requests.get(f"{self.api_url}/users/{test_user['id']}")
            success = response.status_code == 200
            
            if success:
                user_data = response.json()
                details = f"Retrieved user: {user_data['first_name']}, Balance: {user_data['token_balance']}"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"Get User {user_number}", success, details)
            return success
        except Exception as e:
            self.log_test(f"Get User {user_number}", False, str(e))
            return False

    def test_purchase_tokens(self, user_number=1):
        """Test token purchase functionality"""
        test_user = self.test_user1 if user_number == 1 else self.test_user2
        if not test_user:
            self.log_test(f"Purchase Tokens User {user_number}", False, "No test user available")
            return False
        
        try:
            # Test purchasing 1 SOL worth of tokens (should be 1000 tokens)
            purchase_data = {
                "user_id": test_user['id'],
                "sol_amount": 1.0,
                "token_amount": 1000
            }
            
            response = requests.post(f"{self.api_url}/purchase-tokens", json=purchase_data)
            success = response.status_code == 200
            
            if success:
                result = response.json()
                details = f"Purchased {result['tokens_added']} tokens successfully"
                # Update local user balance for subsequent tests
                test_user['token_balance'] += result['tokens_added']
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"Purchase Tokens User {user_number}", success, details)
            return success
        except Exception as e:
            self.log_test(f"Purchase Tokens User {user_number}", False, str(e))
            return False

    def test_get_rooms(self):
        """Test getting active rooms"""
        try:
            response = requests.get(f"{self.api_url}/rooms")
            success = response.status_code == 200
            
            if success:
                data = response.json()
                rooms = data.get('rooms', [])
                details = f"Found {len(rooms)} rooms: "
                for room in rooms:
                    details += f"{room['room_type']}({room['players_count']}/2) "
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Get Rooms", success, details)
            return success, rooms if success else []
        except Exception as e:
            self.log_test("Get Rooms", False, str(e))
            return False, []

    def test_join_room(self, user_number=1, room_type="bronze", bet_amount=200):
        """Test joining a room"""
        test_user = self.test_user1 if user_number == 1 else self.test_user2
        if not test_user:
            self.log_test(f"Join Room User {user_number}", False, "No test user available")
            return False
        
        try:
            join_data = {
                "room_type": room_type,
                "user_id": test_user['id'],
                "bet_amount": bet_amount
            }
            
            response = requests.post(f"{self.api_url}/join-room", json=join_data)
            success = response.status_code == 200
            
            if success:
                result = response.json()
                details = f"User {user_number} joined {room_type} room, position {result['position']}/2, players needed: {result['players_needed']}"
                # Update local user balance
                test_user['token_balance'] -= bet_amount
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"Join Room User {user_number} ({room_type})", success, details)
            return success, result if success else None
        except Exception as e:
            self.log_test(f"Join Room User {user_number} ({room_type})", False, str(e))
            return False, None

    def test_leaderboard(self):
        """Test leaderboard endpoint"""
        try:
            response = requests.get(f"{self.api_url}/leaderboard")
            success = response.status_code == 200
            
            if success:
                data = response.json()
                leaderboard = data.get('leaderboard', [])
                details = f"Leaderboard has {len(leaderboard)} players"
                if leaderboard:
                    top_player = leaderboard[0]
                    details += f", Top: {top_player['first_name']} ({top_player['token_balance']} tokens)"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Leaderboard", success, details)
            return success
        except Exception as e:
            self.log_test("Leaderboard", False, str(e))
            return False

    def test_game_history(self):
        """Test game history endpoint"""
        try:
            response = requests.get(f"{self.api_url}/game-history?limit=5")
            success = response.status_code == 200
            
            if success:
                data = response.json()
                games = data.get('games', [])
                details = f"Found {len(games)} completed games"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Game History", success, details)
            return success
        except Exception as e:
            self.log_test("Game History", False, str(e))
            return False

    def test_user_prizes(self, user_number=1):
        """Test getting user prizes"""
        test_user = self.test_user1 if user_number == 1 else self.test_user2
        if not test_user:
            self.log_test(f"User Prizes User {user_number}", False, "No test user available")
            return False
        
        try:
            response = requests.get(f"{self.api_url}/user/{test_user['id']}/prizes")
            success = response.status_code == 200
            
            if success:
                data = response.json()
                prizes = data.get('prizes', [])
                details = f"User {user_number} has {len(prizes)} prizes"
                if prizes:
                    latest_prize = prizes[0]
                    details += f", Latest: {latest_prize.get('room_type', 'unknown')} room prize"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"User Prizes User {user_number}", success, details)
            return success, prizes if success else []
        except Exception as e:
            self.log_test(f"User Prizes User {user_number}", False, str(e))
            return False, []

    def test_check_winner(self, user_number=1):
        """Test checking if user is a winner"""
        test_user = self.test_user1 if user_number == 1 else self.test_user2
        if not test_user:
            self.log_test(f"Check Winner User {user_number}", False, "No test user available")
            return False
        
        try:
            response = requests.get(f"{self.api_url}/check-winner/{test_user['id']}")
            success = response.status_code == 200
            
            if success:
                data = response.json()
                recent_prizes = data.get('recent_prizes', [])
                details = f"User {user_number} has {len(recent_prizes)} recent prizes"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"Check Winner User {user_number}", success, details)
            return success
        except Exception as e:
            self.log_test(f"Check Winner User {user_number}", False, str(e))
            return False

    def test_two_player_game_flow(self):
        """Test complete 2-player game flow with winner selection"""
        if not self.test_user1 or not self.test_user2:
            self.log_test("2-Player Game Flow", False, "Need both test users")
            return False
        
        try:
            print("\n🎮 Testing 2-Player Game Flow...")
            
            # Both users join the same Bronze room
            bet_amount = 300  # Within Bronze range (150-450)
            
            # User 1 joins first
            success1, result1 = self.test_join_room(1, "bronze", bet_amount)
            if not success1:
                self.log_test("2-Player Game Flow", False, "User 1 failed to join room")
                return False
            
            # User 2 joins second (should trigger game start)
            success2, result2 = self.test_join_room(2, "bronze", bet_amount)
            if not success2:
                self.log_test("2-Player Game Flow", False, "User 2 failed to join room")
                return False
            
            # Wait for game to complete (3 seconds + processing time)
            print("⏳ Waiting for game to complete...")
            time.sleep(5)
            
            # Check if either user has won prizes
            success_prizes1, prizes1 = self.test_user_prizes(1)
            success_prizes2, prizes2 = self.test_user_prizes(2)
            
            if not success_prizes1 or not success_prizes2:
                self.log_test("2-Player Game Flow", False, "Failed to check prizes")
                return False
            
            # One user should have a new prize
            total_new_prizes = len(prizes1) + len(prizes2)
            if total_new_prizes >= 1:
                winner_num = 1 if len(prizes1) > 0 else 2
                details = f"Game completed successfully! User {winner_num} won the prize. Total prizes found: {total_new_prizes}"
                self.log_test("2-Player Game Flow", True, details)
                return True
            else:
                self.log_test("2-Player Game Flow", False, "No winner found after game completion")
                return False
                
        except Exception as e:
            self.log_test("2-Player Game Flow", False, str(e))
            return False

    def test_invalid_endpoints(self):
        """Test error handling for invalid requests"""
        tests = [
            ("Invalid User ID", f"{self.api_url}/users/invalid-id", 404),
            ("Invalid Room Type", f"{self.api_url}/join-room", 422),  # Missing required fields
            ("Invalid Token Purchase", f"{self.api_url}/purchase-tokens", 422)  # Missing required fields
        ]
        
        for test_name, url, expected_status in tests:
            try:
                if "join-room" in url:
                    response = requests.post(url, json={})
                elif "purchase-tokens" in url:
                    response = requests.post(url, json={})
                else:
                    response = requests.get(url)
                
                success = response.status_code == expected_status
                details = f"Expected {expected_status}, got {response.status_code}"
                self.log_test(test_name, success, details)
            except Exception as e:
                self.log_test(test_name, False, str(e))

    def run_all_tests(self):
        """Run all API tests"""
        print("🎰 Starting Solana Casino 2-Player Game Tests...")
        print("=" * 60)
        
        # Basic connectivity
        if not self.test_api_root():
            print("❌ API is not accessible, stopping tests")
            return False
        
        # Create two test users with Telegram authentication
        print("\n👥 Creating Test Users...")
        if not self.test_telegram_auth(1):
            print("❌ User 1 creation failed, stopping tests")
            return False
        
        if not self.test_telegram_auth(2):
            print("❌ User 2 creation failed, stopping tests")
            return False
        
        # Verify user retrieval
        self.test_get_user(1)
        self.test_get_user(2)
        
        # Give both users tokens for betting
        print("\n💰 Purchasing Tokens for Both Users...")
        token_purchase_success1 = self.test_purchase_tokens(1)
        token_purchase_success2 = self.test_purchase_tokens(2)
        
        if not token_purchase_success1 or not token_purchase_success2:
            print("⚠️  Token purchase failed for one or both users!")
        
        # Test room system
        print("\n🏠 Testing Room System...")
        rooms_success, rooms = self.test_get_rooms()
        
        # Test prize endpoints before game
        print("\n🏆 Testing Prize System (Before Game)...")
        self.test_user_prizes(1)
        self.test_user_prizes(2)
        self.test_check_winner(1)
        self.test_check_winner(2)
        
        # Test complete 2-player game flow
        if (rooms_success and self.test_user1 and self.test_user2 and 
            self.test_user1.get('token_balance', 0) >= 300 and 
            self.test_user2.get('token_balance', 0) >= 300):
            print("\n🎮 Testing Complete 2-Player Game Flow...")
            self.test_two_player_game_flow()
        else:
            print("⚠️  Skipping 2-player game flow - insufficient setup")
        
        # Test prize endpoints after game
        print("\n🏆 Testing Prize System (After Game)...")
        self.test_user_prizes(1)
        self.test_user_prizes(2)
        
        # Additional endpoints
        print("\n📊 Testing Additional Endpoints...")
        self.test_leaderboard()
        self.test_game_history()
        
        # Error handling tests
        print("\n🚫 Testing Error Handling...")
        self.test_invalid_endpoints()
        
        # Summary
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"  - {test['name']}: {test['details']}")
        else:
            print("\n✅ All tests passed!")
        
        return self.tests_passed == self.tests_run

def main():
    tester = SolanaCasinoAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())