# TrackChow — Project Handover Status
Last updated: 2026-06-09

---

## Overall State

Backend and mobile are both functional but not polished. All core MVP features work end-to-end. UI is still placeholder — layout, colours, and typography will be redesigned in a later pass. No test suite exists yet.

---

## Git Issue — IMPORTANT

`backend/.env` was accidentally committed and contains real Supabase and JWT secrets. Push to GitHub is currently blocked because of this. The file has been removed from working tree but the secret is still in git history.

**To fix before pushing:**
```bash
# Option 1 — rewrite history (recommended for final year project repo)
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch backend/.env" \
  --prune-empty --tag-name-filter cat -- --all

# Option 2 — use BFG Repo Cleaner (faster)
# https://rtyley.github.io/bfg-repo-cleaner/

# After rewriting history, force push
git push origin main --force

# Rotate the Supabase service role key and JWT secret immediately after
```

---

## Database Tables (Supabase PostgreSQL)

| Table | Key Columns |
|---|---|
| `profiles` | `id` (uuid), `full_name`, `email`, `password_hash`, `created_at` |
| `food_items` | `id`, `name`, `serving_unit`, `calories`, `carbs_g`, `protein_g`, `fat_g`, `fiber_g` |
| `meal_logs` | `id`, `user_id`, `meal_type`, `notes`, `source`, `client_temp_id`, `created_at` |
| `meal_log_items` | `id`, `meal_log_id`, `food_item_id`, `quantity`, `quantity_unit`, `calories`, `carbs_g`, `protein_g`, `fat_g`, `fiber_g` |
| `meal_templates` | `id`, `user_id`, `name`, `meal_type`, `created_at` |
| `meal_template_items` | `id`, `template_id`, `food_item_id`, `quantity`, `quantity_unit` |

**Notes:**
- Nutrition values are stored on `meal_log_items`, NOT on `meal_logs`.
- `meal_logs.source` stores `"offline_sync"` or `"template"` where applicable.
- `meal_logs.client_temp_id` is used for offline deduplication during sync.
- `meal_log_items` rows are deleted explicitly before cascade (cascade not verified on DB).

---

## Backend — Completed Features

### Server
- Express + CORS + JSON middleware
- dotenv for environment variables
- nodemon for development
- `GET /health` route

### Auth (`backend/routes/auth-routes.js`)
- `POST /auth/register` — validates fields, checks duplicate email, hashes password with bcrypt (10 rounds), stores in `profiles`
- `POST /auth/login` — compares password hash, returns JWT (7-day expiry), never returns `password_hash`

### Auth Middleware (`backend/middleware/auth-middleware.js`)
- Verifies Bearer token from `Authorization` header
- Attaches `req.user = { id, email }` for downstream routes

### Foods (`backend/routes/food-routes.js`)
- `GET /foods` — returns all food_items ordered by name
- `GET /foods?search=query` — case-insensitive `ilike` search on name

### Meal Logs (`backend/routes/meal-log-routes.js`)
- `POST /meal-logs` — protected; creates `meal_logs` row + `meal_log_items` rows with nutrition calculated from `food_items × quantity`
- `GET /meal-logs/today` — protected; returns today's logs with nested items and food names
- `DELETE /meal-logs/:id` — protected; verifies ownership, deletes items then log
- `PUT /meal-logs/:id` — protected; verifies ownership, updates `meal_type`/`notes`, deletes and recreates `meal_log_items` with fresh nutrition

### Summaries (`backend/routes/summary-routes.js`)
- `GET /summary/daily` — protected; sums nutrition from `meal_log_items` for today via `meal_logs` join
- `GET /summary/weekly` — protected; returns per-day totals for last 7 days, zero-fills days with no logs

### Templates (`backend/routes/template-routes.js`)
- `POST /templates` — protected; creates `meal_templates` + `meal_template_items`
- `GET /templates` — protected; returns user's templates with items and food names
- `POST /templates/:id/log` — protected; verifies ownership, creates a real `meal_logs` entry from template using live food nutrition

### Offline Sync (`backend/routes/sync-routes.js`)
- `POST /sync/meal-logs` — protected; accepts array of offline logs; skips duplicates by `client_temp_id`; creates `meal_logs` + `meal_log_items`; returns `{ created: [...], skipped: [...] }`

### Config
- `backend/config/supabase.js` — initialises Supabase client; throws on missing env vars; never logs key values
- `backend/index.js` — mounts all routes; `start` and `dev` (nodemon) scripts

---

## Backend — Not Implemented

- AI nutrition estimation
- Custom food creation by user
- Image-based food estimation
- Calorie goals / targets
- User profile update endpoint

---

## Mobile — Completed Features

### Navigation (`src/app/`)
- `_layout.tsx` — root Stack; checks AsyncStorage token on mount; redirects to `/(auth)/login` or `/(tabs)/dashboard`
- `(auth)/_layout.tsx` — headerless Stack for auth screens
- `(tabs)/_layout.tsx` — Tabs with Dashboard, Log Meal, Templates

### Auth Screens
- `(auth)/login.tsx` — email + password form; calls `POST /auth/login`; saves token + user; redirects to dashboard
- `(auth)/register.tsx` — full_name + email + password form; calls `POST /auth/register` then auto-logs in; redirects to dashboard

