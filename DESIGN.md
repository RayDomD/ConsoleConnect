---
name: Console Connect
description: A calm, tactile studio where people and their own AI tools plan, build, and review software together.
colors:
  canvas: "#F4F2E9"
  sidebar: "#E5E9DF"
  surface: "#FCFBF5"
  text: "#253A30"
  muted: "#5B6B5E"
  border: "#CDD5C7"
  accent: "#2D624B"
  accent-hover: "#234E3C"
  on-accent: "#FCFBF5"
  selection: "#DCE6D8"
  success: "#2D624B"
  warning: "#805517"
  danger: "#A02F37"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(32px, 3vw, 48px)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
    fontFeature: "\"tnum\""
  label:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1
rounded:
  control: "8px"
  panel: "12px"
  bubble: "14px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.canvas}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px"
  task-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  chat-bubble:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.bubble}"
    padding: "12px 15px"
  chat-bubble-own:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.text}"
    rounded: "{rounded.bubble}"
    padding: "12px 15px"
  count-badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "22px"
---

# Design System: Console Connect

## Overview

**Creative North Star: "The Well-Run Studio"**

Console Connect is a studio shared by people who build software together. Each person has a desk (their task and console), there is a shared table (team chat and decisions), and there are rooms you can see into (the Office). The studio is well run: everything has a place, work in progress is visible, and nothing shouts. The look descends from the Paper & ink Review Desk: warm paper surfaces, an editorial serif for titles, and a quiet sans for everything you operate.

It is an operate surface people sit in all day, so density is high and the chrome recedes. Personality lives in the details: soft layered depth instead of boxes, controls that respond to a press, a selection card that slides between tasks, and serif titles that make each task feel like a document worth reading. Motion confirms what happened and never decorates.

Three color themes (Forest & linen, Blue & porcelain, Ochre & parchment) are the same studio in different light. They change color only.

**Key Characteristics:**
- Warm paper surfaces with tinted, never pure, whites and darks
- Newsreader serif for titles, Instrument Sans for the interface, tabular figures throughout
- Soft layered shadows mark real layers; borders are hairline dividers only
- Tactile and restrained controls: a slight press, eased color, one strong action per area
- Three interchangeable color themes over one fixed structure

## Colors

A warm, low-chroma paper palette with one confident accent per theme. Values in the frontmatter are the default theme, Forest & linen.

### Primary
- **Studio Green** (accent): primary buttons, the active tab underline, focus rings, count badges, and running-state dots. It marks where to act or what is live, never decoration.
- **Deep Studio Green** (accent-hover): hover and pressed state of primary buttons.

### Neutral
- **Linen Canvas** (canvas): the room behind everything: page background, chat stream, right rail, secondary-button hover.
- **Sage Sidebar** (sidebar): the task sidebar and console toolbar. A slightly greener, darker paper that frames the desk.
- **Warm Paper** (surface): the desk itself: main content, panels, inputs, the selected task card, other people's chat bubbles.
- **Forest Ink** (text): all primary text. A deep green-black, never `#000`.
- **Sage Grey** (muted): secondary text, metadata, labels, inactive tabs. Derived from the palette's hue, not a generic grey.
- **Hairline Sage** (border): 1px dividers and the inset hairline on secondary buttons.
- **Pale Sage** (selection): your own chat bubbles, text selection, the reply preview, secondary hover.
- **Paper on Green** (on-accent): text on accent fills.

### State
- **Studio Green** (success), **Ochre Warning** (warning), **Clay Red** (danger): fixed across all themes. State is always paired with a shape or a word, never color alone (for example, status dots differ in fill and ring as well as hue).

### Themes
Each theme swaps the same roles. The source of truth in code is `src/themes/_internal/palettes.ts`, applied at runtime as `--color-<role>` custom properties.

| Role | Forest & linen (default) | Blue & porcelain | Ochre & parchment |
| --- | --- | --- | --- |
| canvas | #F4F2E9 | #F3F5F8 | #F7F1E6 |
| sidebar | #E5E9DF | #E4EAF1 | #EEE3D1 |
| surface | #FCFBF5 | #FCFDFE | #FFFCF5 |
| text | #253A30 | #24354D | #3D3026 |
| muted | #5B6B5E | #596B80 | #77614F |
| border | #CDD5C7 | #CDD6E1 | #DCCDB9 |
| accent | #2D624B | #355CA8 | #9A4F19 |
| accent-hover | #234E3C | #294986 | #7C3E13 |
| selection | #DCE6D8 | #D9E4F5 | #EBDCC5 |

The terminal follows the theme for background (surface), foreground (text), cursor (accent), and selection. Its sixteen ANSI colors are fixed across themes.

**The Same Room, Different Light Rule.** A theme changes color and nothing else. Type, spacing, radius, elevation, and motion are identical in all three.

**The Role Variable Rule.** Every color in UI code comes from a role variable (`var(--color-accent)`, or `color-mix()` on one). Hard-coded hex in components breaks the other two themes. Shadows derive from `var(--color-text)` for the same reason.

**The One Accent Rule.** The accent marks action or liveness. If more than one filled accent button competes in an area, one of them is wrong.

## Typography

**Display Font:** Newsreader (self-hosted variable, optical sizing on; Georgia fallback)
**Body Font:** Instrument Sans (self-hosted variable; Segoe UI fallback)
**Mono Font:** Consolas for the terminal, where xterm needs stable glyph metrics

**Character:** An editorial serif gives tasks, workspaces, and decisions the weight of a document. A clear, slightly condensed sans keeps controls quick to scan. Figures are tabular everywhere, so counts and times line up.

