// ── Google Cloud configuration ──────────────────────────────────────────
// You MUST replace this with your own OAuth Client ID before Drive sync
// will work. See README.md → "Configurer Google Drive" for the exact steps.
//
// This is a public, client-side value (it is meant to be visible in the
// browser) — it is not a secret. It only identifies which Google Cloud
// project is asking for permission; Google still requires the signed-in
// user to explicitly grant access on first use.
export const GOOGLE_CLIENT_ID = 'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com';

// Narrowest possible scope: this app can only see/edit the one hidden
// "app data" folder it creates for itself — it can never see, list, or
// touch any other file in the user's Google Drive.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const DRIVE_FILE_NAME = 'calorie-tracker-data.json';
export const DRIVE_BACKUP_PREFIX = 'calorie-tracker-backup-';
export const MAX_BACKUPS = 14; // keep ~2 weeks of daily dated snapshots
