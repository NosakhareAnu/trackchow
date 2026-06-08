# TrackChow Project Instructions

TrackChow is a final year project mobile food tracking system with local meal support.

The goal is to build a functional React Native mobile application that allows users to:
- register and log in
- browse/search local Nigerian food items
- log meals using practical portion units
- view daily nutrition summaries
- view weekly nutrition summaries
- see recently logged meals
- create and reuse meal templates
- use basic offline caching and sync pending meal logs when network returns

## Tech Stack

Mobile app:
- React Native with Expo
- JavaScript or TypeScript depending on current project setup
- React Navigation
- Axios for API requests
- AsyncStorage for local caching/offline support

Backend:
- Node.js
- Express.js
- Supabase PostgreSQL
- Supabase JS client
- JWT for backend-issued auth if custom auth is used
- bcryptjs for password hashing if custom auth is used

Database:
- Supabase PostgreSQL
- Prefer relational tables and snake_case column names

## Project Structure

Root structure:

trackchow/
- mobile/
- backend/

Mobile app is inside:
mobile/

Backend API is inside:
backend/

Do not mix frontend/mobile files into backend.
Do not place backend files inside the mobile folder.

## Required Backend Features

Implement REST API endpoints for:
- user registration
- user login
- fetching food items
- searching food items
- creating meal logs
- fetching today's meal logs
- fetching daily nutrition summary
- fetching weekly nutrition summary
- creating meal templates
- fetching meal templates
- logging a meal from a template
- syncing pending offline meal logs

## Required Mobile Screens

The mobile app should include:
- Login screen
- Register screen
- Dashboard screen
- Food list/search screen
- Log meal screen
- Recent meals section/screen
- Daily summary section
- Weekly summary section
- Meal templates screen
- Create template screen

## Main User Flow

1. User registers or logs in.
2. User lands on dashboard.
3. User views daily calories and macronutrients.
4. User taps Log Meal.
5. User searches/selects a Nigerian food item.
6. User selects portion quantity and unit.
7. User confirms meal.
8. Dashboard updates calories, carbs, protein, and fat.
9. User can reuse recently logged meals or templates.
10. If offline, meal logs are stored locally and synced later.

## Core Database Direction

Use a better relational structure than the draft report if needed.

Recommended tables:
- profiles
- food_items
- meal_logs
- meal_log_items
- meal_templates
- meal_template_items
- sync_queue if needed

Important:
A meal log can contain multiple food items.
For example:
Lunch may contain jollof rice, chicken, and coke.

## Naming Rules

Files and folders:
- kebab-case
- example: meal-log-routes.js, food-card.tsx

React components:
- PascalCase
- example: FoodCard, DashboardScreen

Functions and variables:
- camelCase
- example: createMealLog, fetchDailySummary

Database columns:
- snake_case
- example: created_at, user_id, food_id

## Coding Rules

- Keep code simple and beginner-friendly.
- Do not over-engineer.
- Do not add features outside the required final year project scope unless asked.
- Do not rewrite unrelated files.
- Do not change folder structure without asking.
- Prefer small incremental changes.
- Ask before large refactors.
- Keep UI clean and mobile-friendly.
- Use practical Nigerian meal examples.
- Add clear comments where helpful.

## Not Required for MVP

Do not prioritize:
- complex animations
- advanced charts
- social features
- full user profile management
- calorie goal planning
- medical advice
- payment systems

Simple daily and weekly summaries are enough.
Basic clean UI is enough first.

## Security Rules

- Do not store plain text passwords.
- Use environment variables for secrets.
- Do not commit .env files.
- Do not expose Supabase service role keys in the mobile app.
- Validate required fields on backend routes.

## Development Style

Before editing:
- inspect the project structure
- explain the planned files to change
- wait for approval if the change is large

After editing:
- summarize what changed
- mention files modified
- mention commands to run