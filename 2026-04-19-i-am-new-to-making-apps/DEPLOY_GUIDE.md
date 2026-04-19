# Deploy Guide

This app can be hosted as a simple static website.

## Best Path For You

The easiest beginner-friendly option is:

1. Put the app files in a GitHub repository
2. Connect that repository to Netlify
3. Use the Netlify site URL on your phone
4. Add Google Drive settings after the site is live

## Important Before You Deploy

Your current app is being opened from `file:///...`.

That means:

- the entries saved there live under the local `file://` browser storage
- the hosted website will use a different browser storage area
- your current entries will not automatically appear on the hosted site

Before switching, export a JSON backup from the current app.

## Files Needed For Hosting

These files should stay together:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `netlify.toml`

## What You Need To Do

### 1. Create a GitHub account and repository

If you do not already have GitHub:

1. Create an account at [github.com](https://github.com)
2. Create a new repository
3. Give it a simple name like `operation-log`

### 2. Upload this project to GitHub

Upload the files from this folder into that repository.

### 3. Create a Netlify account

1. Go to [netlify.com](https://www.netlify.com/)
2. Sign in
3. Choose the option to import an existing Git repository
4. Connect your GitHub account
5. Select your `operation-log` repository

### 4. Deploy the site

For this project:

- build command: leave blank
- publish directory: leave blank if Netlify detects the root, or use `.`

Once deployed, Netlify will give you a live URL like:

`https://your-site-name.netlify.app`

That is the link you can open on your phone anywhere.

### 5. Test the hosted app

Open the Netlify URL on your phone and make sure:

- the page loads
- you can add a patient
- search works
- export works
- photo upload opens

### 6. Move your existing data

If you already logged patients in the local `file://` version:

1. Open the old version on your computer
2. Click `Export JSON`
3. Open the hosted version
4. Click `Import JSON`

That moves your logbook into the hosted app's browser storage.

## Google Drive Setup

After the site is live, you can connect Google Drive backup.

### 1. Create a Google Cloud project

Go to [Google Cloud Console](https://console.cloud.google.com/).

### 2. Enable the Google Drive API

In your Google Cloud project, enable the Google Drive API.

### 3. Create credentials

Create:

- an OAuth 2.0 Client ID for a web application
- an API key

### 4. Add your site URL as an allowed origin

In the OAuth web client settings, add your Netlify URL as an authorized JavaScript origin.

Example:

`https://your-site-name.netlify.app`

### 5. Restrict the API key

Restrict the API key to:

- the Google Drive API
- your Netlify site URL as the allowed website origin

### 6. Update `config.js`

Open `config.js` and fill in:

- `googleClientId`
- `googleApiKey`

Then redeploy the site by updating the repository.

## What Happens After That

Once the hosted site is live and Google is configured:

- you can open the app on your phone from anywhere
- the app will still save locally in the browser
- it can also sync a backup JSON file to your Google Drive

## Important Limits

This is still a starter web app, not a full clinical records platform.

That means it still does **not** provide:

- enterprise access control
- audit logging
- medical compliance tooling
- secure shared multi-user patient records

For a true long-term hospital-grade system, the next step would be a proper backend database and authenticated accounts.