### Hierarchy
- **Display** (400, clamp(32px, 3vw, 48px), 1.08, -0.025em): task titles, page titles such as Projects and Settings.
- **Headline** (400, 22px, 1.25): section titles, chat room title, project names.
- **Title** (600, 13px): task names in the sidebar, card headings, button labels.
- **Body** (400, 16px, 1.65): descriptions and reading text, capped near 65ch.
- **Label** (600, 12px): field labels, metadata, timestamps, in sentence case.
- **Mono** (400, 13px): terminal output only.

**The Sentence Case Rule.** Headings and labels are sentence case. The "CONSOLE CONNECT" wordmark is the only uppercase text in the interface. No uppercase eyebrow labels above headings.

## Layout

The workspace is three columns: a sidebar (244px) with the workspace, tasks, and your identity with the Settings button at the bottom; the desk (flexible, min 420px, content capped near 960px); and a right rail (230px) for team and decisions. Below 900px the rail moves under the desk; below 600px everything stacks and the task list scrolls horizontally.

The top bar is 76px today; the approved P2 change makes it a 48px bar with a workspace / task breadcrumb. The console workspace fills the desk to the window edge, with a session rail and a focus mode (see `docs/adr/2026-09-25-console-workspace.md`). Only inner regions scroll: the task list, chat stream, and terminal.

Spacing favors tight groups inside a unit and generous air between units. Desk content uses about 54px top padding and 7vw side padding; panels use 16–28px inside.

## Elevation & Depth

Soft, structural lift. Shadows mark real layers (panels on the desk, the console well, the selected task card, drawers, dialogs, and toasts), and every shadow is tinted from the text color so it belongs to the theme. Borders are reserved for hairline dividers and quiet control outlines.

### Shadow Vocabulary
- **Ring** (`0 0 0 1px color-mix(in oklab, var(--color-text) 8%, transparent)`): the hairline edge inside every lifted surface.
- **Lift 1** (ring + `0 1px 2px` at 7%): selected task card, chat bubbles.
- **Lift 2** (ring + `0 1px 2px` at 6% + `0 12px 28px -14px` at 22%): action panel, package summary, setup forms, console well.
- **Lift 3** (ring + `0 2px 4px` at 6% + `0 24px 48px -16px` at 28%): chat drawer, toasts, dialogs.

**The No Box Rule.** Don't wrap content in a 1px bordered box to separate it. Use space first, then a lift level.

## Shapes

Gently rounded and consistent. Controls (buttons, inputs, task cards) use 8px corners. Panels and the console well use 12px. Chat bubbles use 14px with one tighter 4px corner pointing at the sender. Pills and badges are fully round. Status dots are 8px, and their shape carries meaning: filled means active, a ring means waiting, dashed means unassigned.

**The No Side Stripe Rule.** No colored left or right borders on cards, quotes, callouts, or list items. Use a tint (quotes, reply previews) or a lift instead.

## Components

Tactile and restrained: every control responds to touch, and none of them shout.

### Buttons
- **Shape:** gently rounded (8px).
- **Primary:** Studio Green fill, paper text, 11px 16px padding, a faint inner highlight and a small tinted drop shadow.
- **Hover / Active:** color eases to Deep Studio Green over 150ms. Pressing scales to 0.97 over 120ms and the shadow turns inward.
- **Focus:** a 2px surface gap and a 2px accent ring, keyboard only.
- **Secondary:** transparent with an inset hairline, weight 500. Hover fills with canvas.
- **Text:** muted text with no fill, darkening to text color on hover.
- **Icon:** 36px square, muted, filling with selection on hover. The Settings gear turns 45° on hover.

### Inputs / Fields
- **Style:** Warm Paper background, hairline border, 8px corners, 10px padding.
- **Focus:** the border turns accent and a 3px accent halo at 18% appears.

### Navigation (task sidebar)
- **Style:** Sage Sidebar background with task rows of a title plus a status line.
- **Selected:** a Warm Paper card with Lift 1 that slides to the chosen task (220ms ease-out), instead of a background snap.
- **Status:** an 8px shape-coded dot before each task.
- **Tabs:** sentence-case labels with an accent underline that glides between tabs.

### Chat
- **Bubbles:** borderless, other people's on Warm Paper with Lift 1, your own on Pale Sage without a shadow. The tight corner points at the sender.
- **Arrival:** new messages rise 6px into place; your own settle from 0.96 scale.
- **Drawer:** slides in from the right over 280ms ease-out-expo with Lift 3 and exits in about 180ms.

### Signature: the console well
The terminal sits in a 12px-rounded well with Lift 2 under a session strip (tool, branch, elapsed time, state). It fills the desk to the window edge. When a tool needs input, a warning-tinted bar appears under the output.

## Do's and Don'ts

### Do:
- **Do** use role variables (`var(--color-*)`) for every color and check new screens in all three themes.
- **Do** separate content with space first and a lift level second.
- **Do** pair every state color with a shape or a word.
- **Do** keep daily-use motion short: presses 120ms, state changes 150–240ms, drawers about 280ms, with nothing under reduced motion.
- **Do** use tabular figures for counts, times, and revisions.

### Don't:
- **Don't** hard-code hex colors in UI code.
- **Don't** use colored side borders on cards, quotes, callouts, or list items.
- **Don't** use uppercase eyebrow labels; the wordmark is the only uppercase text.
- **Don't** use `#000` or `#fff`; the darkest and lightest values are tinted.
- **Don't** let a theme change anything but color.