### Dashboard (`(tabs)/dashboard.tsx`)
- Fetches `GET /summary/daily`, `GET /summary/weekly`, `GET /meal-logs/today` in parallel on every tab focus
- Displays daily macro boxes (calories, carbs, protein, fat)
- Lists today's meal logs with nested food items
- **Edit online log** — inline form; meal type chips; notes input; re-sends existing items to `PUT /meal-logs/:id`
- **Delete online log** — calls `DELETE /meal-logs/:id` with spinner
- Lists offline pending meals with amber left-border
- **Edit offline log** — updates `meal_type` and `notes` in AsyncStorage
- **Delete offline log** — removes from AsyncStorage
- Sync button (shown when `pendingCount > 0`) — calls `POST /sync/meal-logs`, removes synced IDs from AsyncStorage
- Pull-to-refresh
- Logout — clears token + user, redirects to login

### Log Meal (`(tabs)/log-meal.tsx`)
- Fetches all foods on mount; debounced search (`GET /foods?search=query`, 400 ms delay)
- Three-state UI: food search → meal options → success
- Food list with name, serving unit, calories
- Meal type selection (breakfast, lunch, dinner, snack)
- Quantity input (numeric)
- Quantity unit chips: `plate, scoop, serving spoon, takeaway pack, wrap, piece, bottle, cup, bowl, portion`
- Submits `POST /meal-logs`
- **Offline fallback** — if `!err.response` (network unreachable), saves to AsyncStorage via `savePendingLog`; shows "Saved Offline" success state

### Templates (`(tabs)/templates.tsx`)
- Three-state UI: list → create → food picker
- Create: template name, meal type, one food item (from food picker), quantity, quantity unit
- Submits `POST /templates`
- List shows all user templates with items
- "Log This Meal" button → `POST /templates/:id/log` — inline spinner + success confirmation per card
- `useFocusEffect` reload on tab focus

### Lib
- `src/lib/api.ts` — axios instance; `BASE_URL = 'http://localhost:5000'`; request interceptor attaches Bearer token automatically
- `src/lib/auth-storage.ts` — `saveToken`, `getToken`, `saveUser`, `getUser`, `clearAuth` (uses `removeItem` × 2, not `multiRemove` — v3 fix)
- `src/lib/offline-sync.ts` — `savePendingLog`, `getPendingLogs`, `getPendingCount`, `removeSyncedLogs`, `deletePendingLog`, `updatePendingLog`

---

## Mobile — Starter Files Not Yet Deleted

These files are from the Expo starter and are unused but not yet removed:
- `src/app/index.tsx`
- `src/app/explore.tsx`
- `src/components/app-tabs.tsx` and `app-tabs.web.tsx`
- `src/components/animated-icon.tsx` and related

Safe to delete once the new screens are confirmed stable.

---

## Known Bugs

1. **Edit meal UI is incomplete** — editing an online meal log only allows changing `meal_type` and `notes`. The food items, quantity, and quantity_unit cannot be changed in the UI (though the backend `PUT /meal-logs/:id` fully supports it). This is the next immediate task.

2. **Offline log display lacks food names** — pending meal cards show item count and date/time but not food names, because `PendingMealLog` only stores `food_item_id`, not the resolved name. Food names would need to be cached at log time.

3. **`BASE_URL` is hardcoded to `localhost:5000`** — breaks on physical devices (use machine IP) and Android emulator (use `10.0.2.2:5000`). Needs an environment config or documented one-line change before testing on hardware.

4. **Skipped offline logs are not removed** — after sync, `removeSyncedLogs` only removes `created` IDs. Logs in `skipped` (server-side duplicates) remain in AsyncStorage and will be re-sent on every sync. Should also remove skipped IDs.

5. **No token expiry handling** — if the 7-day JWT expires, API calls return 401 but the app shows a generic error rather than redirecting to login.

6. **Template edit not implemented** — templates can be created and used to log meals, but cannot be edited or deleted from the UI.

---

## API Routes — Full List

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | /health | No | Server health check |
| POST | /auth/register | No | Create account |
| POST | /auth/login | No | Login, returns JWT |
| GET | /foods | Yes | List all food items |
| GET | /foods?search= | Yes | Search food items by name |
| POST | /meal-logs | Yes | Create meal log with items |
| GET | /meal-logs/today | Yes | Today's meal logs with items |
| PUT | /meal-logs/:id | Yes | Update meal_type, notes, items |
| DELETE | /meal-logs/:id | Yes | Delete meal log and items |
| GET | /summary/daily | Yes | Today's nutrition totals |
| GET | /summary/weekly | Yes | Last 7 days per-day totals |
| POST | /templates | Yes | Create meal template |
| GET | /templates | Yes | List user's templates |
| POST | /templates/:id/log | Yes | Log meal from template |
| POST | /sync/meal-logs | Yes | Sync offline pending meal logs |

---

## Next Immediate Task

**Improve the edit logged meal UI** so users can edit:
- `meal_type` (already works)
- Selected food items (currently locked — needs food search integration)
- `quantity` per item
- `quantity_unit` per item (plate, scoop, serving spoon, takeaway pack, wrap, piece, bottle, cup)
- `notes` (already works)

The backend `PUT /meal-logs/:id` already accepts a full `items` array, so no backend changes are needed. The work is entirely in `dashboard.tsx` — the inline edit form needs to expand to include an item list with editable quantity/unit fields and optionally a food picker to swap or add items.

---

## Local Portion Units (Reference)

Standard units used across Log Meal and Templates:
```
plate, scoop, serving spoon, takeaway pack, wrap, piece, bottle, cup, bowl, portion
```

---

## UI Design Note

All screens are currently functional placeholders. Colours, typography, spacing, and component design will be updated in a dedicated UI redesign pass after core functionality is stable. Do not make UI improvements before that pass unless they are part of a specific feature fix.
