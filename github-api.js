// GitHub API Integration Module
class GitHubAPI {
    constructor() {
        this.config = this.loadConfig();
        this.syncQueue = this.loadSyncQueue();
        this.isConnected = false;
        this.currentSHA = null;
    }

    // Load configuration from localStorage
    loadConfig() {
        const stored = localStorage.getItem('github-config');
        return stored ? JSON.parse(stored) : {
            owner: '',
            repo: '',
            branch: 'main',
            dataFile: 'data/db.json',
            token: ''
        };
    }

    // Save configuration to localStorage
    saveConfig(config) {
        this.config = { ...this.config, ...config };
        // Obfuscate token before saving
        const toSave = { ...this.config };
        if (toSave.token) {
            toSave.token = btoa(toSave.token);
        }
        localStorage.setItem('github-config', JSON.stringify(toSave));
    }

    // Get deobfuscated token
    getToken() {
        if (!this.config.token) return null;
        try {
            // Check if already decoded
            if (this.config.token.startsWith('ghp_') || this.config.token.startsWith('github_pat_')) {
                return this.config.token;
            }
            // Decode base64
            return atob(this.config.token);
        } catch (e) {
            return this.config.token;
        }
    }

    // Test GitHub connection
    async testConnection() {
        const token = this.getToken();
        if (!token || !this.config.owner || !this.config.repo) {
            throw new Error('GitHub configuration incomplete');
        }

        try {
            const response = await fetch(
                `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`,
                {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.isConnected = true;
            return { success: true, repo: data.name, owner: data.owner.login };
        } catch (error) {
            this.isConnected = false;
            throw error;
        }
    }

    // Initialize GitHub connection
    async initialize() {
        const token = this.getToken();
        if (!token) {
            console.log('No GitHub token configured, running in local mode');
            return false;
        }

        try {
            await this.testConnection();
            console.log('GitHub connection established');
            return true;
        } catch (error) {
            console.error('GitHub initialization failed:', error);
            this.handleError(error);
            return false;
        }
    }

    // Fetch data from GitHub
    async fetchData() {
        const token = this.getToken();
        if (!token || !this.isConnected) {
            return this.loadLocalData();
        }

        try {
            const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${this.config.dataFile}?ref=${this.config.branch}`;
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status === 404) {
                // File doesn't exist yet, return initial data
                console.log('Data file not found in GitHub, using initial data');
                return this.getInitialData();
            }

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.currentSHA = data.sha;
            
            // Decode base64 content with UTF-8 support
            const content = this.base64ToUtf8(data.content);
            const jsonData = JSON.parse(content);
            
            // Save to local storage as backup
            this.saveLocalData(jsonData);
            
            return jsonData;
        } catch (error) {
            console.error('Error fetching from GitHub:', error);
            this.handleError(error);
            return this.loadLocalData();
        }
    }

    // Commit data to GitHub
    async commitData(data, commitMessage) {
        const token = this.getToken();
        if (!token || !this.isConnected) {
            this.addToSyncQueue('update', data, commitMessage);
            this.saveLocalData(data);
            return { success: false, queued: true };
        }

        try {
            const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${this.config.dataFile}`;
            
            // Update timestamp
            data.lastUpdated = new Date().toISOString();
            
            // Prepare content with UTF-8 support
            const content = this.utf8ToBase64(JSON.stringify(data, null, 2));
            
            const body = {
                message: commitMessage,
                content: content,
                branch: this.config.branch
            };
            
            // Add SHA if we have it (for updates)
            if (this.currentSHA) {
                body.sha = this.currentSHA;
            }
            
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                if (response.status === 409) {
                    // Conflict - someone else updated the file
                    throw new Error('CONFLICT');
                }
                throw new Error(`GitHub commit failed: ${response.status} ${errorData.message}`);
            }

            const result = await response.json();
            this.currentSHA = result.content.sha;
            
            // Save to local storage as backup
            this.saveLocalData(data);
            
            return { success: true, commit: result.commit };
        } catch (error) {
            console.error('Error committing to GitHub:', error);
            
            if (error.message === 'CONFLICT') {
                return await this.handleConflict(data, commitMessage);
            }
            
            this.handleError(error);
            this.addToSyncQueue('update', data, commitMessage);
            this.saveLocalData(data);
            return { success: false, queued: true, error: error.message };
        }
    }

    // Handle merge conflicts
    async handleConflict(localData, commitMessage) {
        try {
            // Fetch latest version from GitHub
            const remoteData = await this.fetchData();
            
            // Simple merge strategy: combine arrays, prefer local for conflicts
            const mergedData = this.mergeData(remoteData, localData);
            
            // Try to commit merged data
            return await this.commitData(mergedData, `${commitMessage} (merged)`);
        } catch (error) {
            console.error('Error handling conflict:', error);
            return { success: false, conflict: true, error: error.message };
        }
    }

    // Merge data (simple strategy)
    mergeData(remote, local) {
        const merged = {
            version: local.version,
            lastUpdated: new Date().toISOString(),
            users: remote.users, // Keep remote users
            tasks: this.mergeArrays(remote.tasks, local.tasks, 'id'),
            requests: this.mergeArrays(remote.requests, local.requests, 'id'),
            history: [...remote.history, ...local.history].sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            )
        };
        return merged;
    }

