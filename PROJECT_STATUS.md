# TrackChow — Project Handover Status

Last updated: 2026-06-10 (Phase 3B4 — edit-meal dark theme + its TS-only fix; the dark slate-purple theme now covers every screen in the app)

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

### `profiles`

| Column               | Type          | Notes                              |
| -------------------- | ------------- | ---------------------------------- |
| `id`                 | uuid PK       |                                    |
| `full_name`          | text          |                                    |
| `email`              | text unique   | displayed in app, not editable     |
| `password_hash`      | text          | bcrypt, never returned by API      |
| `age`                | integer       | nullable, added for Phase 3        |
| `weight_kg`          | numeric       | nullable, added for Phase 3        |
| `height_cm`          | numeric       | nullable, added for Phase 3        |
| `daily_calorie_goal` | integer       | nullable, show as eaten/goal on diary |
| `created_at`         | timestamptz   |                                    |
| `updated_at`         | timestamptz   |                                    |

### `food_items`

| Column                | Type        | Notes                                     |
| --------------------- | ----------- | ----------------------------------------- |
| `id`                  | uuid PK     |                                           |
| `name`                | text        |                                           |
| `category`            | text        |                                           |
| `serving_unit`        | text        | e.g. "plate", "piece" (legacy fallback)   |
| `serving_size_default`| numeric     | legacy fallback                           |
| `calories`            | numeric     | per one serving unit (legacy fallback)    |
| `carbs_g`             | numeric     | per one serving unit (legacy fallback)    |
| `protein_g`           | numeric     | per one serving unit (legacy fallback)    |
| `fat_g`               | numeric     | per one serving unit (legacy fallback)    |
| `fiber_g`             | numeric     | per one serving unit (legacy fallback)    |
| `calories_per_100g`   | numeric     | nullable; preferred for new calculations  |
| `carbs_per_100g`      | numeric     | nullable                                  |
| `protein_per_100g`    | numeric     | nullable                                  |
| `fat_per_100g`        | numeric     | nullable                                  |
| `fiber_per_100g`      | numeric     | nullable                                  |
| `is_local`            | boolean     | true for Nigerian food items              |
| `is_ai_estimated`     | boolean     | true if nutrition was AI-estimated        |
| `created_by`          | uuid        | nullable; references profiles(id)         |
| `created_at`          | timestamptz |                                           |
| `updated_at`          | timestamptz |                                           |

### `food_serving_units`

| Column          | Type        | Notes                                                        |
| --------------- | ----------- | ------------------------------------------------------------ |
| `id`            | uuid PK     |                                                              |
| `food_item_id`  | uuid        | references food_items(id)                                    |
| `unit_name`     | text        | e.g. "plate", "scoop", "piece"                              |
| `unit_type`     | text        | `conventional` (e.g. cup, piece) or `unconventional` (e.g. takeaway pack) |
| `grams`         | numeric     | how many grams this unit corresponds to for this food        |
| `is_default`    | boolean     | which unit is shown first when the food is selected          |
| `created_at`    | timestamptz |                                                              |
| `updated_at`    | timestamptz |                                                              |

### `meal_logs`

| Column          | Type        | Notes                                                  |
| --------------- | ----------- | ------------------------------------------------------ |
| `id`            | uuid PK     |                                                        |
| `user_id`       | uuid        | references profiles(id)                                |
| `meal_type`     | text        | breakfast, lunch, dinner, snack                        |
| `log_date`      | date        | the date the meal is recorded for                      |
| `log_time`      | time        |                                                        |
| `notes`         | text        | nullable                                               |
| `source`        | text        | nullable; "offline_sync" or "template" where relevant  |
| `client_temp_id`| text        | nullable; used for offline dedup during sync           |
| `created_at`    | timestamptz | used by backend date-range queries; pinned to noon UTC when log_date is provided |
| `updated_at`    | timestamptz |                                                        |

### `meal_log_items`

| Column            | Type        | Notes                                                        |
| ----------------- | ----------- | ------------------------------------------------------------ |
| `id`              | uuid PK     |                                                              |
| `meal_log_id`     | uuid        | references meal_logs(id)                                     |
| `food_item_id`    | uuid        | references food_items(id)                                    |
| `quantity`        | numeric     |                                                              |
| `quantity_unit`   | text        | plate, scoop, piece, etc.                                    |
| `serving_unit_id` | uuid        | nullable; references food_serving_units(id)                  |
| `grams_per_unit`  | numeric     | nullable; snapshot of food_serving_units.grams at log time   |
| `total_grams`     | numeric     | nullable; quantity × grams_per_unit                          |
| `calories`        | numeric     | stored at log time (from per-100g calc or legacy fallback)   |
| `carbs_g`         | numeric     |                                                              |
| `protein_g`       | numeric     |                                                              |
| `fat_g`           | numeric     |                                                              |
| `fiber_g`         | numeric     |                                                              |
| `created_at`      | timestamptz |                                                              |

### `meal_templates`

| Column      | Type        | Notes                   |
| ----------- | ----------- | ----------------------- |
| `id`        | uuid PK     |                         |
| `user_id`   | uuid        | references profiles(id) |
| `name`      | text        |                         |
| `meal_type` | text        |                         |
| `created_at`| timestamptz |                         |
| `updated_at`| timestamptz |                         |

### `meal_template_items`

| Column            | Type        | Notes                                                        |
| ----------------- | ----------- | ------------------------------------------------------------ |
| `id`              | uuid PK     |                                                              |
| `template_id`     | uuid        | references meal_templates(id)                                |
| `food_item_id`    | uuid        | references food_items(id)                                    |
| `quantity`        | numeric     |                                                              |
| `quantity_unit`   | text        |                                                              |
| `serving_unit_id` | uuid        | nullable; references food_serving_units(id)                  |
| `grams_per_unit`  | numeric     | nullable; snapshot of food_serving_units.grams at save time  |
| `total_grams`     | numeric     | nullable; quantity × grams_per_unit                          |
| `created_at`      | timestamptz |                                                              |

### Schema Notes

- Nutrition values are stored on `meal_log_items`, NOT on `meal_logs`.
- `meal_log_items` rows are deleted explicitly before cascade (cascade not verified on DB).
- `profiles.daily_calorie_goal` — when set, the diary should display eaten kcal / goal kcal.
- `profiles.age`, `weight_kg`, `height_cm`, `daily_calorie_goal` — used by the Phase 3 profile screen (`GET /profile`, `PUT /profile`); `daily_calorie_goal` is displayed on the diary.
- `profiles.email` — displayed in the app but must not be editable in the UI.
- `food_items.is_ai_estimated` — set to `true` for food items created by `POST /ai/food-search`; `false` for hand-curated items.
- `food_items.created_by` — reserved for user-created custom foods; not yet used.
- Streak fields: `tracking_streak`, `goal_streak`, `last_tracked_date`, `last_goal_hit_date`, `goal_streak_reset_at` — added for Phase 4; updated by backend after meal log create/edit/delete/sync.
- AI nutrition assistant is planned for a later phase to support food-not-found lookup and nutrition insight generation.

### Portion Architecture — Product Decision (2026-06-09)

Nutrition calculations now prefer the per-100g + gram-mapping approach over the old per-serving approach.

**Preferred formula (when per-100g values and serving unit grams are available):**
```
total_grams     = quantity × grams_per_unit
nutrient_total  = (total_grams / 100) × nutrient_per_100g
```

**Fallback (when per-100g values or serving unit grams are missing):**
Use the old serving-based values (`food_items.calories`, `.carbs_g`, etc.) as before. This keeps existing food data working while the DB is migrated incrementally.

**AI fallback:**
AI should only be invoked when a food is not found at all in the database, or when both per-100g values and serving unit gram mappings are missing and cannot be estimated from the legacy serving fields. AI is not used for foods that exist and have sufficient data.

**`grams_per_unit` and `total_grams` on log/template items:**
These are snapshotted at creation time from `food_serving_units.grams` so the record remains accurate even if the serving definition is later changed.

