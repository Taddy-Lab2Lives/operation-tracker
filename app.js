// Main Application Logic
let appData = null;
let currentUser = null;
let currentFilter = 'all';
let pendingAction = null;

// Initialize application
async function initApp() {
    // Load user from localStorage
    const savedUserId = localStorage.getItem('current-user');
    if (savedUserId) {
        const users = githubAPI.getInitialData().users;
        currentUser = users.find(u => u.id == savedUserId);
        if (currentUser) {
            document.getElementById('userSelector').value = savedUserId;
        }
    }

    // Initialize GitHub connection
    await githubAPI.initialize();
    
    // Load data
    await loadData();
    
    // Setup UI
    populateUserSelectors();
    renderDashboard();
    renderKanban();
    renderRequests();
    renderHistory();
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
}

// Load data from GitHub or local storage
async function loadData() {
    showLoading(true);
    try {
        appData = await githubAPI.fetchData();
        
        // Add initial demo data if empty
        if (appData.tasks.length === 0) {
            appData.tasks = getInitialTasks();
            await saveData('Initial demo data loaded');
        }
        
        githubAPI.updateConnectionStatus(githubAPI.isConnected ? 'connected' : 'local');
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Error loading data', 'error');
    } finally {
        showLoading(false);
    }
}

// Save data with commit message
async function saveData(commitMessage) {
    showLoading(true);
    try {
        const result = await githubAPI.commitData(appData, commitMessage);
        
        if (result.success) {
            showToast('Changes saved to GitHub', 'success');
        } else if (result.queued) {
            showToast('Changes saved locally (will sync when online)', 'warning');
        } else if (result.conflict) {
            showToast('Conflict resolved and changes saved', 'info');
            await loadData(); // Reload to get merged data
        }
        
        return result;
    } catch (error) {
        console.error('Error saving data:', error);
        showToast('Error saving changes', 'error');
        return { success: false };
    } finally {
        showLoading(false);
    }
}

// Refresh data from GitHub
async function refreshData() {
    await loadData();
    renderDashboard();
    renderKanban();
    renderRequests();
    renderHistory();
    showToast('Data refreshed', 'success');
}

// Sync now (process sync queue)
async function syncNow() {
    showLoading(true);
    try {
        const result = await githubAPI.processSyncQueue();
        if (result.processed > 0) {
            showToast(`Synced ${result.processed} pending changes`, 'success');
            await loadData();
        } else if (result.remaining > 0) {
            showToast(`${result.remaining} changes still pending`, 'warning');
        } else {
            showToast('All changes are synced', 'info');
        }
    } catch (error) {
        showToast('Sync failed', 'error');
    } finally {
        showLoading(false);
    }
}

// User management
function changeUser() {
    const select = document.getElementById('userSelector');
    const userId = select.value;
    
    if (userId) {
        currentUser = appData.users.find(u => u.id == userId);
        localStorage.setItem('current-user', userId);
        updateUIForUser();
    } else {
        currentUser = null;
        localStorage.removeItem('current-user');
        updateUIForUser();
    }
}

