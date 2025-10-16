# Work for Casino System v8.0 - Complete Documentation

## Overview
The "Work for Casino" system allows users to become casino workers by purchasing access, uploading hidden gifts with photos and coordinates, and having those gifts automatically distributed to game winners based on city matching.

## System Architecture

### 1. City-Based System
Users select a city (London or Paris) after Telegram authentication. This city determines:
- Which game rooms they play in
- Which gifts they can receive as winners
- Where their uploaded gifts will be assigned

### 2. Work Access Purchase
**Cost:** 1000 tokens (symbolic, represents ~10 EUR)
- No actual tokens are deducted from user balance
- Payment is processed via Solana (dynamic EUR/SOL conversion)
- After successful payment, user receives work access

**Payment Flow:**
1. User clicks "Work for Casino" button
2. System calculates SOL equivalent (e.g., 10 EUR = 0.1 SOL if 1 SOL = 100 EUR)
3. Solana payment modal opens with generated wallet address
4. User sends SOL payment
5. System confirms transaction
6. Telegram bot sends confirmation: "Welcome to the Casino Team! Click to start working"

### 3. Gift Upload System

**Requirements:**
- User must have purchased work access
- User must have selected a city

**Upload Fields:**
- **Photo:** Base64 encoded image of the hidden gift
- **Coordinates:** Latitude and longitude of gift location
- **City:** London or Paris (determines which players can receive this gift)

**Database Schema:**
```json
{
  "gift_id": "uuid",
  "creator_user_id": "USER123",
  "creator_telegram_id": 123456789,
  "creator_username": "worker_username",
  "city": "Paris",
  "photo_base64": "data:image/jpeg;base64,...",
  "coordinates": {
    "lat": 48.8566,
    "lng": 2.3522
  },
  "status": "available",
  "assigned_to": null,
  "assigned_to_user_id": null,
  "winner_name": null,
  "winner_city": null,
  "assigned_at": null,
  "delivered": false,
  "created_at": "2025-01-15T12:00:00Z"
}
```

### 4. Automatic Gift Assignment

**Trigger:** When a game finishes and a winner is determined

**Assignment Logic:**
1. Get winner's city from user profile
2. Query database for one available gift in that city:
   ```python
   gift = db.gifts.find_one_and_update(
       {"city": winner_city, "status": "available"},
       {"$set": {
           "status": "assigned",
           "assigned_to": winner_telegram_id,
           "assigned_to_user_id": winner_user_id,
           "winner_name": winner_username,
           "winner_city": winner_city,
           "assigned_at": datetime.now(timezone.utc),
           "delivered": True
       }},
       return_document=True
   )
   ```
3. If gift found → Send Telegram message with gift details
4. If no gift found → Send Telegram message: "No gifts available in your city"

**Telegram Notifications:**

**With Gift:**
```
🎉 Congratulations {username}!
🎁 You have a special gift waiting!

📍 Location: Paris
📊 Coordinates: 48.8566, 2.3522

Check the app for the gift photo and details!

[View Gift Details]
```

**Without Gift:**
```
🎉 Congratulations {username}!

You won the battle!

⚠️ No gifts available in your city right now.
New gifts will be added by casino workers soon!
```

## API Endpoints

### City Management

#### Set User City
```http
POST /api/users/set-city
Content-Type: application/json

{
  "user_id": "USER123",
  "city": "London"
}
```

**Response:**
```json
{
  "success": true,
  "city": "London"
}
```

### Work for Casino

#### Purchase Work Access
```http
POST /api/work/purchase-access
Content-Type: application/json

{
  "user_id": "USER123",
  "payment_signature": "SOL_TRANSACTION_SIGNATURE"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Work access granted! Check Telegram for next steps.",
  "work_access_purchased": true
}
```

#### Check Work Access
```http
GET /api/work/check-access/{user_id}
```

**Response:**
```json
{
  "has_work_access": true,
  "city": "Paris"
}
```

### Gift Management

#### Upload Gift
```http
POST /api/gifts/upload
Content-Type: application/json

{
  "user_id": "USER123",
  "city": "Paris",
  "photo_base64": "data:image/jpeg;base64,...",
  "coordinates": {
    "lat": 48.8566,
    "lng": 2.3522
  }
}
```

**Response:**
```json
{
  "success": true,
  "gift_id": "GIFT456",
  "message": "Gift successfully uploaded in Paris!"
}
```

#### Get Available Gifts Count
```http
GET /api/gifts/available/{city}
```

**Response:**
```json
{
  "city": "London",
  "available_gifts": 15
}
```

### Admin Endpoints (Restricted to @cia_nera)

#### Get All Assigned Gifts
```http
GET /api/admin/gifts/assigned?telegram_username=cia_nera
```

**Response:**
```json
{
  "success": true,
  "total": 28,
  "gifts": [
    {
      "gift_id": "GIFT123",
      "city": "London",
      "creator_user_id": "WORKER456",
      "creator_username": "worker1",
      "assigned_to": 987654321,
      "assigned_to_user_id": "WINNER789",
      "winner_name": "Terror123",
      "winner_city": "London",
      "assigned_at": "2025-01-15T14:30:00Z",
      "delivered": true
    }
  ]
}
```

#### Get Gift Statistics
```http
GET /api/admin/gifts/stats?telegram_username=cia_nera
```