**`food_serving_units.unit_type`:**
- `conventional` — units with widely understood weights (e.g. cup ≈ 240 ml, piece depends on food)
- `unconventional` — Nigerian-specific container units (e.g. foam takeaway, takeaway pack) where weight varies by vendor; gram value is an approximation

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
- `GET /foods/:id/serving-units` — returns all serving units for a food item; ordered: default first, then conventional, then unconventional, then alphabetical

### Meal Logs (`backend/routes/meal-log-routes.js`)

- `POST /meal-logs` — protected; creates `meal_logs` row + `meal_log_items` rows; nutrition calculated via `calculateNutrition` (per-100g preferred, legacy fallback); accepts optional `serving_unit_id` per item; saves `serving_unit_id`, `grams_per_unit`, `total_grams` on each item row
- `GET /meal-logs/today` — protected; returns today's logs with nested items and food names
- `DELETE /meal-logs/:id` — protected; verifies ownership, deletes items then log
- `PUT /meal-logs/:id` — protected; verifies ownership, updates `meal_type`/`notes`, deletes and recreates `meal_log_items` with fresh nutrition; same `calculateNutrition` logic as POST

### Summaries (`backend/routes/summary-routes.js`)

- `GET /summary/daily` — protected; sums nutrition from `meal_log_items` for today via `meal_logs` join
- `GET /summary/weekly` — protected; returns per-day totals for last 7 days, zero-fills days with no logs

### Templates (`backend/routes/template-routes.js`)

- `POST /templates` — protected; creates `meal_templates` + `meal_template_items`; accepts optional `serving_unit_id` per item; snapshots `grams_per_unit` and `total_grams` at create time
- `GET /templates` — protected; returns user's templates with items and food names
- `POST /templates/:id/log` — protected; verifies ownership, creates a real `meal_logs` entry; recalculates nutrition using current per-100g food data + snapshotted `grams_per_unit` from template items; falls back to legacy if per-100g data is absent

### Offline Sync (`backend/routes/sync-routes.js`)

- `POST /sync/meal-logs` — protected; accepts array of offline logs; skips duplicates by `client_temp_id`; creates `meal_logs` + `meal_log_items`; uses same `calculateNutrition` logic as meal-log routes; accepts optional `serving_unit_id` per item; returns `{ created: [...], skipped: [...] }`

### Profile (`backend/routes/profile-routes.js`)

- `GET /profile` — protected; returns current user's profile; streak values (`tracking_streak`, `goal_streak`) are **always computed fresh from `meal_logs` data** — stored streak columns are not read; this ensures correct values regardless of whether incremental streak updates succeeded
- `PUT /profile` — protected; updates any of: `full_name`, `age`, `weight_kg`, `height_cm`, `daily_calorie_goal`; email is returned but cannot be changed; validates types and ranges; streak fields are not written to the DB (not needed — GET computes them from source data); returns fresh computed streak values in response
- Internal `computeStreaks(userId, dailyCalorieGoal)` — queries all `meal_logs` with `meal_log_items(calories)`, builds a per-date calorie map, then walks backward from today counting consecutive days for tracking streak and goal streak respectively

### Streak (`backend/lib/streak-helpers.js`)

- `updateTrackingStreak(supabase, userId, logDate)` — increments tracking streak if `logDate` is a new consecutive day; resets to 1 on a gap
- `updateGoalStreak(supabase, userId, logDate)` — recalculates whether the daily calorie goal is met for `logDate`; increments on consecutive goal days; decrements if a day was previously counted but now falls below goal (e.g. after delete)
- Both are called in `meal-log-routes.js` (POST), `sync-routes.js` (per-log create); `updateGoalStreak` is also called in PUT and DELETE routes
- **Note**: these incremental updates are best-effort; if streak columns don't exist in the DB they fail silently. Streak display does not depend on them — `GET /profile` computes correct values from meal data

### Nutrition Calculator (`backend/utils/nutrition-calculator.js`)

- `calculateNutrition(food, quantity, gramsPerUnit)` — shared helper used by meal-log, template, and sync routes
- Preferred path: if `food.calories_per_100g > 0` AND `gramsPerUnit > 0`: `total_grams = quantity × gramsPerUnit`, `nutrient = (total_grams / 100) × nutrient_per_100g`; returns `grams_per_unit`, `total_grams`, and all macros
- Fallback path: if per-100g values or gramsPerUnit are absent: `nutrient = food.nutrient × quantity`; `grams_per_unit` and `total_grams` are returned as `null`

### AI Food Search (`backend/routes/ai-routes.js`)