function updateUIForUser() {
    const isAdmin = currentUser && currentUser.role === 'Tech Lead';
    const isSales = currentUser && currentUser.role === 'Sales Lead';
    
    // Show/hide buttons based on role
    document.getElementById('createTaskBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('settingsBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('createRequestBtn').style.display = isSales ? 'inline-flex' : 'none';
    
    // Update task cards
    document.querySelectorAll('.task-edit-btn').forEach(btn => {
        btn.style.display = isAdmin ? 'inline-flex' : 'none';
    });
}

// Tab navigation
function switchTab(tabName) {
    // Update tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`${tabName}View`).classList.add('active');
}

// Dashboard rendering
function renderDashboard() {
    if (!appData) return;
    
    const now = new Date();
    let totalTasks = 0;
    let onTimeTasks = 0;
    let delayedTasks = 0;
    let criticalTasks = 0;
    
    appData.tasks.forEach(task => {
        if (currentFilter !== 'all' && task.projectName !== currentFilter) return;
        
        totalTasks++;
        
        if (task.priority === 'critical' || task.priority === 'blocked') {
            criticalTasks++;
        } else if (task.actualStatus === 'done') {
            if (!task.actualDate || new Date(task.actualDate) <= new Date(task.planDate)) {
                onTimeTasks++;
            } else {
                delayedTasks++;
            }
        } else if (new Date(task.planDate) < now) {
            delayedTasks++;
        } else {
            onTimeTasks++;
        }
    });
    
    const pendingRequests = appData.requests.filter(r => r.status === 'pending').length;
    
    document.getElementById('totalTasks').textContent = totalTasks;
    document.getElementById('onTimeTasks').textContent = onTimeTasks;
    document.getElementById('delayedTasks').textContent = delayedTasks;
    document.getElementById('criticalTasks').textContent = criticalTasks;
    document.getElementById('pendingRequests').textContent = pendingRequests;
}

// Project filter
function filterProject(project) {
    currentFilter = project;
    
    // Update filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Re-render
    renderDashboard();
    renderKanban();
}

// Kanban board rendering
function renderKanban() {
    if (!appData) return;
    
    // Clear all columns
    const columns = [
        'today-planned', 'in-progress-planned', 'in-progress-actual', 'done-actual'
    ];
    
    columns.forEach(col => {
        const element = document.getElementById(col);
        if (element) element.innerHTML = '';
    });
    
    // Render tasks
    appData.tasks.forEach(task => {
        if (currentFilter !== 'all' && task.projectName !== currentFilter) return;
        
        // Determine which column to show the task in based on status
        let columnId = null;
        
        // Logic for new 4-column layout - prioritize actual status over planning
        if (task.actualStatus === 'done') {
            columnId = 'done-actual';
        } else if (task.actualStatus === 'in-progress') {
            columnId = 'in-progress-actual';
            console.log(`Task ${task.taskName} assigned to in-progress-actual`);
        } else if (task.planningStatus === 'in-progress') {
            columnId = 'in-progress-planned';
        } else if (task.planningStatus === 'today') {
            columnId = 'today-planned';
        }
        
        if (columnId) {
            const card = createTaskCard(task, columnId);
            const column = document.getElementById(columnId);
            if (column) {
                column.appendChild(card);
            } else {
                console.error(`Column not found: ${columnId}`);
            }
        } else {
            console.log(`No column found for task: ${task.taskName}, planning: ${task.planningStatus}, actual: ${task.actualStatus}`);
        }
    });
}

// Create task card element
function createTaskCard(task, columnType) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = task.id;
    card.dataset.columnType = columnType;
    
    const status = calculateTaskStatus(task);
    const isActualProgress = columnType === 'in-progress-actual';
    const isNoEdit = columnType === 'in-progress-planned';
    
    // Format date ranges
    const planDateRange = formatDateRange(task.planDateFrom, task.planDateTo);
    const actualDateRange = task.actualDateFrom ? formatDateRange(task.actualDateFrom, task.actualDateTo) : '';
    
    card.innerHTML = `
        <div class="task-card-header">
            <span class="task-status-icon ${status}"></span>
            <span class="task-name">${escapeHtml(task.taskName)}</span>
        </div>
        ${isActualProgress ? '<div class="task-badge">Actual Progress</div>' : ''}
        <div class="task-project">Project: ${task.projectName}</div>
        <div class="task-assignee">Assignee: ${getUserName(task.assignee)}</div>
        <div class="task-dates">
            Plan: ${planDateRange}
            ${actualDateRange ? `<br>Actual: ${actualDateRange}` : ''}
        </div>
        <div class="task-actions">
            <button class="btn btn-secondary" onclick="viewTaskHistory('${task.id}')">History</button>
            ${currentUser && currentUser.role === 'Tech Lead' && !isNoEdit ? 
                `<button class="btn btn-primary task-edit-btn" onclick="openEditTaskModal('${task.id}')">Edit</button>` : ''}
        </div>
    `;
    
    // Add no-edit class if it's the planned in-progress column
    if (isNoEdit) {
        card.classList.add('no-edit');
    }
    
    return card;
}

// Calculate task status color
function calculateTaskStatus(task) {
    if (task.priority === 'critical' || task.priority === 'blocked') {
        return 'red';
    }
    
    const now = new Date();
    const planDateTo = new Date(task.planDateTo || task.planDate);
    
    if (task.actualDateTo || task.actualDate) {
        const actualDate = new Date(task.actualDateTo || task.actualDate);
        const daysDiff = Math.floor((actualDate - planDateTo) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 0) return 'green';
        if (daysDiff <= 3) return 'yellow';
        return 'red';
    }
    
    // Not completed yet
    if (planDateTo < now && task.actualStatus !== 'done') {
        const daysDiff = Math.floor((now - planDateTo) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 3) return 'yellow';
        return 'red';
    }
    
    return 'green';
}

