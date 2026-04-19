# Operation Log Starter App

This is a simple browser-based app for logging patients you operated on.

## What It Does

- Add a patient entry with name, hospital number, procedure, date, lead surgeon, assistant, diagnosis, and notes
- Edit an existing entry
- Search your saved entries
- Delete entries
- Save data in your browser using multiple local backup layers
- Export data as JSON or CSV
- Import entries from JSON
- View grouped cases and infographic summaries
- Capture or upload a photo and extract text into the form
- Optionally sync a JSON backup file to Google Drive when the app is hosted online

## How To Open It

1. Open `index.html` in your browser.
2. Start adding entries.

## Google Drive Sync Setup

1. Host the app on `http://localhost` or `https://...`. Google sign-in will not work from `file:///`.
2. Create a Google Cloud project.
3. Enable the Google Drive API.
4. Create a web OAuth client and add your hosted app URL as an authorized JavaScript origin.
5. Copy `config.example.js` into `config.js`.
6. Fill in `googleClientId` and `googleApiKey` in `config.js`.
7. Open the hosted app, click `Connect Google Drive`, and approve access.

After that, the app will update one backup JSON file in Google Drive after each save, edit, delete, or import.

## Deploy Help

For a beginner-friendly publish walkthrough, see `DEPLOY_GUIDE.md`.

## Important Note

This is a learning and workflow starter app. It is not a full hospital system and does not provide the security, audit trails, access controls, backups, or compliance features needed for real production medical record software.