    // Merge arrays by ID
    mergeArrays(remote, local, idField) {
        const map = new Map();
        
        // Add remote items
        remote.forEach(item => map.set(item[idField], item));
        
        // Override with local items (local wins)
        local.forEach(item => map.set(item[idField], item));
        
        return Array.from(map.values());
    }

    // Handle errors
    handleError(error) {
        const errorMessage = error.message || error.toString();
        
        if (errorMessage.includes('401')) {
            this.showError('Invalid GitHub token. Please reconfigure in Settings.');
            this.isConnected = false;
        } else if (errorMessage.includes('404')) {
            this.showError('Repository or file not found. Check Settings.');
        } else if (errorMessage.includes('409') || errorMessage === 'CONFLICT') {
            this.showError('Conflict detected. Someone else modified the data. Refreshing...');
        } else if (errorMessage.includes('rate limit')) {
            this.showError('GitHub API rate limit exceeded. Try again later.');
        } else {
            this.showError(`GitHub sync failed: ${errorMessage}. Changes saved locally.`);
        }
        
        this.updateConnectionStatus('error');
    }

    // Show error message (will be implemented in app.js)
    showError(message) {
        if (window.showToast) {
            window.showToast(message, 'error');
        } else {
            console.error(message);
        }
    }

    // Update connection status UI
    updateConnectionStatus(status) {
        const statusDot = document.getElementById('connectionDot');
        const statusText = document.getElementById('connectionText');
        const statusIndicator = document.querySelector('.status-indicator');
        
        if (statusDot && statusText) {
            statusDot.className = 'status-dot';
            statusIndicator.className = 'status-indicator';
            
            switch (status) {
                case 'connected':
                    statusDot.classList.add('connected');
                    statusIndicator.classList.add('connected');
                    statusText.textContent = 'GitHub Connected';
                    break;
                case 'local':
                    statusDot.classList.add('local');
                    statusText.textContent = 'Local Mode';
                    document.getElementById('localModeWarning').style.display = 'flex';
                    document.getElementById('syncBtn').style.display = 'inline-flex';
                    break;
                case 'error':
                    statusDot.classList.add('error');
                    statusIndicator.classList.add('error');
                    statusText.textContent = 'GitHub Error';
                    document.getElementById('syncBtn').style.display = 'inline-flex';
                    break;
                default:
                    statusText.textContent = 'Checking...';
            }
        }
    }

    // Sync queue management
    loadSyncQueue() {
        const stored = localStorage.getItem('sync-queue');
        return stored ? JSON.parse(stored) : [];
    }