// Format date range
function formatDateRange(fromDate, toDate) {
    if (!fromDate) return '';
    
    const from = formatDate(fromDate);
    if (!toDate || fromDate === toDate) {
        return from;
    }
    
    return `${from} - ${formatDate(toDate)}`;
}

// Task Management
function openCreateTaskModal() {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        pendingAction = 'create-task';
        document.getElementById('passcodeModal').classList.add('show');
        return;
    }
    
    document.getElementById('createTaskModal').classList.add('show');
    populateAssigneeSelect('taskAssignee');
}

function closeCreateTaskModal() {
    document.getElementById('createTaskModal').classList.remove('show');
    clearTaskForm();
}

function clearTaskForm() {
    document.getElementById('taskProject').value = '';
    document.getElementById('taskName').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskAssignee').value = '';
    document.getElementById('taskPlanDateFrom').value = '';
    document.getElementById('taskPlanDateTo').value = '';
    document.getElementById('taskPlanningStatus').value = 'today';
    document.getElementById('taskActualStatus').value = 'today';
    document.getElementById('taskPriority').value = 'normal';
    document.getElementById('taskReason').value = '';
}

async function createTask() {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        showToast('Only Tech Lead can create tasks', 'error');
        return;
    }
    
    const taskData = {
        id: generateId(),
        projectName: document.getElementById('taskProject').value,
        taskName: document.getElementById('taskName').value,
        description: document.getElementById('taskDescription').value,
        assignee: parseInt(document.getElementById('taskAssignee').value),
        planDateFrom: document.getElementById('taskPlanDateFrom').value,
        planDateTo: document.getElementById('taskPlanDateTo').value,
        actualDateFrom: null,
        actualDateTo: null,
        planningStatus: document.getElementById('taskPlanningStatus').value,
        actualStatus: document.getElementById('taskActualStatus').value,
        priority: document.getElementById('taskPriority').value,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.id,
        updatedAt: new Date().toISOString()
    };
    
    const reason = document.getElementById('taskReason').value;
    
    // Validate
    if (!taskData.projectName || !taskData.taskName || !taskData.assignee || !taskData.planDateFrom || !taskData.planDateTo || !reason) {
        showToast('Please fill all required fields', 'error');
        return;
    }
    
    // Add to data
    appData.tasks.push(taskData);
    
    // Add to history
    logHistory(taskData.id, currentUser.id, 'created', null, reason);
    
    // Save
    await saveData(`Created task: ${taskData.taskName} by ${currentUser.name}`);
    
    // Update UI
    renderDashboard();
    renderKanban();
    renderHistory();
    closeCreateTaskModal();
    
    showToast('Task created successfully', 'success');
}

function openEditTaskModal(taskId) {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        pendingAction = `edit-task-${taskId}`;
        document.getElementById('passcodeModal').classList.add('show');
        return;
    }
    
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Populate form
    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskProject').value = task.projectName;
    document.getElementById('editTaskName').value = task.taskName;
    document.getElementById('editTaskDescription').value = task.description;
    document.getElementById('editTaskPlanDateFrom').value = task.planDateFrom || task.planDate || '';
    document.getElementById('editTaskPlanDateTo').value = task.planDateTo || task.planDate || '';
    document.getElementById('editTaskActualDateFrom').value = task.actualDateFrom || task.actualDate || '';
    document.getElementById('editTaskActualDateTo').value = task.actualDateTo || task.actualDate || '';
    document.getElementById('editTaskPlanningStatus').value = task.planningStatus;
    document.getElementById('editTaskActualStatus').value = task.actualStatus;
    document.getElementById('editTaskPriority').value = task.priority;
    
    populateAssigneeSelect('editTaskAssignee');
    document.getElementById('editTaskAssignee').value = task.assignee;
    
    document.getElementById('editTaskModal').classList.add('show');
}

function closeEditTaskModal() {
    document.getElementById('editTaskModal').classList.remove('show');
}