**Response:**
```json
{
  "success": true,
  "total_uploaded": 42,
  "total_assigned": 28,
  "total_pending": 14,
  "breakdown_by_city": {
    "London": {
      "uploaded": 25,
      "assigned": 18
    },
    "Paris": {
      "uploaded": 17,
      "assigned": 10
    }
  }
}
```

## Frontend UI Components

### 1. City Selector (After Auth)
Appears immediately after successful Telegram authentication if user hasn't selected a city yet.

```jsx
Choose your city:
[London] [Paris]
```

### 2. Work for Casino Button
Located on main screen, visible to all authenticated users.

```jsx
<Button onClick={handleWorkForCasino}>
  Work for Casino
</Button>
```

### 3. Work Access Purchase Modal
Shows when user clicks "Work for Casino" without access.

```
Buy Work Access
Cost: 1000 tokens (~10 EUR)

[Purchase via Solana]
```

### 4. Gift Upload Form
Appears after user has work access and clicks "Start Working".

```
Upload Hidden Gift

📸 Photo: [Upload Image]
📍 Latitude: [Input]
📍 Longitude: [Input]
🏙️ City: [London] [Paris]

[Submit Gift]
```

### 5. City Display
Shows selected city in header or main screen:
```
City: London 🏙️
```

## Database Collections

### users
```javascript
{
  id: "uuid",
  telegram_id: 123456789,
  first_name: "John",
  telegram_username: "john_doe",
  city: "London",  // NEW
  work_access_purchased: false,  // NEW
  token_balance: 5000,
  created_at: "2025-01-15T10:00:00Z"
}
```

### gifts
```javascript
{
  gift_id: "uuid",
  creator_user_id: "USER123",
  creator_telegram_id: 123456789,
  city: "Paris",
  photo_base64: "data:image/jpeg;base64,...",
  coordinates: {lat: 48.8566, lng: 2.3522},
  status: "available",  // or "assigned"
  assigned_to: null,
  winner_name: null,
  assigned_at: null,
  created_at: "2025-01-15T12:00:00Z"
}
```

**Indexes:**
- `city + status` (for fast gift queries)
- `assigned_to` (for user gift history)
- `creator_user_id` (for worker tracking)

## Game Flow Integration

### Original Flow (Preserved)
```
T+0s:  room_ready → Show GET READY animation
T+3s:  game_finished → Show Winner Screen
T+6s:  redirect_home → Redirect to Home
```

### Enhanced Flow (With Gifts)
```
T+0s:  room_ready → Show GET READY animation
T+3s:  game_finished → 
       1. Select winner
       2. Assign gift (if city & gift available)
       3. Send Telegram notification
       4. Show Winner Screen to all players
T+6s:  redirect_home → Redirect to Home
```

## Admin Dashboard

### Access Control
Only Telegram user `@cia_nera` can access admin endpoints.

### Admin UI (Optional)
Located at `/admin/gifts` (if implemented):

```
Gift Tracking Dashboard

Total Uploaded: 42
Total Assigned: 28
Total Pending: 14

[City Filter: All | London | Paris]

Gift ID    City     Creator      Winner       Status      Date
#2314      Paris    Worker123    Terror123    ✅ Delivered  Jan 15 2025
#2313      London   Worker456    Player999    ✅ Delivered  Jan 15 2025
#2312      Paris    Worker789    -            ⏳ Pending    Jan 14 2025
```

## Testing Checklist

- [ ] City selection appears after Telegram auth
- [ ] City persists across sessions
- [ ] "Work for Casino" button visible
- [ ] Work access purchase via Solana works
- [ ] Telegram confirmation sent after purchase
- [ ] Gift upload form accepts photo + coordinates
- [ ] Gifts tagged with correct city
- [ ] Game winner receives gift from their city
- [ ] Telegram notification sent to winner
- [ ] Admin can view assigned gifts
- [ ] Admin can view statistics
- [ ] No gifts message when city has no available gifts
- [ ] Game flow still works correctly (GET READY → Winner → Redirect)

## Security Considerations

1. **Admin Authentication:** All admin endpoints verify `telegram_username == "cia_nera"`
2. **Work Access Verification:** Gift upload requires `work_access_purchased == true`
3. **City Validation:** Only "London" and "Paris" are accepted
4. **Photo Size:** Recommend limiting base64 photo size to prevent database bloat
5. **Coordinate Validation:** Ensure lat/lng are valid numbers within reasonable ranges

## Future Enhancements

1. **Gift Photos in Telegram:** Send gift photo directly in Telegram message
2. **Gift Categories:** Different gift types (bronze, silver, gold)
3. **Worker Leaderboard:** Track most active gift uploaders
4. **Gift Expiry:** Auto-remove old, unassigned gifts
5. **Multiple Cities:** Add more cities beyond London and Paris
6. **Gift Preview:** Allow workers to preview their uploaded gifts
7. **Winner Gift Gallery:** UI to view received gifts

## Support

For issues or questions:
- Backend logs: `/var/log/supervisor/backend.err.log`
- Database: MongoDB `test_database` collections: `users`, `gifts`
- Admin access: Contact @cia_nera on Telegram

---

**Last Updated:** January 16, 2025
**Version:** 8.0
**Status:** ✅ Implemented & Documented
