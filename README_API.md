# API Documentation & Setup

This document covers setup, the current API shape, and the privacy/security defaults introduced for GDPR and EU AI Act readiness.

## 1. Prerequisites

- Docker and Docker Compose
- Node.js 18+
- npm

## 2. Local Setup

### Step 1: Start the Database

```bash
docker-compose up -d
```

### Step 2: Apply Migrations and Seed Data

```bash
npx prisma migrate dev
```

### Step 3: Start the Application

```bash
npm run start:dev
```

The API listens on `http://localhost:3001`.

## 2.1 Recommended Environment Variables

```bash
JWT_SECRET=change-me
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
OSRM_BASE_URL=http://localhost:5000
ROUTE_AI_MODEL=gpt-5-mini
QUESTIONS_AI_MODEL=gpt-5-mini
MESSAGE_RETENTION_DAYS=90
PENDING_FRIEND_REQUEST_RETENTION_DAYS=30
ROUTE_RETENTION_DAYS=30
PRESENCE_RETENTION_DAYS=7
FRIEND_LOCATION_PRECISION_DECIMALS=3
```

## 2.2 Privacy and AI Defaults

- Public user endpoints no longer expose exact location or privacy settings.
- Location sharing is opt-in through `/users/privacy`.
- External AI processing is opt-in through `/users/privacy`.
- Route endpoints carrying coordinates now use `POST` bodies, not query strings.
- Public OSRM routing is disabled unless `OSRM_BASE_URL` is set.
- Retention cleanup runs automatically for stale presence/location, old messages, pending friend requests, and ended routes.

## 3. API Usage

### Authentication

#### Register

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"newuser","password":"mypassword","petType":"city","petName":"Rex"}'
```

#### Login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=john&password=changeme"
```

#### Get My Profile

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/auth/me
```

### Users

All endpoints below require `Authorization: Bearer <YOUR_TOKEN>`.

#### List Users For Chat

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  "http://localhost:3001/users?search=ma&limit=20"
```

#### Get Public User Profile

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/users/2
```

This endpoint now returns only public profile data.

#### Get Privacy Settings

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/users/privacy
```

Example response:

```json
{
  "shareLocationWithFriends": false,
  "shareLocationPublicly": false,
  "allowExternalAiProcessing": false
}
```

#### Update Privacy Settings

```bash
curl -X PATCH http://localhost:3001/users/privacy \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"shareLocationWithFriends":true,"allowExternalAiProcessing":true}'
```

#### Export My Data

```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/users/me/export
```

#### Delete My Account

```bash
curl -X DELETE \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/users/me
```

### Questions

This endpoint requires authentication and `allowExternalAiProcessing=true`.

```bash
curl -X POST http://localhost:3001/questions \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"question":"How do I train my dog?"}'
```

Example response:

```json
{
  "content": "{\"steps\":[\"...\"]}",
  "usedAi": true,
  "provider": "openai",
  "model": "gpt-5-mini"
}
```

### Routes

Location-bearing route endpoints now use `POST` JSON bodies.

#### Create Path

```bash
curl -X POST http://localhost:3001/routes/create-path \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"point":{"lat":50.087,"lng":14.421},"distance":"1200","pokemonId":1}'
```

#### Check Path Progress

```bash
curl -X POST http://localhost:3001/routes/1/is-on-point \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"point":{"lat":50.0871,"lng":14.4214},"pointId":12}'
```

#### Start and Stop a Path

```bash
curl -X POST -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/routes/1/start-path

curl -X POST -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3001/routes/1/stop-path
```
