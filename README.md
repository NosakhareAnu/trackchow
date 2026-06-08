# TrackChow

TrackChow is a mobile food tracking system with local meal support designed to improve daily nutritional awareness among students and young adults.

The application focuses on reducing the difficulty of food tracking by supporting commonly consumed Nigerian meals, practical portion units, simplified meal logging, and easy-to-understand nutrition summaries.

This project was developed as a Final Year Project in Computer Science.

---

# Problem Statement

Many existing food tracking applications are designed primarily around Western food databases and dietary habits. As a result:

* Common Nigerian meals are often missing or poorly represented.
* Portion sizes are frequently based on grams and ounces rather than practical local serving units.
* Logging meals can be time-consuming and frustrating.
* Nutrition information is often presented as raw numbers without meaningful interpretation.

TrackChow aims to address these challenges by providing a locally relevant, user-friendly food tracking experience.

---

# Main Objectives

* Support commonly consumed Nigerian meals.
* Reduce interaction cost during meal logging.
* Allow users to log meals using familiar serving units.
* Provide daily and weekly nutrition summaries.
* Improve nutritional awareness through simple and understandable feedback.

---

# Core Features

## Authentication

* User registration
* User login
* Secure account management

## Food Database

* Local Nigerian meals
* Snacks
* Drinks
* Nutritional information for each food item

## Meal Logging

* Search and select foods
* Portion selection
* Meal recording
* Recently logged meals

## Nutrition Tracking

* Daily calorie totals
* Daily carbohydrate totals
* Daily protein totals
* Daily fat totals
* Weekly nutrition summaries

## Meal Templates

Users can create reusable meal templates for meals they consume frequently.

Example:

Breakfast Template:

* Bread
* Egg
* Tea

Templates allow faster meal logging and reduce repetitive input.

## Offline Support

Basic offline functionality includes:

* Cached food items
* Cached recent meals
* Offline meal logging
* Synchronization when internet access returns

---

# AI Nutrition Assistant (Optional Enhancement)

TrackChow may include an AI-powered nutrition assistant as an enhancement feature.

Potential capabilities include:

* Estimating nutritional values for foods not currently stored in the database.
* Generating daily nutrition insights.
* Generating weekly nutrition insights.
* Identifying dietary imbalances such as excessive carbohydrate intake or low protein intake.
* Providing simple dietary recommendations based on logged meals.

Example:

"Your meals today are high in carbohydrates and low in protein. Consider adding eggs, fish, beans, or chicken to improve protein intake."

The AI assistant is intended as a support feature and does not replace professional nutritional advice.

---

# Technology Stack

## Mobile Application

* React Native
* Expo
* React Navigation
* Axios
* AsyncStorage

## Backend

* Node.js
* Express.js

## Database

* Supabase PostgreSQL

## Development Tools

* Visual Studio Code
* Git
* GitHub
* Thunder Client
* Figma

---

# Project Structure

```text
trackchow/
├── CLAUDE.md
├── AGENTS.md
├── README.md
├── mobile/
└── backend/
```

## Mobile

The mobile folder contains the React Native Expo application.

Responsibilities:

* User interface
* Navigation
* Authentication screens
* Food search
* Meal logging
* Nutrition summaries
* Offline caching

## Backend

The backend folder contains the Express API.

Responsibilities:

* Authentication
* Food management
* Meal logging
* Nutrition calculations
* Template management
* Synchronization

---

# Planned Database Structure

Main entities include:

* profiles
* food_items
* meal_logs
* meal_log_items
* meal_templates
* meal_template_items

The database is designed using a relational PostgreSQL structure hosted on Supabase.

---

# Development Principles

* Keep the application simple and user-friendly.
* Prioritize usability and speed.
* Focus on local relevance.
* Avoid unnecessary complexity.
* Build features incrementally.
* Maintain clean folder structures and naming conventions.

---

# Current Status

TrackChow is currently under active development.

The initial MVP focuses on:

* Authentication
* Food database
* Meal logging
* Nutrition summaries
* Templates
* Offline support

Additional enhancements such as AI nutrition insights may be added after the core functionality is completed.
