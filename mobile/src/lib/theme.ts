// Shared dark theme tokens — introduced in the Phase 3B1 Diary + nav polish pass.
//
// Direction: dark, mature, minimal — built around a desaturated deep/slate purple.
// Use ONE theme. Purple (`accent`) is the hero colour; teal (`support`) is for
// small accents only; warning/success/danger are reserved for status feedback.
//
// Only the Diary screen and the bottom navigation consume this in 3B1. Other
// screens (Log Meal, Templates, Profile) will adopt it in a later pass.

export const colors = {
  // Surfaces
  bg: '#141824',          // app background
  card: '#1C2233',        // primary card
  elevated: '#232A3D',    // elevated card / chips

  // Accents
  accent: '#8B80F9',      // primary accent (hero)
  accentSoft: '#A89FFF',  // soft accent (secondary numbers)
  support: '#63D2C6',     // support accent — SMALL use only

  // Text
  textPrimary: '#F3F4F8',
  textMuted: '#A9AEC3',

  // Lines
  border: 'rgba(255,255,255,0.08)',

  // Form inputs
  inputBg: '#1C2233',         // filled input / chip surface
  inputBorder: 'rgba(255,255,255,0.12)',
  placeholder: '#6E7488',     // dimmer than textMuted, clearly a placeholder

  // Status
  warning: '#F4B860',
  success: '#58C27D',
  danger: '#E06A6A',

  // Translucent status fills (sit cleanly on the dark background)
  successFill: 'rgba(88,194,125,0.14)',
  warningFill: 'rgba(244,184,96,0.14)',
  dangerFill: 'rgba(224,106,106,0.12)',
  accentFill: 'rgba(139,128,249,0.14)',

  // Overlay
  backdrop: 'rgba(8,10,18,0.6)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};
