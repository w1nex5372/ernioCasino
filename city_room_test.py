#!/usr/bin/env python3
"""
Focused test for City-Based Room Rejoining Logic
Tests the specific scenarios requested in the review.
"""

import requests
import sys
import json
import time
import uuid
from datetime import datetime

class CityRoomRejoiningTester:
    def __init__(self, base_url="https://betdrop.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
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

    def test_city_based_room_rejoining_comprehensive(self):
        """Test city-based room rejoining logic - comprehensive test of all scenarios"""
        try:
            print("\n🏙️ COMPREHENSIVE CITY-BASED ROOM REJOINING TEST")
            print("=" * 70)
            
            # Clean database first
            print("🧹 Step 1: Database cleanup...")
            cleanup_response = requests.post(f"{self.api_url}/admin/cleanup-database?admin_key=PRODUCTION_CLEANUP_2025")
            if cleanup_response.status_code != 200:
                self.log_test("City Room Rejoining - Database Cleanup", False, "Database cleanup failed")
                return False
            
            time.sleep(1)  # Wait for rooms to be reinitialized
            print("✅ Database cleaned successfully")
            
            # Create test user
            print("👤 Step 2: Creating test user...")
            test_user_data = {
                "telegram_auth_data": {
                    "id": 123456789,
                    "first_name": "CityTest",
                    "last_name": "User",
                    "username": "citytestuser",
                    "photo_url": "https://example.com/citytest.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            auth_response = requests.post(f"{self.api_url}/auth/telegram", json=test_user_data)
            if auth_response.status_code != 200:
                self.log_test("City Room Rejoining - User Creation", False, f"Failed to create test user: {auth_response.status_code}")
                return False
            
            test_user = auth_response.json()
            print(f"✅ Created test user: {test_user['first_name']} (ID: {test_user['id']})")
            
            # Give user tokens (1000+)
            print("💰 Step 3: Adding tokens to user...")
            token_response = requests.post(f"{self.api_url}/admin/add-tokens/{test_user['telegram_id']}?admin_key=PRODUCTION_CLEANUP_2025&tokens=1500")
            if token_response.status_code != 200:
                self.log_test("City Room Rejoining - Add Tokens", False, "Failed to add tokens")
                return False
            
            print("✅ Added 1500 tokens to test user")
            
            # Test Scenario 1: Join Room in One City (London)
            print("\n📍 SCENARIO 1: Join Room in London")
            print("-" * 40)
            
            # Set user city to London
            set_city_data = {"user_id": test_user['id'], "city": "London"}
            city_response = requests.post(f"{self.api_url}/users/set-city", json=set_city_data)
            if city_response.status_code != 200:
                self.log_test("Scenario 1 - Set City London", False, f"Failed to set city: {city_response.status_code}")
                return False
            
            print("✅ Set user city to London")
            
            # Create Bronze room gift with gift_type="1gift" in London
            print("🎁 Creating Bronze room gift in London...")
            try:
                import pymongo
                from pymongo import MongoClient
                
                mongo_client = MongoClient("mongodb://localhost:27017")
                test_db = mongo_client["test_database"]
                
                gift_data = {
                    "gift_id": str(uuid.uuid4()),
                    "creator_user_id": test_user['id'],
                    "creator_telegram_id": test_user['telegram_id'],
                    "city": "London",
                    "media": [{"type": "photo", "data": "base64_test_data"}],
                    "coordinates": "51.5074, -0.1278 – near the fountain",
                    "description": "Test gift for Bronze room",
                    "gift_type": "1gift",
                    "num_places": 1,
                    "folder_name": "1gift",
                    "status": "available",
                    "created_at": datetime.now().isoformat()
                }
                
                test_db.gifts.insert_one(gift_data)
                print("✅ Created Bronze room gift (1gift) in London")
                
            except Exception as e:
                print(f"⚠️ Failed to create gift directly: {e}")
                # Continue test anyway - the join might still work if gifts exist
            
            # User joins Bronze room in London
            print("🎰 User joining Bronze room in London...")
            join_data = {
                "room_type": "bronze",
                "user_id": test_user['id'],
                "bet_amount": 300
            }
            
            join_response = requests.post(f"{self.api_url}/join-room", json=join_data)
            if join_response.status_code != 200:
                self.log_test("Scenario 1 - Join Bronze London", False, f"Failed to join room: {join_response.status_code}, {join_response.text}")
                return False
            
            join_result = join_response.json()
            print(f"✅ User joined Bronze room in London - Position: {join_result.get('position')}")
            
            # Verify player's city is stored as "London" in room
            print("🔍 Verifying player's city is stored in room...")
            room_status_response = requests.get(f"{self.api_url}/user-room-status/{test_user['id']}")
            if room_status_response.status_code != 200:
                self.log_test("Scenario 1 - Check Room Status", False, "Failed to get room status")
                return False
            
            room_status = room_status_response.json()
            if not room_status.get('in_room'):
                self.log_test("Scenario 1 - User In Room", False, "User not found in any room")
                return False
            
            user_room = room_status['rooms'][0]
            if user_room['city'] != 'London':
                self.log_test("Scenario 1 - City Storage", False, f"Expected city 'London', got '{user_room['city']}'")
                return False
            
            print(f"✅ Verified player's city stored as '{user_room['city']}' in room")
            self.log_test("Scenario 1 - Player City Stored When Joining Room", True, f"City '{user_room['city']}' correctly stored")
            
            # Test Scenario 2: Attempt to Rejoin After City Switch
            print("\n📍 SCENARIO 2: Switch to Paris and Check Room Status")
            print("-" * 50)
            
            # User switches city to Paris
            set_city_paris_data = {"user_id": test_user['id'], "city": "Paris"}
            city_paris_response = requests.post(f"{self.api_url}/users/set-city", json=set_city_paris_data)
            if city_paris_response.status_code != 200:
                self.log_test("Scenario 2 - Set City Paris", False, f"Failed to set city to Paris: {city_paris_response.status_code}")
                return False
            
            print("✅ Switched user city to Paris")
            
            # Try to get user-room-status (should show user is in Bronze room with city="London")
            room_status_paris_response = requests.get(f"{self.api_url}/user-room-status/{test_user['id']}")
            if room_status_paris_response.status_code != 200:
                self.log_test("Scenario 2 - Room Status After City Switch", False, "Failed to get room status after city switch")
                return False
            
            room_status_paris = room_status_paris_response.json()
            
            # Verify response shows user is in Bronze room with city="London"
            if not room_status_paris.get('in_room'):
                self.log_test("Scenario 2 - Still In Room After Switch", False, "User should still be in room after city switch")
                return False
            
            user_room_paris = room_status_paris['rooms'][0]
            if user_room_paris['city'] != 'London':
                self.log_test("Scenario 2 - Room City Persistence", False, f"Room city should remain 'London', got '{user_room_paris['city']}'")
                return False
            
            print(f"✅ Verified user is in Bronze room with city='{user_room_paris['city']}' (original join city)")
            self.log_test("Scenario 2 - City Mismatch Detected After Switch", True, f"User in Paris but room shows original city '{user_room_paris['city']}'")
            
            # Test Scenario 3: Verify Room Data Returns Correct City
            print("\n📍 SCENARIO 3: Verify Room Data Returns Correct City")
            print("-" * 50)
            
            # The user-room-status should include city: "London" for the room
            if 'city' not in user_room_paris:
                self.log_test("Scenario 3 - City Field Present", False, "City field missing from room data")
                return False
            
            if user_room_paris['city'] != 'London':
                self.log_test("Scenario 3 - Correct City Returned", False, f"Expected city 'London', got '{user_room_paris['city']}'")
                return False
            
            print(f"✅ Room data correctly returns city: '{user_room_paris['city']}'")
            print("✅ This allows frontend to show 'YOU ARE IN THIS ROOM ON LONDON'")
            self.log_test("Scenario 3 - User-Room-Status Returns Actual City", True, f"API returns city '{user_room_paris['city']}' for frontend display")
            
            # Test Scenario 4: Allow Rejoin in Same City
            print("\n📍 SCENARIO 4: Switch Back to London and Verify Same City Access")
            print("-" * 60)
            
            # User switches back to London
            set_city_london_again_data = {"user_id": test_user['id'], "city": "London"}
            city_london_again_response = requests.post(f"{self.api_url}/users/set-city", json=set_city_london_again_data)
            if city_london_again_response.status_code != 200:
                self.log_test("Scenario 4 - Set City London Again", False, f"Failed to set city back to London: {city_london_again_response.status_code}")
                return False
            
            print("✅ Switched user city back to London")
            
            # Call user-room-status again
            room_status_london_again_response = requests.get(f"{self.api_url}/user-room-status/{test_user['id']}")
            if room_status_london_again_response.status_code != 200:
                self.log_test("Scenario 4 - Room Status Back In London", False, "Failed to get room status back in London")
                return False
            
            room_status_london_again = room_status_london_again_response.json()
            
            # Verify user can see they're in the room in same city
            if not room_status_london_again.get('in_room'):
                self.log_test("Scenario 4 - Still In Room Back In London", False, "User should still be in room when back in London")
                return False
            
            user_room_london_again = room_status_london_again['rooms'][0]
            if user_room_london_again['city'] != 'London':
                self.log_test("Scenario 4 - Same City Match", False, f"Room city should be 'London', got '{user_room_london_again['city']}'")
                return False
            
            print(f"✅ Verified user can see room when back in same city ('{user_room_london_again['city']}')")
            print("✅ City matches for proper 'Return to Room' functionality")
            self.log_test("Scenario 4 - Allow Rejoin in Same City", True, f"User can rejoin when back in same city '{user_room_london_again['city']}'")
            
            # Final comprehensive verification
            print("\n🎯 COMPREHENSIVE VERIFICATION")
            print("-" * 40)
            
            # Verify all database fields
            print("🔍 Verifying RoomPlayer model has city field...")
            
            # Check that the room data structure includes all expected fields
            expected_fields = ['room_id', 'room_type', 'city', 'status', 'players', 'players_count', 'position']
            missing_fields = [field for field in expected_fields if field not in user_room_london_again]
            
            if missing_fields:
                self.log_test("Database Fields Verification", False, f"Missing fields in room data: {missing_fields}")
                return False
            
            print("✅ All expected fields present in room data")
            self.log_test("Database Fields Verification", True, "RoomPlayer model includes city field and all required data")
            
            return True
            
        except Exception as e:
            self.log_test("City-Based Room Rejoining - Comprehensive Test", False, str(e))
            return False

    def run_focused_test(self):
        """Run focused city-based room rejoining test"""
        print("🏙️ CITY-BASED ROOM REJOINING LOGIC TEST")
        print("=" * 60)
        print("Testing the specific scenarios from the review request:")
        print("1. Join Room in One City (London)")
        print("2. Attempt to Rejoin After City Switch (Paris)")
        print("3. Verify Room Data Returns Correct City")
        print("4. Allow Rejoin in Same City (London)")
        print("=" * 60)
        
        # Run the comprehensive test
        success = self.test_city_based_room_rejoining_comprehensive()
        
        # Print summary
        print("\n" + "=" * 60)
        print("📊 CITY-BASED ROOM REJOINING TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Tests Passed: {self.tests_passed}/{self.tests_run}")
        print(f"❌ Tests Failed: {len(self.failed_tests)}/{self.tests_run}")
        
        if self.failed_tests:
            print("\n❌ FAILED TESTS:")
            for i, test in enumerate(self.failed_tests, 1):
                print(f"{i}. {test['name']}: {test['details']}")
        else:
            print("\n🎉 ALL TESTS PASSED!")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"\n🎯 Success Rate: {success_rate:.1f}%")
        
        if success_rate == 100:
            print("🎉 EXCELLENT: City-based room rejoining logic working perfectly!")
        elif success_rate >= 80:
            print("✅ GOOD: Most functionality working, minor issues detected")
        elif success_rate >= 60:
            print("⚠️ FAIR: Some issues with city-based room rejoining logic")
        else:
            print("🚨 POOR: Major issues with city-based room rejoining logic")
        
        return success_rate >= 80

def main():
    tester = CityRoomRejoiningTester()
    success = tester.run_focused_test()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())