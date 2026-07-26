# Chrome Web Store Draft

## Name

Habitica Time Ledger

## Short description

Turn Habitica completions into activity timelines, category breakdowns, and project analytics.

## Detailed description

Habitica Time Ledger adds a visual analytics layer to Habitica without introducing a separate timer or task manager.

Configure a category, project, and minutes-per-completion value for each Habitica task. Then continue using Habitica normally. When tasks are completed on the Habitica website, Time Ledger records the completion and builds:

- an hour-by-hour activity timeline
- category and project breakdowns
- completion history
- light and dark dashboards

Repeated numbered tasks can share setup, and deleted/recreated To-Dos can inherit earlier settings after sync.

Habitica Time Ledger stores credentials, configuration, and activity records locally in Chrome storage. Credentials are sent only to Habitica's official API for synchronization. The extension does not operate an external analytics server and does not sell or use data for advertising.

This is an unofficial companion extension and is not affiliated with or endorsed by Habitica.

## Category

Productivity

## Suggested screenshots

1. Dashboard in light mode
2. Dashboard in dark mode
3. Task setup page
4. Habitica completion followed by a Time Ledger record

## Permission justifications

### storage

Stores user preferences, Habitica connection details, task setup, sync snapshots, and activity records locally in the browser.

### alarms

Schedules lightweight local sync reminders and recovery checks.

### webRequest

Observes completed Habitica task-score requests on Habitica domains to record completion timestamps. It does not inspect traffic from unrelated websites.

### host access: habitica.com

Required to run the completion listener on Habitica pages and communicate with Habitica's official API.

## Before submission

- Remove any unused permission, especially `unlimitedStorage`, if testing confirms it is unnecessary.
- Add a public privacy-policy URL.
- Prepare 1280 × 800 store screenshots.
- Create a clean store ZIP with `manifest.json` at its root.
- Complete Chrome Web Store privacy disclosures accurately.
- Test a fresh installation in a separate Chrome profile.