- `POST /ai/food-search` — protected; estimates per-100g nutrition for a food not found in the database
- **Input validation**: `query` required; trimmed; 2–80 characters; must contain at least one letter (rejects symbol/number-only strings)
- **Rate limit**: counts today's `success` rows in `ai_food_requests` for the user; returns `{ success: false, limitReached: true }` if `≥ AI_DAILY_LIMIT` (env var, default 5); failed requests do not count against the limit
- **Pre-check**: runs `ilike` search on `food_items` before calling AI; if a match is found, returns it immediately without consuming quota
- **AI call**: `estimateFoodNutrition(query)` in `backend/utils/ai-food-estimator.js`; model: `claude-haiku-4-5-20251001`; `max_tokens: 500`; strict JSON prompt; returns `null` when AI responds with `confident: false`
- **Saved to DB on success**: inserts `food_items` row (`is_ai_estimated: true`, `created_by: req.user.id`, all per-100g fields, plus legacy per-serving values derived from the default serving unit's grams); inserts `food_serving_units` rows (1–3 units as returned by AI); inserts `ai_food_requests` row (`status: 'success'`, `result_food_item_id`)
- **On failure**: inserts `ai_food_requests` row (`status: 'failed'`, `error_message`); returns `{ success: false, message }` (user-friendly); never leaks internal error detail to client
- **Response shape**: `{ success, source: 'database'|'ai', food, serving_units }` on success; `{ success: false, message, limitReached? }` on failure/limit

### AI Food Estimator (`backend/utils/ai-food-estimator.js`)

- `estimateFoodNutrition(query)` — calls Anthropic Messages API with a tight single-line JSON prompt; model `claude-haiku-4-5-20251001`; `max_tokens: 500`; lazily initialises `Anthropic` client; strips accidental markdown fences before `JSON.parse`; returns parsed object when `confident: true`, `null` when `confident: false`, throws on API/network error

### Config

- `backend/config/supabase.js` — initialises Supabase client; throws on missing env vars; never logs key values
- `backend/index.js` — mounts all routes; `start` and `dev` (nodemon) scripts

---

## Backend — Not Implemented

- Custom food creation by user (manual entry, not AI)
- Image-based food estimation
- User profile delete

---

## Mobile — Completed Features

### Navigation (`src/app/`)

- `_layout.tsx` — root Stack; checks AsyncStorage token on mount; redirects to `/(auth)/login` or `/(tabs)/dashboard`
- `(auth)/_layout.tsx` — headerless Stack for auth screens
- `(tabs)/_layout.tsx` — **themed dark tab bar** (Phase 3B1): three visible tabs — Diary, center + button, Profile. Active tint `#8B80F9`, inactive muted, dark surface `#1C2233` with subtle top border; tab bar height accounts for safe-area bottom inset. Log Meal and Templates are `href: null` (hidden, still navigable). The center + button no longer navigates — it opens the **Add popup** (`AddMenuSheet`) over the current screen. **3B2**: tab bar icons via `lucide-react-native` — `CalendarDays` (Diary), `User` (Profile), `Plus` inside the center button.

### Auth Screens

- **UI: dark slate-purple theme (Phase 3B3)** — both screens use `src/lib/theme.ts`: dark background, a centered auth card, a small brand mark (`Utensils` in an accent tile), mature title + subtitle, rounded inputs with leading icons, themed primary button (with icon), a themed error card, and an accent register/login switch link. `KeyboardAvoidingView` + `ScrollView` (`keyboardShouldPersistTaps="handled"`, centered `flexGrow` content) keep inputs visible above the Android keyboard. `<StatusBar style="light" />` on both. `(auth)/_layout.tsx` sets a dark `contentStyle` to avoid a white flash on login↔register. **No auth logic, validation, loading, or error handling changed.**
- `(auth)/login.tsx` — email + password form (`Mail`/`Lock` icons, `LogIn` button); title "TrackChow", subtitle "Track your meals, calories, and local foods."; calls `POST /auth/login`; saves token + user; redirects to dashboard
- `(auth)/register.tsx` — full_name + email + password form (`User`/`Mail`/`Lock` icons, `UserPlus` button); title "Create Account", subtitle "Start tracking your meals with local food support."; calls `POST /auth/register` then auto-logs in; redirects to dashboard

### Dashboard / Diary (`(tabs)/dashboard.tsx`)

- **UI: dark slate-purple theme (Phase 3B1)** — consumes `src/lib/theme.ts` tokens (bg `#141824`, cards `#1C2233`/`#232A3D`, accent `#8B80F9`, soft accent `#A89FFF`, support teal `#63D2C6` small use, success/warning/danger for status). Sets light status-bar icons on focus, restores dark on blur (so the still-light Profile screen stays readable).
- Fetches `GET /summary/daily`, `GET /summary/weekly`, `GET /meal-logs?date=` + `GET /profile` in parallel on every tab focus
- **Swipeable nutrition summary** (`NutritionSummary`) — **2 panels** (3B2; was 4) in a horizontal, full-bleed paged `ScrollView` with 2 page dots. Panel 1 = **Calories** (`Gauge` icon): big eaten number, and when a goal is set a thin progress bar + "X of GOAL kcal" / "N left" (or "N over" in amber when exceeded); when no goal it shows "Set a daily calorie goal in Profile". Panel 2 = **Macros** (`Activity` icon): Protein / Carbs / Fat in three columns showing **grams eaten only** (no "/ goal" — the app stores no macro goals). Active page tracked via `onMomentumScrollEnd`.
- **Compact streak chips** — two slim chips ("Tracking streak", "Goal streak") in a single row below the date header; each with a small `Flame` icon, teal value, muted label. Replaces the old bulky two-column streak card.
- **Polished date header** — circular ‹ › arrows on an elevated surface; centered date label; tapping the label returns to Today (subtle, only shown/active when not already on today).
- **Logout moved out** (3B2) — the Log Out button was removed from the Diary; it now lives in an "Account" section at the bottom of Profile.
- **Nutrition Insight card** — shown directly below the Nutrition summary; rule-based, no AI; uses `generateInsights(daily, calorieGoal, hasLogs)` pure function:
  - No meals logged → "Log a meal to see nutrition insights."
  - Calories > goal → ⚠ "You have passed your calorie goal..." (with numbers)
  - Calories < 50% of goal → 💡 "You are far below your calorie goal..." (with numbers)
  - Carbs > 20g AND protein < carbs/3 → 💡 "Your meals are carb-heavy today..."
  - Fat × 9 > 40% of total calories → ⚠ "Fat intake is relatively high today..."
  - None of the above → ✓ "Your nutrition looks balanced for the meals logged today."
  - Multiple insights can appear at once
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

- **UI: dark slate-purple theme (Phase 3B2)** — themed search box (with a `Search` icon), food results as cards, accent-tinted selected-food and AI cards, pill chips for serving units, themed inputs/buttons, themed `NutritionPreview`. Sets light status-bar icons on focus, dark on blur. No flow/logic changes — search, AI fallback, portion selector, offline save, and the Diary flash-redirect all behave exactly as before.
- Three-state UI: food search → meal options → success
- **Phase A food search**: does NOT load all foods on mount; shows up to 5 recent foods from AsyncStorage when query is empty or < 2 chars; fires `GET /foods?search=query` only when query ≥ 2 characters; 400 ms debounce; "Type at least 2 characters to search" hint shown for 1-char input
- **No-results flow**: "No food found" + purple "Search with AI" button → AI confirmation card ("AI food search will estimate nutrition for…" + Cancel/Continue) → "AI search not connected yet." placeholder; AI step resets whenever query changes
- **Recent foods** — saved to AsyncStorage after every successful online or offline log; up to 5 unique entries, newest first; stored in `@trackchow_recent_foods` key (see `src/lib/recent-foods.ts`)
- Food list with name, serving unit, calories; Meal type selection; Quantity input
- **Dynamic serving unit chips** — when a food is selected, `GET /foods/:id/serving-units` is fetched; units shown as chips grouped into "Conventional" and "Unconventional" sections; default unit (`is_default = true`) is auto-selected; if no default, first unit is used; chips update `selectedServingUnit` state which carries `id` and `grams`
- **Fallback unit chips** — if serving units fetch fails or returns empty, falls back to static `QUANTITY_UNITS` chips from `src/lib/portion-units.ts`
- **Live nutrition preview** — `NutritionPreview` receives `gramsPerUnit` from selected serving unit; uses per-100g calculation when both `calories_per_100g` and `gramsPerUnit` are available: `total_grams = qty × grams`, `nutrient = (total_grams / 100) × per_100g`; subtitle shows e.g. "2 plates = 460g"; falls back to legacy (calories × qty) when per-100g data is absent
- Submits `POST /meal-logs` with `serving_unit_id` when a serving unit is selected; `quantity_unit` is set to `unit_name` of the selected serving unit
- **Offline fallback** — if `!err.response` (network unreachable), saves to AsyncStorage via `savePendingLog`; `serving_unit_id` is preserved in the saved items payload; shows "Saved Offline" success state

### Templates (`(tabs)/templates.tsx`)

- **UI: dark slate-purple theme (Phase 3B2)** — themed list cards, create form, food-picker rows (as cards), pill chips, inputs and buttons; themed `NutritionPreview`. Light status-bar icons on focus, dark on blur. All existing behaviour (create, log-from-template, food picker, serving units) unchanged. Also fixed a pre-existing TS-only error here: `FoodItem.serving_unit` is now `string | null` (was optional), matching `log-meal.tsx` and `CachedFood`.
- Three-state UI: list → create → food picker
- Create: template name, meal type, one food item (from food picker), quantity, quantity unit
- **Dynamic serving unit chips** — same behaviour as Log Meal: fetches `GET /foods/:id/serving-units` when a food is selected; groups units into Conventional / Unconventional; auto-selects default; falls back to static chips
- **Live nutrition preview** — `NutritionPreview` card with `gramsPerUnit` from selected serving unit; per-100g path when data available, legacy fallback otherwise
- Submits `POST /templates` with `serving_unit_id` when a serving unit is selected; backend snapshots `grams_per_unit` and `total_grams` on the template item
- List shows all user templates with items
- "Log This Meal" button → `POST /templates/:id/log` — inline spinner + success confirmation per card
- `useFocusEffect` reload on tab focus

### Profile (`(tabs)/profile.tsx`)

- **UI: dark slate-purple theme (Phase 3B2)** — themed streak boxes (with `Flame` icons), section labels (Details / Account), themed inputs, read-only email, goal-change warning card, and Save button. Light status-bar icons on focus, dark on blur.
- **Logout lives here now (Phase 3B2)** — an "Account" section at the bottom with a `LogOut`-icon danger button; clears auth token/user and redirects to `/(auth)/login`. (Moved from the Diary.)
- Fetches `GET /profile` on every tab focus
- Shows tracking streak and goal streak as stat boxes at the top
- Displays email as read-only
- Editable fields: `full_name`, `age`, `weight_kg`, `height_cm`, `daily_calorie_goal`
- If calorie goal is being changed from an existing value, shows an **inline warning card** (not `Alert.alert` — that doesn't work on Expo Web): "Changing your calorie goal will reset your goal streak. Continue?" with Confirm/Cancel buttons; Save button is hidden while warning card is open; only proceeds to PUT on Confirm
- Submits `PUT /profile` with only non-empty fields (empty = no change)
- On successful save, updates the locally stored user's `full_name` so the Diary greeting stays current
- `pendingUpdates` state holds validated updates while waiting for goal-change confirmation; `performSave` handles the actual API call in both the direct-save and confirmed-save paths

### Lib

- `src/lib/theme.ts` — **shared dark theme tokens**: `colors`, `spacing`, `radius`. One theme — desaturated slate-purple. **3B2**: added `inputBg`, `inputBorder`, `placeholder` tokens for form fields. Consumed by **every screen** as of 3B4: Diary, bottom nav, Log Meal, Templates, Profile, the Add popup, `NutritionPreview`, the auth screens (login/register), and `edit-meal.tsx`. No light screens remain.
- `src/lib/api.ts` — axios instance; `BASE_URL = 'http://10.203.208.196:5000'` (physical Android via Expo Go — change to `localhost:5000` for Expo web, `10.0.2.2:5000` for Android emulator); request interceptor attaches Bearer token automatically
- `src/lib/auth-storage.ts` — `saveToken`, `getToken`, `saveUser`, `getUser`, `clearAuth` (uses `removeItem` × 2, not `multiRemove` — v3 fix)
- `src/lib/offline-sync.ts` — `savePendingLog`, `getPendingLogs`, `getPendingCount`, `removeSyncedLogs`, `deletePendingLog`, `updatePendingLog`
- `src/lib/portion-units.ts` — single source for `QUANTITY_UNITS` constant (12 units); imported by log-meal, edit-meal, and templates
- `src/lib/recent-foods.ts` — `saveRecentFood`, `getRecentFoods`; persists up to 5 recently logged foods in AsyncStorage; key is **user-scoped**: `@trackchow_recent_foods:${userId}`; `RecentFood` type now includes optional per-100g fields so cached foods work with the per-100g preview path; existing entries without per-100g fields still work (legacy preview fallback)
- `src/lib/offline-sync.ts` — pending logs key is **user-scoped**: `@trackchow/pending_meal_logs:${userId}`; `PendingItem` now carries optional `food_name` field (local display only, ignored by backend sync route which destructures only `food_item_id`/`quantity`/`quantity_unit`/`serving_unit_id`)

### Components

- `src/components/add-menu-sheet.tsx` — **Add popup action menu (Phase 3B1)**. Bottom-sheet style modal opened by the center + tab button. Shows exactly two options: **Log Meal** and **Templates** (each `router.push`es the hidden route, then closes). Uses core React Native `Animated` (no reanimated dependency) for a subtle fade-backdrop + slide-up; keeps the modal mounted through the closing animation via a `rendered` flag. Dark themed, safe-area aware.
- `src/components/nutrition-preview.tsx` — `NutritionPreview` component; takes `food: NutritionValues | null`, `quantity: number`, `unit: string`, optional `gramsPerUnit: number | null`; preferred path: `total_grams = qty × gramsPerUnit`, `nutrient = (total_grams / 100) × nutrient_per_100g`; subtitle shows "2 plates = 460g" when total grams are computed; falls back to legacy (food.nutrient × qty) when per-100g data or gramsPerUnit is absent; returns null when food is null or quantity ≤ 0; used in log-meal, edit-meal, and templates

---

## Mobile — Starter Files Not Yet Deleted

These files are from the Expo starter and are unused but not yet removed:

- `src/app/index.tsx`
- `src/app/explore.tsx`
- `src/components/app-tabs.tsx` and `app-tabs.web.tsx`
- `src/components/animated-icon.tsx` and related

Safe to delete once the new screens are confirmed stable.

---

## Known Bugs and Gaps

### Active bugs

1. ~~**Offline log display lacks food names**~~ — **fixed in Phase 2.5**: `PendingItem` now carries `food_name` (set at log time in `log-meal.tsx`). Dashboard pending cards show "Jollof Rice — 2 serving spoons" per item. Old pending logs without `food_name` fall back to the previous "N food items · date time" display.

2. **`BASE_URL` is set to `http://10.203.208.196:5000`** — configured for physical Android phone testing via Expo Go. Change back to `http://localhost:5000` for Expo web/browser testing on the laptop, or `http://10.0.2.2:5000` for the Android emulator.

3. **No token expiry handling** — if the 7-day JWT expires, API calls return 401 but the app shows a generic error rather than redirecting to login.

4. **TypeScript type mismatch in `log-meal.tsx` handleSubmit** — `itemPayload` is declared `Record<string, unknown>` then passed to `savePendingLog(PendingItem[])`. Runtime is correct (fields match) but TypeScript may warn. Fix: declare `itemPayload` as `PendingItem` and conditionally add `serving_unit_id`.

### Known gaps (by design for MVP)

5. **Template edit/delete not implemented** — templates can be created and used to log meals, but cannot be edited or deleted from the UI.

6. **AI food search not wired in `edit-meal.tsx`** — shows "Search with AI" in the food picker but continues to display `"AI search not connected yet."` (Phase B was only implemented in `log-meal.tsx`). Not a regression.

7. **Offline food search fallback only in `log-meal.tsx`** — the food pickers inside edit-meal and templates show "Could not load foods." when offline; they do not fall back to the local food cache. Acceptable for MVP — the main offline logging path is `log-meal.tsx`.

8. **AI-returned serving units now cached** — fixed in stabilization check: `handleSelectFood` in `log-meal.tsx` now calls `saveCachedServingUnits(food.id, preloadedUnits)` in the AI preloaded-units branch, so if the user is offline next time the full AI-specified unit set (bowl, cup, etc.) is available from cache alongside the virtual g/ml chips.

9. **Skipped offline logs are not removed** — after sync, `removeSyncedLogs` removes only `created` IDs and explicitly `"Already synced"` IDs. Logs skipped for real DB errors remain in AsyncStorage for retry, which is correct behaviour. If a log is permanently un-syncable (e.g. food deleted from DB), the user must manually delete the offline log.

10. **Diary date vs server UTC mismatch** — backend filters logs using fixed UTC windows (`T00:00:00.000Z` → `T23:59:59.999Z`). Meals pinned to noon UTC by `POST /meal-logs` fall safely within the correct day. Late-night logs (past midnight UTC) for users in UTC+ timezones may appear on the next UTC day. Not a showstopper for MVP.

### Manual tests recommended

These cannot be verified by code review alone:
- Sync end-to-end: log offline → restart backend → Sync Now → verify diary and totals update
- AI rate limit: after 5 successful AI searches, verify the 6th returns "limit reached" without calling the API
- Offline serving unit fallback: select a food online, go offline, re-select from cache → verify non-g/ml chips appear
- Template "Log This Meal": verify nutrition is recalculated using current food data (not cached values)
- Profile calorie goal warning: change goal → inline warning → confirm → verify streak resets; cancel → verify goal unchanged
- Streak display: log a meal → view Profile → tracking streak ≥ 1

---

## API Routes — Full List

| Method | Route              | Auth | Description                    |
| ------ | ------------------ | ---- | ------------------------------ |
| GET    | /health            | No   | Server health check            |
| POST   | /auth/register     | No   | Create account                 |
| POST   | /auth/login        | No   | Login, returns JWT             |
| GET    | /foods             | Yes  | List all food items            |
| GET    | /foods?search=     | Yes  | Search food items by name      |
| GET    | /foods/:id/serving-units | No | Serving units for a food item |
| POST   | /meal-logs         | Yes  | Create meal log with items     |
| GET    | /meal-logs?date=   | Yes  | Logs for a given date (default today) |
| GET    | /meal-logs/today   | Yes  | Today's meal logs (backwards compat)  |
| PUT    | /meal-logs/:id     | Yes  | Update meal_type, notes, items        |
| DELETE | /meal-logs/:id     | Yes  | Delete meal log and items             |
| GET    | /summary/daily?date= | Yes | Nutrition totals for a given date (default today) |
| GET    | /summary/weekly    | Yes  | Last 7 days per-day totals     |
| GET    | /profile           | Yes  | Get current user's profile     |
| PUT    | /profile           | Yes  | Update full_name, age, weight, height, calorie goal |
| POST   | /templates         | Yes  | Create meal template           |
| GET    | /templates         | Yes  | List user's templates          |
| POST   | /templates/:id/log | Yes  | Log meal from template         |
| POST   | /sync/meal-logs    | Yes  | Sync offline pending meal logs |
| POST   | /ai/food-search    | Yes  | AI nutrition estimate for food not in DB |

---

## Completed Since Last Handover

- **Phase 3B4 — Edit Meal dark theme + targeted TS fix**:
  - `edit-meal.tsx` brought onto the shared dark slate-purple theme, matching `log-meal.tsx`: dark background, themed header ("Edit Meal" / "Change Food"), search box with a `Search` icon, food results as cards (separators removed), pill meal-type & serving-unit chips, accent-tinted selected-food and AI cards, themed inputs + notes field, themed primary/ghost buttons, themed offline banner, and the already-themed `NutritionPreview`. `<StatusBar>` set to light icons while mounted (restored on unmount).
  - **TS-only fix**: `itemPayload` retyped from `Record<string, unknown>` to `PendingItem` (imported from `offline-sync`) — the same fix already applied to `log-meal.tsx`. Whole-project `tsc --noEmit` is now **clean (0 errors)**.
  - **No backend / schema / API changes, no behaviour changes.** All preserved: loads existing meal data, shows the selected food, search + serving-unit fetch, offline cached units, g/ml fallback, nutrition preview, change meal type / food / quantity / unit / notes, `PUT /meal-logs/:id` (online) and `updatePendingLog` (offline) save, `router.back()` after save.
  - **Files changed**: `src/app/edit-meal.tsx`.
- **Phase 3B3 — Auth screens dark theme polish**:
  - `login.tsx` and `register.tsx` rebuilt on the shared dark slate-purple theme: dark background, centered auth card, brand mark (`Utensils` in an accent tile), mature title/subtitle, rounded inputs with leading lucide icons (`Mail`/`Lock`/`User`), themed primary button with icon (`LogIn`/`UserPlus`), themed error card (danger fill), and an accent switch link.
  - Login title "TrackChow" / subtitle "Track your meals, calories, and local foods."; Register title "Create Account" / subtitle "Start tracking your meals with local food support."
  - `KeyboardAvoidingView` + `ScrollView` so the Android keyboard never hides inputs; `<StatusBar style="light" />` on both; `(auth)/_layout.tsx` sets a dark `contentStyle` to avoid a white flash on login↔register.
  - **No backend / auth-API / schema changes; no logic, validation, loading, or error-handling changes.** Login, register, and post-register auto-login all behave exactly as before.
  - Typecheck: zero new errors (all auth icons resolve). The lone pre-existing `edit-meal.tsx:257` TS-only error is untouched.
  - **Files changed**: `src/app/(auth)/login.tsx`, `src/app/(auth)/register.tsx`, `src/app/(auth)/_layout.tsx`.
- **Phase 3B2 — UI finishing pass (icons + theme extension, restraint kept)**:
  - **lucide-react-native icons added** (packages `lucide-react-native` + `react-native-svg` installed). Used sparingly, theme-coloured, no emojis: bottom nav (`CalendarDays`, `User`, `Plus`), Add popup (`Utensils`, `ClipboardList`, `ChevronRight`), Diary calorie panel (`Gauge`), Diary macros panel (`Activity`), streak chips (`Flame`, Diary + Profile), Log Meal search (`Search`), Profile logout (`LogOut`). All icon names typecheck clean.
  - **Logout moved Diary → Profile**: removed from the Diary bottom; added to a new "Account" section at the bottom of Profile (same logic — `clearAuth` + redirect to login).
  - **Nutrition summary: 4 panels → 2**: Panel 1 Calories (eaten / goal / progress / remaining-or-over, unchanged design + `Gauge` icon); Panel 2 a single combined **Macros** panel showing Protein / Carbs / Fat grams **eaten only** (three columns, no macro goals — the app stores only `daily_calorie_goal`). Page dots reduced to 2.
  - **Dark theme extended** to Log Meal, Profile, Templates, the Add popup, and `NutritionPreview` (previously Diary + nav only). Themed inputs (new `inputBg`/`inputBorder`/`placeholder` tokens), pill chips, cards, buttons; each themed tab screen toggles light status-bar icons on focus and restores dark on blur (keeps the still-light `edit-meal`/auth screens readable).
  - **Add popup polished**: leading icon tiles, `ChevronRight`, more comfortable row height/spacing; same core-`Animated` fade+slide, tap-outside-to-close.
  - **No backend / schema / API changes. No new flows.** All preserved: login/register, Diary load + date nav + swipe summary, flash banners, pending-sync banner, grouped logs, edit/delete, Log Meal online/offline, AI food search, serving units, nutrition preview, templates, profile save, logout, + popup navigation.
  - **Typecheck**: introduces zero new TS errors; also fixed one pre-existing error in `templates.tsx` (`FoodItem.serving_unit` now `string | null`). One pre-existing TS-only error remains in the untouched `edit-meal.tsx:257` (left per scope).
  - **Files changed**: `src/lib/theme.ts`, `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/dashboard.tsx`, `src/app/(tabs)/profile.tsx`, `src/app/(tabs)/log-meal.tsx`, `src/app/(tabs)/templates.tsx`, `src/components/add-menu-sheet.tsx`, `src/components/nutrition-preview.tsx`.
- **Phase 3B1 — Diary + navigation UI polish (dark theme, restraint pass)**:
  - **Shared theme** (`src/lib/theme.ts`): one dark, mature, minimal theme around a desaturated slate-purple. Scoped to the Diary screen + bottom nav for this pass only; Log Meal / Templates / Profile intentionally left on their original light styling.
  - **Diary screen restyled** (`(tabs)/dashboard.tsx`): dark background and cards, themed typography/spacing, light status-bar icons while focused (restored to dark on blur for the still-light Profile). All existing behaviour preserved — date navigation, focus refresh, flash banners, pending-sync banner + message, grouped meals, online/offline edit & delete, weekly summary, offline meals list, sync buttons, logout.
  - **New top nutrition summary**: horizontal **swipeable** panels with page dots. Front panel prioritises **calories eaten / goal / remaining** (thin progress bar; amber "over" state; graceful "set a goal" hint when none). Macro panels (protein/carbs/fat) show **grams eaten only** — no invented macro goals, since the DB stores `daily_calorie_goal` only.
  - **Compact streak**: bulky two-column streak card replaced with two slim themed chips in one row.
  - **Polished date header**: elevated circular ‹ › arrows; tap the centre label to jump back to Today (subtle, only when not already today). Header kept minimal — no busy date picker.
  - **Premium bottom nav** (`(tabs)/_layout.tsx`): themed dark surface, subtle top border, purple active tint, raised purple + button; tab bar respects the safe-area bottom inset.
  - **+ now opens a popup, not a page** (`src/components/add-menu-sheet.tsx`): tapping the center + opens a minimal bottom-sheet action menu (Log Meal, Templates) over the current screen with a short, subtle fade+slide animation (core RN `Animated`, no new dependency). The old full-page `add.tsx` is now an unused/orphaned route (left in place, harmless).
  - **No new dependencies, no backend/schema/API changes.** Icons (lucide) were intentionally NOT added — adding a native module (`react-native-svg`) couldn't be verified on the physical Android device, and the icon direction was explicitly conditional ("if easy to install"). The premium feel is achieved with colour, typography, spacing, and the raised + button instead. lucide remains an easy future add.
  - **Files changed**: `src/lib/theme.ts` (new), `src/components/add-menu-sheet.tsx` (new), `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/dashboard.tsx`. Typecheck clean for all four (two pre-existing TS-only errors remain in the untouched `edit-meal.tsx` and `templates.tsx`).
- **Phase 1**: Diary grouped by meal type; item rows show food name, quantity, unit, calories; dedicated edit-meal screen with food picker, meal type, quantity, unit, notes; delete with immediate refetch.
- **Phase 2**: Date-based diary — ‹ date label › navigation; Today/Tomorrow labels; "We can't see the future." guard; backend `GET /meal-logs?date=` and `GET /summary/daily?date=` added.
- **Phase 3**: Profile screen added (Diary, Log Meal, Templates, Profile tabs); `GET /profile` and `PUT /profile` backend routes; Diary Nutrition section shows "eaten kcal / goal kcal" when goal is set, or "Set a daily calorie goal in Profile" hint when not set; Profile name change propagates to locally stored user so Diary greeting updates.
- **Phase 4**: Streak tracking — `backend/lib/streak-helpers.js` with `updateTrackingStreak` and `updateGoalStreak`; streak updated after meal create (both streaks), edit and delete (goal streak only), and offline sync (both); Profile screen shows tracking/goal streak stats; Diary shows streak card; changing calorie goal warns user and resets goal streak on confirm.
- **Fix — Profile save UX**: After a successful PUT /profile, all form field states (`fullName`, `age`, `weightKg`, `heightCm`, `calorieGoal`) are now re-synced from the server response. Previously only `profile` state was updated, leaving form fields showing stale typed values and making the save appear to have no effect.
- **Fix — Calorie goal save bug (two-part)**:
  - *Backend*: The streak reset fields (`goal_streak`, `last_goal_hit_date`, `goal_streak_reset_at`) were being merged into the same Supabase UPDATE as `daily_calorie_goal`. If any streak column was absent from the DB, the entire UPDATE failed — including the goal save. Fixed by detecting the goal change first, doing the main profile UPDATE cleanly, then firing the streak reset as a separate fire-and-forget UPDATE that swallows errors.
  - *Mobile*: The `Alert.alert` streak-reset confirmation was wrapped in `new Promise<boolean>`. On Android, pressing the back button to dismiss the alert fires no button callback, leaving the Promise unresolved forever and the function silently hung. Fixed by adding `{ cancelable: false }` to the Alert options. Also added an explicit `setSaveError` message when the user presses Cancel so "nothing happens" is replaced by clear feedback.
- **Fix — Alert.alert on Expo Web (BUG 1)**:
  - `Alert.alert` on Expo Web renders as a browser `window.alert` which blocks execution but does not deliver the Cancel/Continue callback. The `new Promise<boolean>` wrapping it never resolves, permanently hanging `handleSave`. Removed `Alert` entirely. Replaced with `pendingUpdates` state: when the goal changes, `handleSave` stores updates in `pendingUpdates` (which renders the inline warning card) and returns. Confirm calls `performSave(pendingUpdates)`. Cancel clears state and shows a message. The Save button is hidden while the warning is open. Works identically on iOS, Android, and Web.
- **Fix — tracking_streak = 0 despite logging today (BUG 2)**:
  - Root cause: `updateTrackingStreak` in `streak-helpers.js` SELECT queries `tracking_streak` and `last_tracked_date` from `profiles`. If either column does not exist in the actual Supabase DB (Phase 4 migration not applied, or partial), Supabase returns an error, `profile` is null, the function returns early without updating, and `tracking_streak` stays 0 forever — while `updateGoalStreak` (using different existing columns) works fine.
  - Fix: `GET /profile` and `PUT /profile` now call `computeStreaks(userId, dailyCalorieGoal)` which queries ALL `meal_logs` with their `meal_log_items(calories)`, builds a per-date calorie total map, then counts consecutive days backward from today for tracking streak and goal streak. Stored streak columns are never read. The response always reflects the actual meal data. No database schema change required.
- **Date nav bug fix**: `addDays` and `todayStr` rewrote to use local date components only — `toISOString()` was converting local midnight to UTC and shifting dates one day back in UTC+ timezones, causing the ‹ button to jump two days.
- **Portion UX + live nutrition preview**: Added `NutritionPreview` component (green card, 5-macro breakdown, scaled by quantity); added `portion-units.ts` shared constant (12 units: plate, scoop, serving spoon, takeaway pack, foam takeaway, bowl, wrap, piece, bottle, cup, slice, pack); all three meal entry screens (log-meal, edit-meal, templates) now use the shared units and show the live preview card; edit-meal now loads foods on mount so preview is visible immediately for the existing food item.
- **Algorithmic nutrition insight card**: Added `generateInsights` pure function and `NutritionInsightCard` component directly in `dashboard.tsx`; no AI, no external calls; shows calorie-goal warnings, carb-heavy and high-fat notices, or a balanced-day confirmation; updates live as the selected diary date changes.
- **Mobile serving-unit integration**: Log Meal, Edit Meal, and Templates now fetch `GET /foods/:id/serving-units` on food selection; units displayed as chips grouped into Conventional / Unconventional; default unit auto-selected; `serving_unit_id` sent on submit; `NutritionPreview` updated to use per-100g × grams calculation when both are available, with total grams shown in subtitle; `RecentFood` type extended with optional per-100g fields; fallback to static QUANTITY_UNITS chips when serving units are unavailable.
- **Backend portion architecture**: Added `backend/utils/nutrition-calculator.js` with `calculateNutrition(food, quantity, gramsPerUnit)` — prefers per-100g × gram-mapping calculation, falls back to legacy serving-based when either input is absent. Updated `POST /meal-logs`, `PUT /meal-logs/:id`, `POST /templates`, `POST /templates/:id/log`, and `POST /sync/meal-logs` to accept optional `serving_unit_id` per item, fetch grams from `food_serving_units`, and save `serving_unit_id`, `grams_per_unit`, `total_grams` on log/template items. For template logs, current per-100g food data is re-fetched but the snapshotted `grams_per_unit` from the template item is reused. Added `GET /foods/:id/serving-units` route.
- **Phase A — Food search improvements**: Log Meal and Edit Meal no longer load all foods on mount; search requires ≥ 2 characters (with a hint shown for 1-char input); 400 ms debounce unchanged; when search is empty, up to 5 recently logged foods are shown from AsyncStorage (`src/lib/recent-foods.ts`); when search returns no results, a purple "Search with AI" button appears; pressing it shows an inline confirmation card; Continue shows "AI search not connected yet." (real Claude API integration deferred to Phase B); AI step resets on every query change.
- **Sync banner bug fixes**: Three bugs caused the top "Sync Now" button to appear broken: (1) `catch {}` with no variable swallowed errors silently — fixed by adding `console.error('[Sync] handleSync failed:', err)`; (2) `syncMessage` was rendered at the bottom of the page (inside "Offline Meals") so result feedback was invisible to a user watching the banner — message rendering moved to just after the banner block so it is always visible; (3) the `pending.length === 0` early-return path never called `refreshPending()`, so stale React state could keep `pendingCount > 0` while storage was already empty, making sync look stuck — fixed by calling `await refreshPending()` before that `return`. The `getPendingCount()` intermediate call was also removed (replaced by the `refreshPending()` call which already updates all related state). `PendingItem` type in `offline-sync.ts` updated to declare `serving_unit_id?: string` — it was already included in the runtime payload (from the serving-unit chip flow) but not typed, making TypeScript unaware of it during sync sends.
- **Gram/ml unit chips always available**: All three meal-entry screens (log-meal, edit-meal, templates) now always include a "g" chip in the Conventional section so users can log exact weighed grams (grams: 1, quantity × 1 = total grams). A "ml" chip is also appended for drink/soup foods (detected by `food.category` containing drink/liquid/beverage/soup) or when the backend already returns liquid-type units (cup/bottle/glass). Neither chip is added if the backend already returns a unit with that name. Both are synthetic client-side units (id `__g__`, `__ml__`); the submit handler detects them via `id.startsWith('__')` and omits `serving_unit_id` so the backend receives a clean payload. The live `NutritionPreview` correctly uses `gramsPerUnit = 1` with the per-100g formula for these units.
- **Pending sync banner above diary**: Dashboard now shows an amber banner card ("X pending meal(s) saved offline — Sync now…") between the Nutrition Insight card and the Meals section whenever `pendingCount > 0`. Includes a "Sync Now" button (amber, with loading spinner) that reuses `handleSync`. The existing sync button at the bottom of the page is retained.
- **Phase B — Mobile AI food fallback wired**: Log Meal "Search with AI" flow now calls `POST /ai/food-search` on confirm. Flow: no-results → "Search with AI" button → confirm card (with warning "Results may not be exact.") → loading state ("Estimating nutrition...") → on success: food auto-selected with serving units from the AI response, transitions to meal options panel; on failure/limit: error card with "← Back to search"; AI step and error cleared on every query change and on handleReset. `handleSelectFood` accepts optional `preloadedUnits` param to skip the extra `GET /foods/:id/serving-units` call when units are already returned by the AI response.
- **Backend AI food fallback**: `POST /ai/food-search` — validates query (2–80 chars, must contain a letter), enforces daily rate limit via `ai_food_requests`, checks `food_items` first before calling AI, calls `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk` with a strict JSON prompt and `max_tokens: 500`; on confident AI response inserts `food_items` (`is_ai_estimated: true`) + `food_serving_units` + `ai_food_requests` success row; failed calls insert a failed row and return a user-friendly message; API key never sent to client.
- **UX Nav Foundation (pre-UI-redesign)**:
  - **Diary flash banner after meal log**: Log Meal no longer shows a persistent success page. After a successful online or offline log, the app immediately redirects to the Diary tab and shows a temporary flash banner ("Bread was added to lunch." / "Bread was saved offline.") that auto-hides after 4 seconds. The banner is green for online logs and amber for offline logs. Implemented via a module-level one-shot store (`mobile/src/lib/flash-message.ts`): `setFlash(msg, type, date)` is called before `router.replace('/(tabs)/dashboard')`; `consumeFlash()` is called in Diary's `useFocusEffect` and clears after read.
  - **Date preservation**: When the user logs for a non-today date, Diary automatically switches to that date on arrival so the logged meal is immediately visible.
  - **Log Meal form auto-reset**: When the user returns to Log Meal after a successful log (via the + button), the form is automatically cleared (`justLoggedRef` pattern). Previously it would retain the last-selected food.
  - **Bottom nav redesign — Diary | + | Profile**: Tab bar reduced from 4 to 3 visible tabs. Log Meal and Templates are hidden from the tab bar (`href: null`) but still fully accessible as routes. The center tab is a custom blue circle + button (52×52, raised) that navigates to the new Add screen. Files changed: `mobile/src/app/(tabs)/_layout.tsx` (rewritten), `mobile/src/app/(tabs)/add.tsx` (new).
  - **Add action hub screen** (`add.tsx`): Simple screen with two cards — "Log Meal" and "Templates" — each navigating to the existing screen via `router.push`. Accessible only from the + tab button.
  - **Files changed**: `mobile/src/lib/flash-message.ts` (new), `mobile/src/app/(tabs)/_layout.tsx`, `mobile/src/app/(tabs)/add.tsx` (new), `mobile/src/app/(tabs)/log-meal.tsx`, `mobile/src/app/(tabs)/dashboard.tsx`
- **Phase 2.5 — User-scoped local storage + pending food names**:
  - **Bug fix — account switch data leak**: Switching accounts previously showed the previous user's recent foods. Root cause: `@trackchow_recent_foods`, `@trackchow/pending_meal_logs`, `@trackchow/food_cache`, and `@trackchow/serving_units_cache` were global AsyncStorage keys shared by all accounts. Fixed by making each key user-scoped (e.g. `@trackchow_recent_foods:${userId}`). The userId is read from `auth-storage.ts` inside each lib function (`getUser()` call), so no call-site changes were needed. Logout does NOT delete cache — the next user simply reads from their own key and starts with a clean cache.
  - **Pending offline card food names**: Pending meal cards previously showed "2 food items · 2026-06-10 12:00:00". Now show "Jollof Rice — 2 serving spoons" per item. Implemented by adding `food_name?: string` to `PendingItem` in `offline-sync.ts`; `log-meal.tsx` sets it at log time (`food_name: selectedFood.name`); dashboard checks `log.items.some(item => item.food_name)` and renders names when present, falls back to item count for old logs without `food_name`. The field is ignored by the backend sync route (which destructures only `food_item_id`, `quantity`, `quantity_unit`, `serving_unit_id`).
  - **TypeScript fix**: `itemPayload` in `log-meal.tsx` `handleSubmit` is now typed as `PendingItem` (imported from `offline-sync.ts`) instead of an inline object type, matching the actual payload shape used by both the online POST and `savePendingLog`.
  - **Files changed**: `mobile/src/lib/recent-foods.ts`, `mobile/src/lib/offline-sync.ts`, `mobile/src/lib/food-cache.ts`, `mobile/src/app/(tabs)/log-meal.tsx`, `mobile/src/app/(tabs)/dashboard.tsx`
- **Offline food cache** (`mobile/src/lib/food-cache.ts`):
  - New utility with `saveCachedFood`, `saveCachedFoods`, `getCachedFoods`, `searchCachedFoods`, `saveCachedServingUnits`, `getCachedServingUnits`. Backed by two AsyncStorage keys: `@trackchow/food_cache` (max 100 foods, LRU — most recently selected food moves to front; oldest evicted when limit exceeded) and `@trackchow/serving_units_cache` (object keyed by food id). Virtual `__g__`/`__ml__` units are excluded from the serving unit cache (they are re-added client-side via `withGramUnits` on every load).
  - **When foods are cached**: `log-meal.tsx` — on `handleSelectFood` (any food tapped from search or recent); `edit-meal.tsx` — on `handleSelectFood`; `templates.tsx` — on `selectFood`. AI-returned foods are also cached (they flow through `handleSelectFood` in log-meal). `saveCachedFoods` is available for future batch use.
  - **When serving units are cached**: `log-meal.tsx`, `edit-meal.tsx`, `templates.tsx` — after every successful `GET /foods/:id/serving-units` fetch, the raw DB units are saved via `saveCachedServingUnits`. On fetch failure (offline), `getCachedServingUnits` is used; `withGramUnits` is still applied to the cached result so g/ml chips always appear.
  - **Offline food search in log-meal**: if `GET /foods` fails with a network error (`!err.response`), `searchCachedFoods(query)` is called and results are shown with a "Showing saved offline foods" amber banner as the FlatList header. If cached search finds nothing, shows "No saved offline food found. Connect to the internet to search more foods." — no AI button (AI requires internet). If the server error has a response (non-network), shows the existing error text.
  - **AI offline guard**: `handleAiSearch` catch block now detects `!err.response` and shows "AI search requires internet connection." instead of the generic error.
  - **Recent foods separate**: `@trackchow_recent_foods` (5 items, via `recent-foods.ts`) is unchanged and still shown as quick suggestions above the search box. The food cache (`@trackchow/food_cache`, 100 items) is separate and only used for offline fallback search.
  - **edit-meal and templates**: caching added silently — no new UI states needed since their food-picker already uses `searchError` for errors. Offline state shows "Could not load foods." from the existing path; the serving unit fallback works transparently.
- **Offline sync — orphan-aware dedup (clears the "Already synced" deadlock)**:
  - **Root cause**: Earlier broken syncs left **orphan `meal_logs` parent rows** (parent inserted, `meal_log_items` insert failed, no rollback existed yet). The dedup check only tested for an existing row by `client_temp_id`, so it returned `"Already synced"` for these orphans forever — the meals were never truly in the DB (no items → no nutrition) yet could never re-sync and never cleared from the mobile pending queue. Symptom: `"Could not sync 2 meals (Already synced)."`
  - **Exact fix**:
    - `backend/routes/sync-routes.js` — the dedup query now also pulls related items: `.select('id, meal_log_items(id)')`. If the existing parent **has ≥1 item** it's a genuine duplicate → skip with reason `"Already synced"`. If it has **zero items** it's an orphan → `delete` the parent, log `"[Sync] removed orphan parent and retried"`, and fall through to re-create the meal normally (with full portion fields: `serving_unit_id`, `grams_per_unit`, `total_grams`; old pending meals without `serving_unit_id` still use the legacy nutrition path). The post-insert rollback (delete parent if items insert fails) from the previous change is retained.
    - `mobile/src/app/(tabs)/dashboard.tsx` — `handleSync` now removes from AsyncStorage both server-`created` logs **and** any skipped with reason exactly `"Already synced"` (genuinely in the DB, so safe to clear). Skips with any **other** reason are treated as real failures and **stay pending** for retry. Message distinguishes created / already-synced / failed counts.
  - **How to test**: (1) Keep the current stuck pending meals. (2) Tap **Sync Now**. (3) Backend console shows `[Sync] removed orphan parent and retried` for each orphan, then `[Sync] done: created N, skipped N`. (4) The previously-stuck meals now sync (appear in the diary, totals update) and the banner clears. (5) Tap Sync again with nothing pending → "Nothing to sync." A meal that is genuinely already complete in the DB is cleared from pending with reason "already synced" rather than re-inserted.
- **Offline sync hardening + diagnosis**:
  - **What was broken**: Online meal logging and offline sync send compatible payloads (`{ meal_logs: [...] }` ↔ `const { meal_logs }`; items use `food_item_id`/`quantity`/`quantity_unit`/optional `serving_unit_id`), so it was **not** a payload-shape mismatch. The real problems: (1) when a log was skipped server-side, the **reason was never surfaced** anywhere — backend didn't log it and the mobile message only said "skipped N", so any DB/insert failure looked like "nothing happened"; (2) **orphan-parent dedup trap** — `POST /sync/meal-logs` inserts the `meal_logs` parent first, then `meal_log_items`; if the items insert failed, the parent row stayed behind, and the `client_temp_id` dedup check then marked that log "Already synced" on **every** future retry, so it could never sync even after the root cause was fixed; (3) the sync request used the global **10s axios timeout** even though it does far more DB work per log (dedup check + food lookup + serving-unit lookup + two inserts + streak recompute), risking false timeouts on multi-log syncs.
  - **Exact fix**:
    - `backend/routes/sync-routes.js` — on `meal_log_items` insert failure, the just-created `meal_logs` parent is now **deleted (rolled back)** before pushing to `skipped`, so retries work. Every skip path and the route entry/exit now `console.error`/`console.log` a safe reason (no token/PII): received count, per-skip reason, and a `created N, skipped N` summary. The outer 500 handler now logs the real error instead of silently returning "Server error".
    - `mobile/src/app/(tabs)/dashboard.tsx` — `handleSync` now: logs a safe payload shape (ids, meal_type, log_date, per-item food_item_id/quantity/unit/`has_serving_unit_id` — **never** the token); uses a **30s** per-request timeout for the sync call only; removes **only** server-created logs from AsyncStorage (failed ones are kept for retry); when `created === 0 && skipped > 0` shows `Could not sync N meals (reason)` using the first skip reason; distinguishes timeout (`ECONNABORTED`), network error (`ERR_NETWORK`), and server error (shows `err.response.data.message`); calls `refreshPending()` on both success and failure; logs remaining pending count after sync.
    - `mobile/src/lib/api.ts` — comment corrected: iOS Simulator uses `localhost`, Android Emulator needs `http://10.0.2.2:5000`, physical devices need the LAN IP. **BASE_URL left as `localhost:5000`** (valid for Expo web/browser testing).
  - **How to test**: (1) Start backend `cd backend && npm run dev` and watch its console. (2) In Expo web, log a meal while the backend is **stopped** → it saves offline and the amber banner appears. (3) Restart the backend, tap **Sync Now**. Backend console prints `[Sync] received N log(s)` … `[Sync] done: created N, skipped N`; mobile console prints `[Sync] pendingCount`, payload shape, response counts, and any `skipped reasons`. (4) On success the banner clears and "Synced N meals." shows above the Meals section; the synced meal appears in the diary and daily totals update. (5) If a log is skipped, the message now names the reason (e.g. an FK/column error) instead of failing silently — read that reason to find any remaining DB cause.
  - **How this prevents recurrence**: skip reasons are now visible on both ends, so a future insert/schema/FK failure is diagnosable immediately rather than presenting as a silent "sync does nothing"; and the parent-row rollback guarantees a failed log is never permanently wedged by the dedup check.
  - **Remaining limitation**: there is still no DB transaction around the parent+items insert — the rollback is a manual `delete` of the parent, which is best-effort (if the rollback delete itself fails, the orphan could persist). Acceptable for MVP; a Postgres function/RPC doing both inserts atomically would be the proper long-term fix.
- **Diary date consistency**: Meals are now always logged against the diary's selected date. Backend `POST /meal-logs` accepts optional `log_date` and pins `created_at` to noon UTC on that date. Diary screen has a `+ Log Meal` button that passes `selectedDate` as a param to the log-meal screen. Log-meal screen reads the param, shows "Logging for: [date]", and sends `log_date` with the request. Offline pending logs also store the correct date via updated `savePendingLog` signature. `todayDateStr` in offline-sync fixed for same UTC timezone bug.

## Next Immediate Task

**UI theming is complete.** As of 3B4 every screen uses the dark slate-purple theme (`src/lib/theme.ts`) and `tsc --noEmit` is clean across the whole project. No remaining light screens, no known TS errors.

Suggested next directions (not yet requested):
- Delete the unused Expo starter files (`src/app/index.tsx`, `explore.tsx`, `components/app-tabs*.tsx`, `components/animated-icon*`) and the now-orphaned `(tabs)/add.tsx` (the + opens the popup, not a page).
- Token-expiry handling (401 → redirect to login) — currently a generic error is shown.
- A small shared UI kit could be extracted from the now-repeated themed styles (chips, food cards, buttons, inputs) to cut duplication across log-meal / edit-meal / templates.
- Optional: add a real app icon / splash and a `git filter-branch` to purge the committed `backend/.env` before pushing (see Git Issue above).

**Orphaned route — `(tabs)/add.tsx`**: the old full-page Add hub is no longer reachable (the + opens the `AddMenuSheet` popup instead). The file is left in place (harmless) and can be deleted in the 3B2 cleanup.

**Limitation — tab bar on log-meal/templates**: When the user is on the Log Meal or Templates screen (reached via the + popup), the themed tab bar is still visible but no tab is highlighted as active (those screens have `href: null`). Acceptable for MVP. A future option is `tabBarStyle: { display: 'none' }` on those screens for a cleaner full-screen flow.

**TypeScript**: `tsc --noEmit` is clean across the whole project as of 3B4. The previously-noted `edit-meal.tsx` (`itemPayload` → `PendingItem`) and `templates.tsx` (`FoodItem.serving_unit`) type errors are both fixed.

**Known limitation — streak reversal on delete is approximate**: when a meal is deleted bringing today's calories below the goal, `goal_streak` is decremented by 1 and `last_goal_hit_date` is cleared to null. If the user had a multi-day streak, the streak count is correct but we lose the previous `last_goal_hit_date`, so the streak chain is broken for tomorrow. Acceptable for MVP.

**Profile screen: clearing fields to null** — empty fields are not sent in the update, so values can be set but not cleared back to null. Acceptable for MVP.

---

## Local Portion Units (Reference)

Standard units used across Log Meal and Templates:

```
plate, scoop, serving spoon, takeaway pack, wrap, piece, bottle, cup, bowl, portion
```

---

## UI Design Note

All screens are currently functional placeholders. Colours, typography, spacing, and component design will be updated in a dedicated UI redesign pass after core functionality is stable. Do not make UI improvements before that pass unless they are part of a specific feature fix.

After completing any feature that changes functionality,
update PROJECT_STATUS.md before ending the task.

PROJECT_STATUS.md should always contain:

- completed features
- current known bugs
- next priority tasks
- database changes
- API routes added
- important product decisions