async function updateTask() {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        showToast('Only Tech Lead can update tasks', 'error');
        return;
    }
    
    const taskId = document.getElementById('editTaskId').value;
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const reason = document.getElementById('editTaskReason').value;
    if (!reason) {
        showToast('Please provide a reason for the update', 'error');
        return;
    }
    
    // Track changes
    const changes = [];
    const fields = [
        { id: 'editTaskProject', field: 'projectName', label: 'Project' },
        { id: 'editTaskName', field: 'taskName', label: 'Task Name' },
        { id: 'editTaskDescription', field: 'description', label: 'Description' },
        { id: 'editTaskAssignee', field: 'assignee', label: 'Assignee', type: 'number' },
        { id: 'editTaskPlanDateFrom', field: 'planDateFrom', label: 'Plan Date From' },
        { id: 'editTaskPlanDateTo', field: 'planDateTo', label: 'Plan Date To' },
        { id: 'editTaskActualDateFrom', field: 'actualDateFrom', label: 'Actual Date From' },
        { id: 'editTaskActualDateTo', field: 'actualDateTo', label: 'Actual Date To' },
        { id: 'editTaskPlanningStatus', field: 'planningStatus', label: 'Planning Status' },
        { id: 'editTaskActualStatus', field: 'actualStatus', label: 'Actual Status' },
        { id: 'editTaskPriority', field: 'priority', label: 'Priority' }
    ];
    
    fields.forEach(f => {
        let newValue = document.getElementById(f.id).value;
        if (f.type === 'number') newValue = parseInt(newValue);
        if (newValue === '') newValue = null;
        
        if (task[f.field] !== newValue) {
            changes.push({
                field: f.field,
                oldValue: task[f.field],
                newValue: newValue
            });
            task[f.field] = newValue;
        }
    });
    
    if (changes.length === 0) {
        showToast('No changes made', 'info');
        return;
    }
    
    // Update timestamp
    task.updatedAt = new Date().toISOString();
    
    // Log history for each change
    changes.forEach(change => {
        logHistory(taskId, currentUser.id, 'updated', change, reason);
    });
    
    // Save
    await saveData(`Updated task: ${task.taskName} - ${reason}`);
    
    // Update UI
    renderDashboard();
    renderKanban();
    renderHistory();
    closeEditTaskModal();
    
    showToast('Task updated successfully', 'success');
}

// Request Management
function openCreateRequestModal() {
    if (!currentUser) {
        showToast('Please select a user first', 'error');
        return;
    }
    
    // Populate task dropdown
    const select = document.getElementById('requestTask');
    select.innerHTML = '<option value="">None</option>';
    appData.tasks.forEach(task => {
        const option = document.createElement('option');
        option.value = task.id;
        option.textContent = `${task.projectName} - ${task.taskName}`;
        select.appendChild(option);
    });
    
    document.getElementById('createRequestModal').classList.add('show');
}

function closeCreateRequestModal() {
    document.getElementById('createRequestModal').classList.remove('show');
    clearRequestForm();
}

function clearRequestForm() {
    document.getElementById('requestType').value = '';
    document.getElementById('requestTask').value = '';
    document.getElementById('requestCustomerInfo').value = '';
    document.getElementById('requestDescription').value = '';
}

async function createRequest() {
    if (!currentUser) {
        showToast('Please select a user first', 'error');
        return;
    }
    
    const requestData = {
        id: generateId(),
        taskId: document.getElementById('requestTask').value || null,
        requestType: document.getElementById('requestType').value,
        requestedBy: currentUser.id,
        requestedAt: new Date().toISOString(),
        customerInfo: document.getElementById('requestCustomerInfo').value,
        description: document.getElementById('requestDescription').value,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null
    };
    
    // Validate
    if (!requestData.requestType || !requestData.customerInfo || !requestData.description) {
        showToast('Please fill all required fields', 'error');
        return;
    }
    
    // Add to data
    appData.requests.push(requestData);
    
    // Save
    await saveData(`New request from ${currentUser.name}: ${requestData.requestType}`);
    
    // Update UI
    renderDashboard();
    renderRequests();
    closeCreateRequestModal();
    
    showToast('Request submitted successfully', 'success');
}

