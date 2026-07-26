# Changelog

All notable changes to Habitica Time Ledger are documented here.

The project follows semantic versioning where practical during beta development.

## [0.5.1] - 2026-07-26

### Fixed

- Added support for Habitica's current `/api/v4/tasks/:id/score/:direction` web requests while retaining v3 compatibility.
- Fixed To-Do web completions not being captured immediately.

### Added

- Remember task setup by normalized task name.
- Allow deleted and recreated To-Dos to inherit earlier setup after sync.
- Allow numbered task variants to share setup when **Apply to similar names** is enabled.

## [0.5.0] - 2026-07-26

### Added

- Automatic web-completion capture.
- Sync recovery for missed Daily and To-Do changes.
- Colorful activity dashboard with hourly timeline.
- Category and project breakdowns.
- Light and dark themes.

### Changed

- Replaced timer-based tracking with completion-based activity logging.
- Renamed user-facing time labels from “Estimated Time” to “Activity Time.”

## [0.4.0] - 2026-07-26

### Added

- Per-task category, project, and minutes-per-completion setup.
- Completion-derived activity blocks.
- Initial English-first light interface.

## [0.3.0] - 2026-07-26

### Added

- Experimental Habitica page integration.

## [0.2.0] - 2026-07-26

### Added

- Initial local dashboard and task synchronization prototype.
