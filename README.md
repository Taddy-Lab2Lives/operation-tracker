# Operation Tracker - Setup Guide

A comprehensive Kanban-style operation tracking tool for internal team coordination between Tech and Sales teams. The app displays work progress, handles requests, and facilitates communication with customers.

## Features

- **Dual Kanban Board**: Planning vs Actual progress tracking
- **GitHub Integration**: Data persistence via GitHub API
- **Role-based Access**: Tech Lead (admin), Sales Lead, and view-only roles
- **Request Management**: Sales can create requests, Tech Lead can approve/reject
- **History Tracking**: Complete audit trail of all changes
- **Offline Support**: Local storage fallback when GitHub is unavailable
- **Export/Import**: Backup and restore data
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start (Local Mode)

1. Open `index.html` in your browser
2. Select your user role from the dropdown
3. Start using the app (data saved to browser localStorage)

## GitHub Setup (Required for multi-user sync)

### 1. Create GitHub Repository

```bash
# Create a new repository named "operation-tracker"
# Make it private if you want to keep data confidential
```

### 2. Generate Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name: "Operation Tracker"
4. Select scopes:
   - ✅ **repo** (Full control of private repositories)
5. Click "Generate token"
6. **IMPORTANT**: Copy the token immediately (you won't see it again)

### 3. Initialize Repository

```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/operation-tracker.git
cd operation-tracker

# Copy all application files
# - index.html
# - styles.css
# - app.js
# - github-api.js
# - data/db.json

# Commit and push
git add .
git commit -m "Initial setup"
git push origin main
```

### 4. Deploy to GitHub Pages

1. Go to repository Settings → Pages
2. Source: Deploy from branch **main**
3. Folder: **/ (root)**
4. Save
5. Wait 1-2 minutes for deployment

### 5. Configure App

1. Open your deployed app: `https://YOUR_USERNAME.github.io/operation-tracker`
2. Click Settings (admin passcode: **admin**)
3. Enter:
   - Repository Owner: YOUR_USERNAME
   - Repository Name: operation-tracker
   - Branch: main
   - Personal Token: (paste your token)
4. Click "Test Connection"
5. If successful, click "Save Settings"

### 6. Share with Team

- Share the GitHub Pages URL with your team
- Each user selects their role from dropdown
- Only Tech Lead needs admin passcode
- All changes sync automatically via GitHub

## User Roles & Permissions

### Tech Lead (Liam)
- **Passcode**: `admin`
- Create/update/delete tasks
- Approve/reject sales requests
- Mark tasks as blocked/critical
- Configure GitHub settings
- Import/export data

### Sales Lead (Trân)
- View all tasks and progress
- Create requests for customer changes
- View history logs

### Other Users
- View dashboard and tasks
- View history logs

## Local Development Mode

If you want to test without GitHub:

1. Open `index.html` directly in browser
2. App will run in "Local Mode"
3. Data saved to browser localStorage
4. Use Export/Import to share data manually

## Keyboard Shortcuts

- `Ctrl+K`: Open search (coming soon)
- `Ctrl+N`: Create new task (Tech Lead only)
- `Ctrl+R`: Refresh data

## Data Structure

The application uses a JSON database with the following structure:

```json
{
  "version": "1.0.0",
  "users": [...],
  "tasks": [...],
  "requests": [...],
  "history": [...]
}
```

## Troubleshooting

### "401 Unauthorized" error
- Token expired or invalid
- Regenerate token with `repo` scope

### "404 Not Found" error
- Check repository name and owner
- Ensure data/db.json exists in repo

### "409 Conflict" error
- Multiple users edited simultaneously
- App will fetch latest version and prompt to merge

### Local mode stuck
- Check browser console for errors
- Verify token has correct permissions
- Ensure repository is accessible

### Cannot create/edit tasks
- Ensure you're logged in as Tech Lead
- Use passcode: `admin` when prompted

## Security Notes

1. **Token Storage**: Personal access tokens are stored in browser localStorage with basic obfuscation
2. **Passcode**: The admin passcode is hardcoded as "admin" - change this in production
3. **Data Privacy**: Use a private repository if data is sensitive

## Browser Compatibility

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers supported

## Project Structure

```
operation-tracker/
├── index.html          # Main HTML file
├── styles.css          # All styling
├── app.js              # Core application logic
├── github-api.js       # GitHub API integration
├── data/
│   └── db.json         # Initial database
└── README.md           # This file
```

## API Rate Limits

GitHub API has rate limits:
- Unauthenticated: 60 requests/hour
- Authenticated: 5,000 requests/hour

The app implements debouncing and queuing to minimize API calls.

## Backup & Recovery

### Export Data
1. Click "Export Data" button
2. Save the JSON file to your computer

### Import Data
1. Click "Import Data" button (Tech Lead only)
2. Select your backup JSON file
3. Confirm to overwrite current data

## Contributing

This is an internal tool. For issues or suggestions:
1. Create an issue in the GitHub repository
2. Contact the Tech Lead directly

## License

Internal use only - not for public distribution.

## Support

For help or questions:
- Check this README first
- Review browser console for errors
- Contact Tech Lead (Liam) with admin passcode