import requests
import sys
import json
from datetime import datetime

class SolanaCasinoAPITester:
    def __init__(self, base_url="https://crypto-gamble.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.test_user = None
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

    def test_create_user(self):
        """Test user creation"""
        try:
            user_data = {
                "username": f"test_user_{datetime.now().strftime('%H%M%S')}",
                "wallet_address": "mock_wallet_address_123"
            }
            
            response = requests.post(f"{self.api_url}/users", json=user_data)
            success = response.status_code == 200
            
            if success:
                self.test_user = response.json()
                details = f"Created user: {self.test_user['username']}, ID: {self.test_user['id']}, Balance: {self.test_user['token_balance']}"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Create User", success, details)
            return success
        except Exception as e:
            self.log_test("Create User", False, str(e))
            return False

    def test_get_user(self):
        """Test getting user by ID"""
        if not self.test_user:
            self.log_test("Get User", False, "No test user available")
            return False
        
        try:
            response = requests.get(f"{self.api_url}/users/{self.test_user['id']}")
            success = response.status_code == 200
            
            if success:
                user_data = response.json()
                details = f"Retrieved user: {user_data['username']}, Balance: {user_data['token_balance']}"
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Get User", success, details)
            return success
        except Exception as e:
            self.log_test("Get User", False, str(e))
            return False

    def test_purchase_tokens(self):
        """Test token purchase functionality"""
        if not self.test_user:
            self.log_test("Purchase Tokens", False, "No test user available")
            return False
        
        try:
            # Test purchasing 1 SOL worth of tokens (should be 1000 tokens)
            purchase_data = {
                "user_id": self.test_user['id'],
                "sol_amount": 1.0,
                "token_amount": 1000
            }
            
            response = requests.post(f"{self.api_url}/purchase-tokens", json=purchase_data)
            success = response.status_code == 200
            
            if success:
                result = response.json()
                details = f"Purchased {result['tokens_added']} tokens successfully"
                # Update local user balance for subsequent tests
                self.test_user['token_balance'] += result['tokens_added']
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Purchase Tokens", success, details)
            return success
        except Exception as e:
            self.log_test("Purchase Tokens", False, str(e))
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
                    details += f"{room['room_type']}({room['players_count']}/10) "
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test("Get Rooms", success, details)
            return success, rooms if success else []
        except Exception as e:
            self.log_test("Get Rooms", False, str(e))
            return False, []

    def test_join_room(self, room_type="bronze", bet_amount=200):
        """Test joining a room"""
        if not self.test_user:
            self.log_test("Join Room", False, "No test user available")
            return False
        
        try:
            join_data = {
                "room_type": room_type,
                "user_id": self.test_user['id'],
                "bet_amount": bet_amount
            }
            
            response = requests.post(f"{self.api_url}/join-room", json=join_data)
            success = response.status_code == 200
            
            if success:
                result = response.json()
                details = f"Joined {room_type} room, position {result['position']}/10, players needed: {result['players_needed']}"
                # Update local user balance
                self.test_user['token_balance'] -= bet_amount
            else:
                details = f"Status: {response.status_code}, Response: {response.text}"
            
            self.log_test(f"Join Room ({room_type})", success, details)
            return success
        except Exception as e:
            self.log_test(f"Join Room ({room_type})", False, str(e))
            return False

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
                    details += f", Top: {top_player['username']} ({top_player['token_balance']} tokens)"
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
        print("🎰 Starting Solana Casino API Tests...")
        print("=" * 50)
        
        # Basic connectivity
        if not self.test_api_root():
            print("❌ API is not accessible, stopping tests")
            return False
        
        # User management tests
        if not self.test_create_user():
            print("❌ User creation failed, stopping tests")
            return False
        
        self.test_get_user()
        
        # Token purchase test (critical for the reported issue)
        token_purchase_success = self.test_purchase_tokens()
        if not token_purchase_success:
            print("⚠️  Token purchase failed - this matches the reported issue!")
        
        # Room and game tests
        rooms_success, rooms = self.test_get_rooms()
        if rooms_success and self.test_user and self.test_user.get('token_balance', 0) >= 200:
            self.test_join_room("bronze", 200)
        
        # Additional endpoints
        self.test_leaderboard()
        self.test_game_history()
        
        # Error handling tests
        self.test_invalid_endpoints()
        
        # Summary
        print("\n" + "=" * 50)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"  - {test['name']}: {test['details']}")
        
        return self.tests_passed == self.tests_run

def main():
    tester = SolanaCasinoAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())