function renderRequests() {
    if (!appData) return;
    
    const container = document.getElementById('requestsList');
    container.innerHTML = '';
    
    appData.requests.forEach(request => {
        const item = document.createElement('div');
        item.className = `request-item ${request.status}`;
        
        const requester = getUserName(request.requestedBy);
        const task = request.taskId ? appData.tasks.find(t => t.id === request.taskId) : null;
        
        item.innerHTML = `
            <div class="request-header">
                <span class="request-type">${formatRequestType(request.requestType)}</span>
                <span class="request-status ${request.status}">${request.status}</span>
            </div>
            <div class="request-info">
                Requested by ${requester} on ${formatDateTime(request.requestedAt)}
            </div>
            ${task ? `<div class="request-info">Related Task: ${task.taskName}</div>` : ''}
            <div class="request-info">Customer: ${escapeHtml(request.customerInfo)}</div>
            <div class="request-description">${escapeHtml(request.description)}</div>
            ${request.status === 'pending' && currentUser && currentUser.role === 'Tech Lead' ? `
                <div class="request-actions">
                    <button class="btn btn-primary" onclick="reviewRequest('${request.id}', 'approved')">Approve</button>
                    <button class="btn btn-secondary" onclick="reviewRequest('${request.id}', 'rejected')">Reject</button>
                </div>
            ` : ''}
            ${request.status !== 'pending' ? `
                <div class="request-info">
                    Reviewed by ${getUserName(request.reviewedBy)} on ${formatDateTime(request.reviewedAt)}
                    ${request.reviewNote ? `<br>Note: ${escapeHtml(request.reviewNote)}` : ''}
                </div>
            ` : ''}
        `;
        
        container.appendChild(item);
    });
}

async function reviewRequest(requestId, decision) {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        pendingAction = `review-${requestId}-${decision}`;
        document.getElementById('passcodeModal').classList.add('show');
        return;
    }
    
    const request = appData.requests.find(r => r.id === requestId);
    if (!request) return;
    
    const note = prompt('Add a note (optional):');
    
    request.status = decision;
    request.reviewedBy = currentUser.id;
    request.reviewedAt = new Date().toISOString();
    request.reviewNote = note;
    
    // Save
    await saveData(`Request ${decision} by ${currentUser.name}`);
    
    // Update UI
    renderDashboard();
    renderRequests();
    
    showToast(`Request ${decision}`, 'success');
}

// History Management
function logHistory(taskId, userId, action, changes, reason) {
    const entry = {
        id: generateId(),
        taskId: taskId,
        userId: userId,
        action: action,
        timestamp: new Date().toISOString(),
        changes: changes,
        reason: reason
    };
    
    appData.history.push(entry);
}

function renderHistory() {
    if (!appData) return;
    
    const container = document.getElementById('historyTable');
    
    // Create table
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Task</th>
                <th>Action</th>
                <th>Changes</th>
                <th>Reason</th>
            </tr>
        </thead>
        <tbody id="historyTableBody"></tbody>
    `;
    
    const tbody = table.querySelector('tbody');
    
    // Sort history by timestamp (newest first)
    const sortedHistory = [...appData.history].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    sortedHistory.forEach(entry => {
        const task = appData.tasks.find(t => t.id === entry.taskId);
        if (!task) return;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDateTime(entry.timestamp)}</td>
            <td>${getUserName(entry.userId)}</td>
            <td>${escapeHtml(task.taskName)}</td>
            <td>${entry.action}</td>
            <td>${formatChanges(entry.changes)}</td>
            <td>${escapeHtml(entry.reason || '')}</td>
        `;
        
        tbody.appendChild(row);
    });
    
    container.innerHTML = '';
    container.appendChild(table);
}

function filterHistory() {
    // TODO: Implement history filtering
    renderHistory();
}

function viewTaskHistory(taskId) {
    switchTab('history');
    // TODO: Filter history to show only this task
}

