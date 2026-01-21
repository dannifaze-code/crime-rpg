# Firebase Security Rules Setup

## Issue
You're seeing `PERMISSION_DENIED` errors in the console because the Firebase Realtime Database security rules need to be configured.

## Errors You're Seeing
```
Error: [GoogleAuth] Failed to save to cloud: Error {code: "PERMISSION_DENIED"}
FIREBASE WARNING: set at /users/{uid}/lastSave failed: permission_denied
```

## Solution

### Option 1: Using Firebase Console (Recommended)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `crime-rpg-leaderboards`
3. In the left sidebar, click **Realtime Database**
4. Click the **Rules** tab at the top
5. Replace the existing rules with the contents of `database.rules.json`
6. Click **Publish**

### Option 2: Using Firebase CLI

If you have Firebase CLI installed:

```bash
firebase deploy --only database
```

## What These Rules Do

The security rules in `database.rules.json` configure the following permissions:

### 1. User Data (`/users/{uid}/`)
```json
".read": "$uid === auth.uid",
".write": "$uid === auth.uid"
```
- Users can only read/write their own data
- Prevents users from accessing other users' game states

### 2. Leaderboard (`/leaderboard/`)
```json
".read": true,
".write": "auth != null && (!data.exists() || data.child('accountId').val() === auth.uid)"
```
- Everyone can read the leaderboard
- Only authenticated users can write
- Users can only update their own leaderboard entry

### 3. Global Chat (`/global_chat/`)
```json
".read": true,
".write": "auth != null"
```
- Everyone can read messages
- Only authenticated users can send messages

### 4. Private Chats (`/private_chats/`)
```json
".read": "auth != null",
".write": "auth != null"
```
- Only authenticated users can access private chats

## Affected Functionality

These paths are currently failing due to missing permissions:

1. **Game Save** - `/users/{uid}/gameState` - Saves your game progress to cloud
2. **Save Timestamp** - `/users/{uid}/lastSave` - Records when game was last saved
3. **Login Timestamp** - `/users/{uid}/lastLogin` - Records last login time
4. **Session Management** - `/users/{uid}/activeSession` - Tracks active sessions
5. **User Profile** - `/users/{uid}/` - Stores user profile data

## After Applying Rules

Once you apply these rules:
- ✅ The `PERMISSION_DENIED` errors will stop appearing
- ✅ Game saves to cloud will work properly
- ✅ All Firebase operations will function as intended
- ✅ User data will be properly secured

## Testing

After applying the rules, refresh your game and check the console. You should see:
- ✅ `[GoogleAuth] ✅ Saved to cloud` (instead of permission errors)
- ✅ `Data written to Firebase successfully!`
- ❌ No more `PERMISSION_DENIED` warnings

## Current Status

Right now, your game is working because:
- Data is being saved to **localStorage** (local browser storage)
- Leaderboard reads are working (read permissions exist)
- The errors are only affecting cloud saves, not core gameplay

However, without these rules:
- Your game progress won't sync across devices
- Cloud backup functionality is disabled
- Session management is impaired
