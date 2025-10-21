#!/usr/bin/env python3
"""
Admin Gift Upload Fix Testing Script
Tests the specific fix for admin user (telegram_id: 1793011013) gift upload bypass
"""

import requests
import json
from datetime import datetime

class AdminGiftUploadTester:
    def __init__(self, base_url="https://telebet-2.preview.emergentagent.com"):
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
            if details:
                print(f"   {details}")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - FAILED")
            if details:
                print(f"   {details}")

    def test_admin_bypass_without_work_access(self):
        """Test Scenario 1: Admin User Gift Upload (Without work_access_purchased)"""
        try:
            print("\n🔑 SCENARIO 1: Admin User Gift Upload (Without work_access_purchased)")
            print("=" * 70)
            
            # Create admin user with telegram_id 1793011013
            admin_data = {
                "telegram_auth_data": {
                    "id": 1793011013,  # Admin telegram_id from review request
                    "first_name": "AdminTest",
                    "last_name": "User",
                    "username": "admin_test",
                    "photo_url": "https://example.com/admin.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            print("👤 Creating admin user (telegram_id: 1793011013)...")
            auth_response = requests.post(f"{self.api_url}/auth/telegram", json=admin_data)
            if auth_response.status_code != 200:
                self.log_test("Admin User Creation", False, f"Failed: {auth_response.status_code}")
                return False
            
            admin_user = auth_response.json()
            print(f"✅ Admin user created: {admin_user['first_name']} (ID: {admin_user['telegram_id']})")
            
            # Verify work_access_purchased is False
            user_response = requests.get(f"{self.api_url}/users/{admin_user['id']}")
            if user_response.status_code != 200:
                self.log_test("Admin User Verification", False, "Failed to get user data")
                return False
            
            user_data = user_response.json()
            work_access = user_data.get('work_access_purchased', False)
            print(f"📊 Admin work_access_purchased: {work_access}")
            
            if work_access:
                print("⚠️  Admin already has work access - this is unexpected but test will continue")
            
            # Set admin city to London
            print("🏙️ Setting admin city to London...")
            city_data = {"user_id": admin_user['id'], "city": "London"}
            city_response = requests.post(f"{self.api_url}/users/set-city", json=city_data)
            if city_response.status_code != 200:
                self.log_test("Admin City Setup", False, f"Failed: {city_response.status_code}")
                return False
            
            # Test photo data (1x1 pixel PNG)
            test_photo_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
            
            # Try to upload 10 gifts to London
            print("🎁 Attempting to upload 10 gifts to London...")
            upload_data = {
                "user_id": admin_user['id'],
                "gifts": [
                    {
                        "coordinates": "51.5074, -0.1278 – near the fountain",
                        "media": [{"type": "photo", "data": test_photo_base64}],
                        "description": f"Admin test gift {i+1}"
                    } for i in range(10)
                ],
                "gift_count_per_upload": 10
            }
            
            upload_response = requests.post(f"{self.api_url}/work/upload-gifts", json=upload_data)
            
            if upload_response.status_code == 200:
                result = upload_response.json()
                uploaded_count = result.get('uploaded_count', 0)
                credits_used = result.get('credits_used', 0)
                remaining_credits = result.get('remaining_credits', 0)
                
                print(f"📊 Upload Results:")
                print(f"   - Uploaded: {uploaded_count} gifts")
                print(f"   - Credits used: {credits_used}")
                print(f"   - Remaining credits: {remaining_credits}")
                
                # Verify admin bypass worked correctly
                if uploaded_count == 10 and credits_used == 0 and remaining_credits == 999999:
                    self.log_test("Admin Bypass Without Work Access", True, 
                                f"Admin uploaded {uploaded_count} gifts without work access, unlimited credits")
                    return True, admin_user
                else:
                    self.log_test("Admin Bypass Without Work Access", False, 
                                f"Wrong credit handling: uploaded={uploaded_count}, used={credits_used}, remaining={remaining_credits}")
                    return False, None
            else:
                error_response = upload_response.json() if upload_response.headers.get('content-type', '').startswith('application/json') else {"detail": upload_response.text}
                self.log_test("Admin Bypass Without Work Access", False, 
                            f"Upload failed: Status {upload_response.status_code}, Error: {error_response.get('detail', 'Unknown')}")
                return False, None
                
        except Exception as e:
            self.log_test("Admin Bypass Without Work Access", False, str(e))
            return False, None

    def test_admin_unlimited_credits(self, admin_user):
        """Test Scenario 2: Admin User Gift Credits (Unlimited)"""
        try:
            print("\n💳 SCENARIO 2: Admin User Gift Credits (Unlimited)")
            print("=" * 70)
            
            test_photo_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
            
            print("🔄 Testing multiple upload batches...")
            total_uploaded = 0
            
            for batch in range(3):  # Upload 3 batches
                print(f"📦 Batch {batch + 1}: Uploading 10 more gifts...")
                
                upload_data = {
                    "user_id": admin_user['id'],
                    "gifts": [
                        {
                            "coordinates": f"51.{5074 + batch}, -0.{1278 + batch} – batch {batch+1} location {i+1}",
                            "media": [{"type": "photo", "data": test_photo_base64}],
                            "description": f"Batch {batch+1} gift {i+1} by admin"
                        } for i in range(10)
                    ],
                    "gift_count_per_upload": 10
                }
                
                upload_response = requests.post(f"{self.api_url}/work/upload-gifts", json=upload_data)
                
                if upload_response.status_code != 200:
                    self.log_test("Admin Unlimited Credits", False, 
                                f"Batch {batch+1} failed: {upload_response.status_code}")
                    return False
                
                result = upload_response.json()
                batch_uploaded = result.get('uploaded_count', 0)
                remaining_credits = result.get('remaining_credits', 0)
                
                total_uploaded += batch_uploaded
                print(f"   ✅ Batch {batch+1}: {batch_uploaded} gifts uploaded, {remaining_credits} credits remaining")
                
                # Verify unlimited credits
                if remaining_credits != 999999:
                    self.log_test("Admin Unlimited Credits", False, 
                                f"Credits not unlimited after batch {batch+1}: {remaining_credits}")
                    return False
            
            self.log_test("Admin Unlimited Credits", True, 
                        f"Admin uploaded {total_uploaded} gifts across 3 batches with unlimited credits")
            return True
            
        except Exception as e:
            self.log_test("Admin Unlimited Credits", False, str(e))
            return False

    def test_regular_user_blocked(self):
        """Test Scenario 3: Regular User Without Credits"""
        try:
            print("\n🚫 SCENARIO 3: Regular User Without Credits")
            print("=" * 70)
            
            # Create regular user
            regular_data = {
                "telegram_auth_data": {
                    "id": 987654321,  # Non-admin telegram_id
                    "first_name": "RegularTest",
                    "last_name": "User",
                    "username": "regular_test",
                    "photo_url": "https://example.com/regular.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            print("👤 Creating regular user (telegram_id: 987654321)...")
            auth_response = requests.post(f"{self.api_url}/auth/telegram", json=regular_data)
            if auth_response.status_code != 200:
                self.log_test("Regular User Creation", False, f"Failed: {auth_response.status_code}")
                return False
            
            regular_user = auth_response.json()
            print(f"✅ Regular user created: {regular_user['first_name']} (ID: {regular_user['telegram_id']})")
            
            # Set user city
            city_data = {"user_id": regular_user['id'], "city": "London"}
            requests.post(f"{self.api_url}/users/set-city", json=city_data)
            
            # Try to upload without work access
            print("🎁 Attempting to upload gifts without work access...")
            test_photo_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
            
            upload_data = {
                "user_id": regular_user['id'],
                "gifts": [
                    {
                        "coordinates": "51.5074, -0.1278 – regular user test",
                        "media": [{"type": "photo", "data": test_photo_base64}],
                        "description": "Test gift by regular user"
                    }
                ],
                "gift_count_per_upload": 10
            }
            
            upload_response = requests.post(f"{self.api_url}/work/upload-gifts", json=upload_data)
            
            if upload_response.status_code == 403:
                error_response = upload_response.json()
                error_detail = error_response.get('detail', '')
                print(f"✅ Regular user correctly blocked: {error_detail}")
                
                if 'Work access not purchased' in error_detail:
                    self.log_test("Regular User Blocked Without Credits", True, 
                                f"Correctly blocked: {error_detail}")
                    return True
                else:
                    self.log_test("Regular User Blocked Without Credits", False, 
                                f"Wrong error message: {error_detail}")
                    return False
            else:
                self.log_test("Regular User Blocked Without Credits", False, 
                            f"User was not blocked! Status: {upload_response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Regular User Blocked Without Credits", False, str(e))
            return False

    def test_gift_database_verification(self, admin_user):
        """Test Scenario 4: Verify Upload Success - Gifts created in database"""
        try:
            print("\n🗄️ SCENARIO 4: Verify Upload Success - Gifts created in database")
            print("=" * 70)
            
            print("🔍 Checking available gifts in London...")
            available_response = requests.get(f"{self.api_url}/gifts/available/London")
            
            if available_response.status_code != 200:
                self.log_test("Gift Database Verification", False, 
                            f"Failed to check gifts: {available_response.status_code}")
                return False
            
            available_data = available_response.json()
            gift_count = available_data.get('count', 0)
            
            print(f"📊 Available gifts in London: {gift_count}")
            
            if gift_count >= 40:  # We uploaded 40 gifts total (10 + 30 from batches)
                self.log_test("Gift Database Verification", True, 
                            f"Gifts successfully created in database: {gift_count} available")
                return True
            else:
                self.log_test("Gift Database Verification", False, 
                            f"Expected at least 40 gifts, found {gift_count}")
                return False
                
        except Exception as e:
            self.log_test("Gift Database Verification", False, str(e))
            return False

    def run_admin_gift_upload_tests(self):
        """Run all admin gift upload fix tests"""
        print("🔧 ADMIN GIFT UPLOAD FIX TESTING")
        print("=" * 70)
        print("Testing the fix for admin user (telegram_id: 1793011013) gift upload bypass")
        print("Issue: Admin could not upload gifts because backend checked work_access_purchased BEFORE admin bypass")
        print("Fix: Reordered checks to prioritize admin bypass first")
        print()
        
        # Test 1: Admin bypass without work access
        admin_success, admin_user = self.test_admin_bypass_without_work_access()
        
        if admin_success and admin_user:
            # Test 2: Admin unlimited credits
            credits_success = self.test_admin_unlimited_credits(admin_user)
            
            # Test 4: Database verification
            db_success = self.test_gift_database_verification(admin_user)
        else:
            credits_success = False
            db_success = False
        
        # Test 3: Regular user blocked
        blocked_success = self.test_regular_user_blocked()
        
        # Summary
        print("\n" + "=" * 70)
        print("📊 ADMIN GIFT UPLOAD FIX TEST RESULTS")
        print("=" * 70)
        
        total_tests = 4
        passed_tests = sum([admin_success, credits_success, blocked_success, db_success])
        
        print(f"Tests Passed: {passed_tests}/{total_tests}")
        print()
        
        if admin_success:
            print("✅ Admin Bypass Works: Admin can upload gifts without work_access_purchased")
        else:
            print("❌ Admin Bypass Failed: Admin cannot upload gifts")
            
        if credits_success:
            print("✅ Admin Unlimited Credits: Admin uploads don't deduct credits")
        else:
            print("❌ Admin Credits Failed: Admin credit handling incorrect")
            
        if blocked_success:
            print("✅ Regular User Blocked: Regular users still require credits/access")
        else:
            print("❌ Regular User Not Blocked: Regular user validation failed")
            
        if db_success:
            print("✅ Database Creation: Gifts correctly created in database")
        else:
            print("❌ Database Creation Failed: Gifts not found in database")
        
        print()
        
        if passed_tests == total_tests:
            print("🎉 ALL TESTS PASSED - Admin gift upload fix is working correctly!")
            print("✅ Admin bypass prioritized before work_access_purchased check")
            print("✅ Admin has unlimited gift credits (999999)")
            print("✅ Regular users still require proper access/credits")
            print("✅ Gifts are successfully created in database")
        else:
            print(f"⚠️  {total_tests - passed_tests} tests failed - Admin gift upload fix needs attention")
            
            if self.failed_tests:
                print("\n❌ Failed Tests:")
                for test in self.failed_tests:
                    print(f"  - {test['name']}: {test['details']}")
        
        return passed_tests == total_tests

if __name__ == "__main__":
    tester = AdminGiftUploadTester()
    success = tester.run_admin_gift_upload_tests()
    exit(0 if success else 1)