async function exportHistory() {
    const csv = convertHistoryToCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function convertHistoryToCSV() {
    const headers = ['Timestamp', 'User', 'Task', 'Action', 'Changes', 'Reason'];
    const rows = appData.history.map(entry => {
        const task = appData.tasks.find(t => t.id === entry.taskId);
        return [
            entry.timestamp,
            getUserName(entry.userId),
            task ? task.taskName : '',
            entry.action,
            JSON.stringify(entry.changes),
            entry.reason || ''
        ];
    });
    
    const csv = [headers, ...rows].map(row => 
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    return csv;
}

// Settings Management
function openSettings() {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        pendingAction = 'settings';
        document.getElementById('passcodeModal').classList.add('show');
        return;
    }
    
    // Load current settings
    const config = githubAPI.config;
    document.getElementById('githubOwner').value = config.owner || '';
    document.getElementById('githubRepo').value = config.repo || '';
    document.getElementById('githubBranch').value = config.branch || 'main';
    document.getElementById('githubToken').value = githubAPI.getToken() || '';
    
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('show');
}

async function testGitHubConnection() {
    const config = {
        owner: document.getElementById('githubOwner').value,
        repo: document.getElementById('githubRepo').value,
        branch: document.getElementById('githubBranch').value,
        token: document.getElementById('githubToken').value
    };
    
    if (!config.owner || !config.repo || !config.token) {
        showSettingsStatus('Please fill all fields', 'error');
        return;
    }
    
    showSettingsStatus('Testing connection...', 'info');
    
    // Temporarily save config
    githubAPI.config = config;
    
    try {
        const result = await githubAPI.testConnection();
        showSettingsStatus(`✅ Connected to ${result.owner}/${result.repo}`, 'success');
    } catch (error) {
        showSettingsStatus(`❌ Connection failed: ${error.message}`, 'error');
    }
}

async function saveSettings() {
    const config = {
        owner: document.getElementById('githubOwner').value,
        repo: document.getElementById('githubRepo').value,
        branch: document.getElementById('githubBranch').value,
        token: document.getElementById('githubToken').value
    };
    
    if (!config.owner || !config.repo || !config.token) {
        showSettingsStatus('Please fill all fields', 'error');
        return;
    }
    
    githubAPI.saveConfig(config);
    
    // Re-initialize
    const success = await githubAPI.initialize();
    if (success) {
        showSettingsStatus('Settings saved successfully', 'success');
        await loadData();
        closeSettings();
    } else {
        showSettingsStatus('Settings saved but connection failed', 'error');
    }
}

function showSettingsStatus(message, type) {
    const status = document.getElementById('settingsStatus');
    status.textContent = message;
    status.className = `settings-status ${type}`;
}

// Admin Authentication
function openPasscodeModal() {
    document.getElementById('passcodeModal').classList.add('show');
}

function closePasscodeModal() {
    document.getElementById('passcodeModal').classList.remove('show');
    document.getElementById('adminPasscode').value = '';
    document.getElementById('passcodeError').textContent = '';
    pendingAction = null;
}

function verifyPasscode() {
    const passcode = document.getElementById('adminPasscode').value;
    
    if (passcode === 'admin') {
        closePasscodeModal();
        
        // Set current user to Tech Lead
        currentUser = appData.users.find(u => u.role === 'Tech Lead');
        document.getElementById('userSelector').value = currentUser.id;
        localStorage.setItem('current-user', currentUser.id);
        updateUIForUser();
        
        // Execute pending action
        if (pendingAction) {
            if (pendingAction === 'create-task') {
                openCreateTaskModal();
            } else if (pendingAction === 'settings') {
                openSettings();
            } else if (pendingAction.startsWith('edit-task-')) {
                const taskId = pendingAction.replace('edit-task-', '');
                openEditTaskModal(taskId);
            } else if (pendingAction.startsWith('review-')) {
                const parts = pendingAction.split('-');
                reviewRequest(parts[1], parts[2]);
            }
            pendingAction = null;
        }
    } else {
        document.getElementById('passcodeError').textContent = 'Invalid passcode';
    }
}

// Export/Import Data
async function exportData() {
    githubAPI.exportData(appData);
    showToast('Data exported successfully', 'success');
}

async function importData(event) {
    if (!currentUser || currentUser.role !== 'Tech Lead') {
        showToast('Only Tech Lead can import data', 'error');
        return;
    }
    
    const file = event.target.files[0];
    if (!file) return;
    
    if (!confirm('This will replace all current data. Are you sure?')) {
        event.target.value = '';
        return;
    }
    
    try {
        const result = await githubAPI.importData(file);
        if (result.success) {
            await loadData();
            showToast('Data imported successfully', 'success');
        } else {
            showToast('Import failed - data saved locally', 'warning');
        }
    } catch (error) {
        showToast(`Import failed: ${error.message}`, 'error');
    }
    
    event.target.value = '';
}

// Utility Functions
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getUserName(userId) {
    const user = appData.users.find(u => u.id === userId);
    return user ? user.name : 'Unknown';
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatRequestType(type) {
    const types = {
        'change-deadline': 'Change Deadline',
        'add-task': 'Add Task',
        'customer-info': 'Customer Info',
        'other': 'Other'
    };
    return types[type] || type;
}

function formatChanges(changes) {
    if (!changes) return '';
    if (typeof changes === 'string') return changes;
    
    if (changes.field) {
        return `${changes.field}: ${changes.oldValue || 'empty'} → ${changes.newValue || 'empty'}`;
    }
    
    return JSON.stringify(changes);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function populateUserSelectors() {
    // Populate history filter
    const historySelect = document.getElementById('historyUserFilter');
    historySelect.innerHTML = '<option value="">All Users</option>';
    appData.users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.name} (${user.role})`;
        historySelect.appendChild(option);
    });
}

function populateAssigneeSelect(selectId) {
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Select Assignee</option>';
    appData.users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.name} (${user.role})`;
        select.appendChild(option);
    });
}

