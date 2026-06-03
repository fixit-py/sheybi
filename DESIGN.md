---
name: Sheybi Design System
colors:
  surface: '#FFFFFF'
  surface-dim: '#dcd8e5'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f2ff'
  surface-container: '#f0ecf9'
  surface-container-high: '#eae6f4'
  surface-container-highest: '#e4e1ee'
  on-surface: '#1b1b24'
  on-surface-variant: '#464555'
  inverse-surface: '#302f39'
  inverse-on-surface: '#f3effc'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#5c5e62'
  on-secondary: '#ffffff'
  secondary-container: '#dedfe3'
  on-secondary-container: '#606366'
  tertiary: '#7e3000'
  on-tertiary: '#ffffff'
  tertiary-container: '#a44100'
  on-tertiary-container: '#ffd2be'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#e1e2e6'
  secondary-fixed-dim: '#c5c6ca'
  on-secondary-fixed: '#191c1f'
  on-secondary-fixed-variant: '#44474a'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb695'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7b2f00'
  background: '#fcf8ff'
  on-background: '#1b1b24'
  surface-variant: '#e4e1ee'
  surface-subtle: '#F2F4FA'
  border: '#D9DDE8'
  text-primary: '#111827'
  text-secondary: '#4B5563'
  text-muted: '#6B7280'
  primary-hover: '#4338CA'
  success: '#16A34A'
  success-soft: '#DCFCE7'
  danger: '#DC2626'
  danger-soft: '#FEE2E2'
  warning: '#F59E0B'
  info: '#0EA5E9'
  trending-accent: '#FF6A3D'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-xs:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  card-padding: 16px
  card-padding-lg: 20px
  section-gap: 24px
  section-gap-lg: 32px
  mobile-nav-height: 72px
  desktop-max-width: 1200px
  sidebar-width: 260px
  topbar-height: 64px
---

# Sheybi Design System

## Product Vision
Sheybi is a playful, modern prediction app for entertainment markets (BBNaija, etc.), targeting Gen Z (18+). It avoids serious banking visuals in favor of clean, soft, and fun surfaces.

## Visual Tone
- **Theme**: Light by default.
- **Surface**: Clean, soft, rounded cards.
- **Tone**: Confident, playful, adult.
- **Aesthetic**: Avoid heavy gradients and childish icons.

## Layout & Spacing
- **Spacing System**: 8px base.
- **Card Padding**: 16px - 20px.
- **Section Spacing**: 24px - 32px.
- **Mobile Bottom Nav**: 72px.
- **Desktop Max Width**: 1200px.
- **Sidebar**: 260px.
- **Topbar**: 64px.

## Typography
- **Font Family**: Inter, sans-serif.
- **Base Size**: 16px.
- **Scale**:
  - H1: 24px / 32px / 700
  - H2: 20px / 28px / 600
  - H3: 18px / 26px / 600
  - Body: 16px / 24px / 400
  - Small Body: 14px / 20px / 400
  - Caption: 12px / 16px / 400

## Color Tokens
- **Background**: #F7F8FC
- **Surface**: #FFFFFF
- **Surface Subtle**: #F2F4FA
- **Border**: #D9DDE8
- **Text Primary**: #111827
- **Text Secondary**: #4B5563
- **Text Muted**: #6B7280
- **Primary**: #4F46E5
- **Primary Hover**: #4338CA
- **Success**: #16A34A
- **Success Soft**: #DCFCE7
- **Danger**: #DC2626
- **Danger Soft**: #FEE2E2
- **Warning**: #F59E0B
- **Info**: #0EA5E9
- **Trending Accent**: #FF6A3D

## Border Radius
- **XS**: 4px
- **SM**: 8px
- **MD**: 12px
- **LG**: 16px
- **XL**: 24px
- **Full**: 999px

## Elevation
- **Shadow 1 (Cards)**: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)
- **Shadow 2 (Hover)**: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)
- **Shadow 3 (Modals)**: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)

## Components & Patterns
- **Header**: Logo, profile avatar, wallet balance (Home only).
- **Navbar**: Pill tabs (Desktop), Swipeable tabs (Mobile).
- **Market Cards**: Rounded cards showing title, category, status, odds, and action.
- **Trade Cards**: Specific to Trades page; shows amount, value, and % change.
- **Betslip**: Downloadable receipt with reference and stake details.
- **Admin Table**: Compact, status chips, filters.