    saveSyncQueue() {
        localStorage.setItem('sync-queue', JSON.stringify(this.syncQueue));
    }

    addToSyncQueue(action, data, message) {
        this.syncQueue.push({
            action,
            data,
            message,
            timestamp: new Date().toISOString()
        });
        this.saveSyncQueue();
    }

    async processSyncQueue() {
        if (this.syncQueue.length === 0) return { processed: 0, failed: 0 };
        
        let processed = 0;
        let failed = 0;
        
        while (this.syncQueue.length > 0) {
            const item = this.syncQueue[0];
            
            try {
                const result = await this.commitData(item.data, item.message);
                if (result.success) {
                    this.syncQueue.shift();
                    processed++;
                } else {
                    failed++;
                    break; // Stop if one fails
                }
            } catch (error) {
                console.error('Sync queue processing error:', error);
                failed++;
                break;
            }
        }
        
        this.saveSyncQueue();
        return { processed, failed, remaining: this.syncQueue.length };
    }

    // Local storage management
    saveLocalData(data) {
        localStorage.setItem('operation-tracker-data', JSON.stringify(data));
    }

    loadLocalData() {
        const stored = localStorage.getItem('operation-tracker-data');
        return stored ? JSON.parse(stored) : this.getInitialData();
    }

    // Get initial data structure
    getInitialData() {
        return {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            users: [
                { id: 1, name: "Liam", role: "Tech Lead" },
                { id: 2, name: "Trân", role: "Sales Lead" },
                { id: 3, name: "Taddy", role: "CEO" },
                { id: 4, name: "Hiếu", role: "Software Lead" },
                { id: 5, name: "Vỹ", role: "UX Lead" },
                { id: 6, name: "Intern Thân", role: "Tech Intern" },
                { id: 7, name: "Intern Trân", role: "Tech Intern" }
            ],
            tasks: [],
            requests: [],
            history: []
        };
    }

    // Export data to file
    exportData(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `operation-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Import data from file
    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    
                    // Validate structure
                    if (!data.version || !data.users || !data.tasks || !data.requests || !data.history) {
                        throw new Error('Invalid data structure');
                    }
                    
                    // Commit to GitHub
                    const result = await this.commitData(
                        data, 
                        `Data imported from backup by ${window.currentUser?.name || 'Unknown'}`
                    );
                    
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // UTF-8 to Base64 conversion (handles Unicode characters)
    utf8ToBase64(str) {
        try {
            // Use TextEncoder for proper UTF-8 encoding
            const encoder = new TextEncoder();
            const bytes = encoder.encode(str);
            
            // Convert bytes to binary string
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            
            // Convert to base64
            return btoa(binary);
        } catch (error) {
            console.error('UTF-8 to Base64 encoding error:', error);
            // Fallback to simple btoa (may fail with Unicode)
            return btoa(str);
        }
    }

    // Base64 to UTF-8 conversion (handles Unicode characters)
    base64ToUtf8(base64) {
        try {
            // Decode base64 to binary string
            const binary = atob(base64);
            
            // Convert binary string to bytes
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            
            // Use TextDecoder for proper UTF-8 decoding
            const decoder = new TextDecoder();
            return decoder.decode(bytes);
        } catch (error) {
            console.error('Base64 to UTF-8 decoding error:', error);
            // Fallback to simple atob
            return atob(base64);
        }
    }

    // Check online status
    setupOnlineListener() {
        window.addEventListener('online', async () => {
            this.showError('Back online! Syncing pending changes...');
            await this.initialize();
            const result = await this.processSyncQueue();
            if (result.processed > 0) {
                this.showError(`Synced ${result.processed} pending changes`);
            }
        });

        window.addEventListener('offline', () => {
            this.showError('You are offline. Changes will sync when connection returns.');
            this.updateConnectionStatus('local');
        });
    }
}

// Create global instance
const githubAPI = new GitHubAPI();

// Setup online/offline listeners
githubAPI.setupOnlineListener();