// Toast notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Loading overlay
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.add('show');
    } else {
        overlay.classList.remove('show');
    }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 'k':
                    e.preventDefault();
                    // Open search (TODO)
                    break;
                case 'n':
                    e.preventDefault();
                    if (currentUser && currentUser.role === 'Tech Lead') {
                        openCreateTaskModal();
                    }
                    break;
                case 'r':
                    e.preventDefault();
                    refreshData();
                    break;
            }
        }
    });
}

// Initial demo data
function getInitialTasks() {
    return [
        {
            id: "task-001",
            projectName: "3Sạch",
            taskName: "Lắp thiết bị cho The Tresor (3 AC + 3 đo điện)",
            description: "",
            assignee: 1,
            planDate: "2025-09-26",
            actualDate: "2025-09-26",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-20T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-26T15:30:00Z"
        },
        {
            id: "task-002",
            projectName: "3Sạch",
            taskName: "Lắp thiết bị đo 7 days health check cho De La Sol",
            description: "",
            assignee: 1,
            planDate: "2025-09-29",
            actualDate: null,
            planningStatus: "in-progress",
            actualStatus: "in-progress",
            priority: "normal",
            createdAt: "2025-09-23T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-28T09:00:00Z"
        },
        {
            id: "task-003",
            projectName: "Wincommerce",
            taskName: "Hoàn thành hợp đồng thợ F24",
            description: "Hợp đồng và phụ lục bản nháp",
            assignee: 1,
            planDate: "2025-09-25",
            actualDate: "2025-09-27",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-20T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-27T16:00:00Z"
        },
        {
            id: "task-004",
            projectName: "Wincommerce",
            taskName: "Soạn dự thảo yêu cầu sử dụng dịch vụ lắp đặt 30 CH WCM",
            description: "",
            assignee: 1,
            planDate: "2025-09-29",
            actualDate: null,
            planningStatus: "in-progress",
            actualStatus: "todo",
            priority: "normal",
            createdAt: "2025-09-23T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-28T14:00:00Z"
        },
        {
            id: "task-005",
            projectName: "Wincommerce",
            taskName: "Onboard thiết bị cho 30 CH WCM",
            description: "Dời từ 24-29/9 sang 30/9-2/10",
            assignee: 4,
            planDate: "2025-09-29",
            actualDate: "2025-10-02",
            planningStatus: "in-progress",
            actualStatus: "in-progress",
            priority: "normal",
            createdAt: "2025-09-20T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-27T10:00:00Z"
        },
        {
            id: "task-006",
            projectName: "Kingfoodmart",
            taskName: "Giao thiết bị cho Cô Giang",
            description: "Thiết bị đã có sẵn",
            assignee: 1,
            planDate: "2025-09-22",
            actualDate: "2025-09-22",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-20T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-22T17:00:00Z"
        },
        {
            id: "task-007",
            projectName: "Kingfoodmart",
            taskName: "Giao thiết bị cho PMH",
            description: "Thiết bị đã có sẵn",
            assignee: 1,
            planDate: "2025-09-24",
            actualDate: "2025-09-24",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-20T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-24T16:30:00Z"
        },
        {
            id: "task-008",
            projectName: "Kingfoodmart",
            taskName: "Giao thiết bị cho Hưng Phú - Lắp tủ mới",
            description: "",
            assignee: 6,
            planDate: "2025-09-25",
            actualDate: "2025-09-25",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-23T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-25T18:00:00Z"
        },
        {
            id: "task-009",
            projectName: "Kingfoodmart",
            taskName: "Giao thiết bị cho Phan Văn Hân - Lắp tủ mới",
            description: "",
            assignee: 6,
            planDate: "2025-09-26",
            actualDate: "2025-09-26",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-24T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-26T17:30:00Z"
        },
        {
            id: "task-010",
            projectName: "Kingfoodmart",
            taskName: "Giao thiết bị cho New City - Lắp tủ mới",
            description: "",
            assignee: 6,
            planDate: "2025-09-29",
            actualDate: null,
            planningStatus: "in-progress",
            actualStatus: "in-progress",
            priority: "normal",
            createdAt: "2025-09-25T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T08:00:00Z"
        },
        {
            id: "task-011",
            projectName: "Kingfoodmart",
            taskName: "Kiểm tra board mới giao từ SVHB cho New City",
            description: "",
            assignee: 7,
            planDate: "2025-09-29",
            actualDate: null,
            planningStatus: "in-progress",
            actualStatus: "in-progress",
            priority: "normal",
            createdAt: "2025-09-27T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T09:00:00Z"
        },
        {
            id: "task-012",
            projectName: "Maxidi",
            taskName: "Lắp đặt gói 7days healthcheck",
            description: "",
            assignee: 1,
            planDate: "2025-10-04",
            actualDate: null,
            planningStatus: "todo",
            actualStatus: "todo",
            priority: "normal",
            createdAt: "2025-09-27T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T10:00:00Z"
        },
        {
            id: "task-013",
            projectName: "Sản xuất",
            taskName: "Sản xuất 30 bộ AT controller từ SVHB",
            description: "",
            assignee: 1,
            planDate: "2025-09-27",
            actualDate: "2025-09-27",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-25T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-27T15:00:00Z"
        },
        {
            id: "task-014",
            projectName: "Sản xuất",
            taskName: "SVHB báo lỗi hiển thị LED và relay",
            description: "Phối hợp đo kiểm và dò khối bị lỗi",
            assignee: 7,
            planDate: "2025-09-29",
            actualDate: null,
            planningStatus: "in-progress",
            actualStatus: "in-progress",
            priority: "critical",
            createdAt: "2025-09-29T08:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T08:30:00Z"
        },
        {
            id: "task-015",
            projectName: "Sản xuất",
            taskName: "Order linh kiện cho tủ đo điện di động mẫu",
            description: "",
            assignee: 1,
            planDate: "2025-09-27",
            actualDate: "2025-09-27",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-26T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-27T14:00:00Z"
        },
        {
            id: "task-016",
            projectName: "Sản xuất",
            taskName: "Lắp tủ đo điện di động mẫu",
            description: "",
            assignee: 6,
            planDate: "2025-09-30",
            actualDate: null,
            planningStatus: "todo",
            actualStatus: "todo",
            priority: "normal",
            createdAt: "2025-09-29T09:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T09:00:00Z"
        },
        {
            id: "task-017",
            projectName: "Sản xuất",
            taskName: "Lắp 2 tủ đo điện di động cho Maxidi",
            description: "",
            assignee: 6,
            planDate: "2025-10-01",
            actualDate: null,
            planningStatus: "todo",
            actualStatus: "todo",
            priority: "normal",
            createdAt: "2025-09-29T09:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T09:00:00Z"
        },
        {
            id: "task-018",
            projectName: "Quy trình",
            taskName: "Gửi thông tin quy trình lắp, kiểm tra và bàn giao cho WCM và F24",
            description: "",
            assignee: 1,
            planDate: "2025-09-27",
            actualDate: "2025-09-27",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-25T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-27T16:00:00Z"
        },
        {
            id: "task-019",
            projectName: "Quy trình",
            taskName: "Cập nhật quy trình chung",
            description: "",
            assignee: 1,
            planDate: "2025-09-27",
            actualDate: "2025-09-27",
            planningStatus: "done",
            actualStatus: "done",
            priority: "normal",
            createdAt: "2025-09-26T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-27T17:00:00Z"
        },
        {
            id: "task-020",
            projectName: "Quy trình",
            taskName: "Cập nhật công cụ hỗ trợ request và gửi mail",
            description: "",
            assignee: 1,
            planDate: "2025-09-29",
            actualDate: null,
            planningStatus: "in-progress",
            actualStatus: "in-progress",
            priority: "normal",
            createdAt: "2025-09-27T10:00:00Z",
            createdBy: 1,
            updatedAt: "2025-09-29T10:00:00Z"
        }
    ];
}

// Make showToast globally available for github-api.js
window.showToast = showToast;

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);