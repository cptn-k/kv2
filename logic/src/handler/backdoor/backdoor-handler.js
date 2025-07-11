const userService = require('../../shared/user-service');
const system = require('../../shared/system');
const secretService = require('../../shared/secret-service');
const GoogleDriver = require('../../shared/google-driver');
const Slack = require('../../shared/slack-driver');
const ClickUpAuthDriver = require('../../shared/clickup-auth-driver');
const TaskService = require('../../shared/task-service');
const MailService = require('../../shared/mail-service');
const MailCacheService = require("../../shared/mail-cache-service");
const md = require('markdown-it')();


async function getGoogleDriver() {
  const clientId = await secretService.getGoogleClientId();
  const clientSecret = await secretService.getGoogleClientSecret();

  return new GoogleDriver(clientId, clientSecret);
}


async function getSlackDriver() {
  const clientId = await secretService.getSlackClientId();
  const clientSecret = await secretService.getSlackClientSecret();
  const botToken = await secretService.getSlackBotToken();

  return Slack.create(botToken, clientId, clientSecret);
}


  // Common CSS theme for all pages
  const commonCss = `
  /* Base styles */
  body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.5; color: #333; }
  .token {
    display: inline-block;
    padding: 2px 12px;
    margin: 2px 4px;
    border-radius: 15px;
    background-color: var(--neutral-light);
    border: 1px solid var(--border-color);
    font-size: 0.9em;
  }
  .action-items {
    list-style-type: disc;
    margin: 5px 0 10px 20px;
    padding: 0;
  }
  .action-items li {
    margin: 5px 0;
  }
  h1, h2, h3, h4, h5 { color: #333; margin-top: 1.2em; margin-bottom: 0.5em; }
  p { margin: 0.5em 0; }
  pre { white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }

  /* Color scheme */
  :root {
    --primary-color: #4285f4;
    --primary-light: #e8f0fe;
    --primary-dark: #1a73e8;
    --secondary-color: #34a853;
    --secondary-light: #e6f4ea;
    --accent-color: #fbbc05;
    --accent-light: #fef7e0;
    --danger-color: #d93025;
    --danger-light: #fde0dc;
    --neutral-color: #5f6368;
    --neutral-light: #f5f5f5;
    --neutral-medium: #e1e1e1;
    --neutral-dark: #666;
    --border-color: #ddd;
  }

  /* Card and container styles */
  .card, .account-item, .email-item, .task-item, .space-item, .folder-item, .list-item {
    border: 1px solid var(--border-color);
    padding: 15px;
    margin-bottom: 15px;
    border-radius: 5px;
    background-color: white;
  }

  .space-item { border-color: var(--primary-color); background-color: var(--primary-light); }
  .folder-item { border-color: var(--secondary-color); background-color: var(--secondary-light); }
  .list-item { border-color: var(--accent-color); background-color: var(--accent-light); }

  .account-item:nth-child(odd), .email-item:nth-child(odd) { background-color: #f9f9f9; }
  .account-item:nth-child(even), .email-item:nth-child(even) { background-color: #f5f5f5; }

  .hierarchy-item { margin-left: 20px; border-left: 1px solid var(--border-color); padding-left: 15px; }

  /* Action areas */
  .account-actions, .task-actions, .email-actions, .nav-buttons, .actions { margin-top: 10px; }

  /* Button styles */
  .button, button, input[type="submit"] {
    display: inline-block;
    padding: 8px 12px;
    background-color: var(--primary-color);
    color: white;
    text-decoration: none;
    border-radius: 4px;
    margin-right: 10px;
    border: none;
    cursor: pointer;
    font-size: 14px;
  }

  .button:hover, button:hover { background-color: var(--primary-dark); }
  .button.danger, button.danger, .delete-button { background-color: var(--danger-color); }

  button[disabled] { opacity: 0.5; cursor: not-allowed; }

  /* Form styles */
  .form-container, form {
    background-color: var(--neutral-light);
    padding: 20px;
    margin-bottom: 20px;
    border-radius: 5px;
  }

  .form-group { margin-bottom: 15px; }

  label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
  }

  input[type="text"], textarea, select {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    box-sizing: border-box;
  }

  textarea { height: 100px; }

  /* Special containers */
  .no-data-message, .no-accounts {
    padding: 20px;
    background-color: var(--neutral-light);
    border-radius: 5px;
    color: var(--neutral-dark);
    text-align: center;
    margin: 20px 0;
  }

  .section, .new-account-section {
    margin-top: 30px;
    padding: 15px;
    border-top: 1px solid var(--border-color);
  }

  /* Tag and label styles */
  .label, .tag, .account-tag {
    display: inline-block;
    padding: 3px 8px;
    margin-right: 5px;
    border-radius: 15px;
    font-size: 12px;
    background-color: var(--neutral-medium);
  }

  .account-tag {
    background-color: var(--primary-light);
    color: var(--primary-dark);
  }
  `;

async function generateListPage(accounts, userId) {
  let googleDriver = await getGoogleDriver();
  let slackAuthUrl = (await getSlackDriver()).getAuthUrl(userId);

  const clickUpDriver = new ClickUpAuthDriver(
    await secretService.getClickUpClientId(),
    await secretService.getClickUpClientSecret(),
    `${system.getBaseUrl()}/clickup/auth/callback`);

  let clickUpAuthUrl = clickUpDriver.getAuthUrl(userId);

  const hasSlackAccount = await userService.getSlackAccount(userId) !== null;


  const accountsHtml = Object.entries(accounts).map(entry => {
    const account = entry[1];
    const id = entry[0];
    
    return `<div class="account-item">
        <h3>Account (${id})</h3>
        <p>Created: ${new Date(account.createdAt).toLocaleString()}</p>
        <p>Updated: ${new Date(account.updatedAt || account.createdAt).toLocaleString()}</p>
        ${account.type ? `<p>Type: ${account.type}</p>` : ''}
        ${account.email ? `<p>Email: ${account.email}</p>` : ''}
        ${account.userId ? `<p>User ID: ${account.userId}</p>` : ''}
        <div class="account-actions">
          ${account.type === 'google' ?
      
      `<button onclick="window.location.href='${googleDriver.getAuthUrl(userId, id)}'">Reauthenticate Google</button>` :
      account.type === 'clickup' ?
        `<button onclick="window.location.href='${clickUpAuthUrl}'">Reauthenticate ClickUp</button>` :
        `<button onclick="window.location.href='/backdoor/account/reauth?userId=${userId}&accountId=${id}'">Reauthenticate</button>`
    }

      <button class="danger" onclick="window.location.href='/backdoor/delete-account?userId=${userId}&accountId=${id}'">Delete Account</button>
        </div>
      </div>`
  }).join('');

  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>KV2 - Account Management</title>
        <style>${commonCss}</style>
      </head>
      <body>
        <h1>Account Management</h1>
        <p>User ID: ${userId} (
        <a href="/backdoor/mailbox?userId=${userId}">Mailboxes</a> |
        <a href="/backdoor/mail?userId=${userId}">All Mail</a> |
        <a href="/backdoor/task?userId=${userId}">Tasks</a> |
        <a href="/backdoor/knowledge?userId=${userId}">Knowledge</a> |
        <a href="/backdoor/rule?userId=${userId}">Rules</a> )</p>

        <h2>Accounts</h2>
        ${Object.keys(accounts).length > 0 ? accountsHtml : '<div class="no-data-message">No accounts found for this user.</div>'}

        <div class="new-account-section">
          <h2>Add New Account</h2>
          <button onclick="window.location.href='${slackAuthUrl}'" ${hasSlackAccount ? 'disabled' : ''}>
            ${hasSlackAccount ? 'Slack Account Already Linked' : 'Link Slack Account'}
          </button>
          <button onclick="window.location.href='${await (await getGoogleDriver()).getAuthUrl(userId)}'">Add Google Account</button>
          <button onclick="window.location.href='${clickUpAuthUrl}'">Add ClickUp Account</button>
        </div>
      </body>
      </html>
    `;
}


const handleGetAccounts = async (req, res) => {
  const {userId, slackId} = req.query;
  let resolvedUserId = userId;
  
  if (!userId && !slackId) {
    throw system.mkError('Missing required parameter: either userId or slackId is required');
  }

  if (slackId && !userId) {
    resolvedUserId = await userService.getUserBySlackId(slackId);
  }

  const accounts = await userService.getUserAccounts(resolvedUserId);
  const html = await generateListPage(accounts, resolvedUserId);
  res.send(html);
};


/**
 * Resolves user ID from request parameters (either userId or slackId)
 * @param {Object} req - Express request object
 * @returns {Promise<string>} Resolved user ID
 * @throws {Error} If neither userId nor slackId is provided, or if user is not found
 */
async function resolveUserId(req) {
  const { userId, slackId } = req.query;

  if (!userId && !slackId) {
    throw system.mkError('Missing required parameter: either userId or slackId is required');
  }

  if (userId) {
    return userId;
  }

  return await userService.getUserBySlackId(slackId);
}


const handleDeleteAccount = async (req, res) => {
  const {userId, accountId} = req.query;

  if (!userId || !accountId) {
    throw system.mkError('Missing required parameters: userId and accountId');
  }

  await userService.removeUserAccount(userId, accountId);
  res.redirect('/backdoor/accounts?userId=' + userId + '&deleted=true');
};

/**
 * Handles the deletion of an email
 * @param {Object} req - Express request object with emailId query parameter
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleDeleteEmail = async (req, res) => {
  const {emailId, userId} = req.query;
  
  if (!emailId || !userId) {
    return system.handleError(res, 400, system.mkError('Missing required parameters: emailId and userId'));
  }
  
  try {
    const mailService = await MailService.create(userId);
    const mail = await mailService.get(emailId);
    await mailService.moveToTrash(emailId);
    res.send(`🗑  Email "${mail.title}" has been moved to trash.`);
  } catch (error) {
    system.logError('Failed to delete email', error, { emailId });
    return system.handleError(res, 500, error, { emailId });
  }
};

/**
 * Handles marking an email as junk/spam
 * @param {Object} req - Express request object with emailId query parameter
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleJunkEmail = async (req, res) => {
  const {emailId, userId} = req.query;
  
  if (!emailId || !userId) {
    return system.handleError(res, 400, system.mkError('Missing required parameters: emailId and userId'));
  }
  
  try {
    const mailService = await MailService.create(userId);
    const mail = await mailService.get(emailId);
    await mailService.moveToJunk(emailId);
    res.send(`🛑  Email "${mail.title}" has been moved to junk.`);
  } catch (error) {
    system.logError('Failed to mark email as junk', error, { emailId });
    return system.handleError(res, 500, error, { emailId });
  }
};

/**
 * Handles archiving an email (removing it from inbox)
 * @param {Object} req - Express request object with emailId query parameter
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleArchiveEmail = async (req, res) => {
  const {emailId, userId} = req.query;

  if (!emailId || !userId) {
    return system.handleError(res, 400, system.mkError('Missing required parameters: emailId and userId'));
  }

  try {
    const mailService = await MailService.create(userId);
    const mail = await mailService.get(emailId);
    await mailService.archive(emailId);
    res.send(`📦  Email "${mail.title}" has been archived.`);
  } catch (error) {
    system.logError('Failed to archive email', error, { emailId });
    return system.handleError(res, 500, error, { emailId });
  }
};


/**
 * Returns a list of mailboxes (email accounts) for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleGetMailboxes = async (req, res) => {
  const userId = await resolveUserId(req);
  const mailService = await MailService.create(userId);
  const accounts = await mailService.getAccounts();

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>KV2 - Mailboxes</title>
      <style>${commonCss}</style>
    </head>
    <body>
      <h1>Email Accounts</h1>
      <p>User ID: ${userId}</p>

      ${accounts.length > 0 ? 
        accounts.map(account => `
          <div class="account-item">
            <h2>${account.email}</h2>
            <p>Account ID: ${account.id}</p>
            <div class="account-actions">
              <a href="/backdoor/mailbox/${account.id}?userId=${userId}" class="button">View Emails</a>
            </div>
          </div>
        `).join('') : 
        '<div class="no-data-message">No email accounts found for this user. Add a Google account to access emails.</div>'
      }

      <div class="nav-buttons">
        <a href="/backdoor/accounts?userId=${userId}" class="button">Manage Accounts</a>
        <a href="/backdoor/mail?userId=${userId}" class="button">View All Emails</a>
      </div>
    </body>
    </html>
  `;

  res.send(html);
};


/**
 * Returns emails from a specific mailbox
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleGetMail = async (req, res) => {
  const userId = await resolveUserId(req);
  const accountId = req.params.id;

  if (!accountId) {
    throw system.mkError('Missing required parameter: accountId');
  }

  const mailService = await MailService.create(userId);
  let emailIds = await mailService.getMail(accountId);

    if (emailIds.length === 0) {
      return res.send(`
        <html lang="en">
          <head>
            <title>KV2 - Empty Mailbox</title>
            <style>${commonCss}</style>
          </head>
          <body>
            <h1>Empty Mailbox</h1>
            <div class="no-data-message">No emails found in this mailbox.</div>
            <div class="nav-buttons">
              <a href="/backdoor/mailbox?userId=${userId}" class="button">Back to Mailboxes</a>
            </div>
          </body>
        </html>
      `);
    }

    const accounts = await mailService.getAccounts();
    const currentAccount = accounts.find(acc => acc.id === accountId) || { email: 'Unknown Account' };

    // Process first 20 emails with full details
    const firstBatch = emailIds.slice(0, 20);
    const fullDetailEmails = await Promise.all(
      firstBatch.map(async (id) => {
        return await mailService.get(id);
      })
    );

    // Process remaining emails (up to 300 more) with limited details
    const secondBatch = emailIds.slice(20, 320);
    const limitedDetailEmails = await Promise.all(
      secondBatch.map(async (id) => {
        const email = await mailService.getBrief(id);
        return {
          title: email.title,
          date: email.date,
          from: email.from,
          id: id
        };
      })
    );

    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      return date.toLocaleString();
    };

    const formatEmailAddress = (address) => {
      if (!address) return 'Unknown';

      // Simple formatting for email addresses
      if (address.includes('<') && address.includes('>')) {
        const match = address.match(/(.*)<(.+)>/);
        if (match) {
          const [_, name, email] = match;
          return `${name.trim()} &lt;${email.trim()}&gt;`;
        }
      }
      return address;
    };

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>KV2 - Mailbox: ${currentAccount.email}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1, h2 { color: #333; }
          .email-item {
            border: 1px solid #ddd;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 5px;
          }
          .email-item:nth-child(odd) {
            background-color: #f9f9f9;
          }
          .email-item:nth-child(even) {
            background-color: #f5f5f5;
          }
          .email-header {
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
          }
          .email-title {
            font-size: 18px;
            font-weight: bold;
            margin: 0 0 5px 0;
          }
          .email-meta {
            color: #666;
            font-size: 14px;
            margin: 3px 0;
          }
          .email-body {
            max-height: 300px;
            overflow-y: auto;
            padding: 10px;
            background-color: white;
            border-radius: 4px;
            margin-top: 10px;
          }
          .limited-details {
            background-color: #f0f0f0;
            padding: 15px;
            border-radius: 5px;
            margin-top: 30px;
          }
          .limited-email {
            padding: 8px;
            margin-bottom: 8px;
            border-bottom: 1px solid #ddd;
          }
          .limited-email:last-child {
            border-bottom: none;
          }
          .nav-buttons {
            margin: 20px 0;
          }
          .button {
            display: inline-block;
            padding: 8px 12px;
            background-color: #4285f4;
            color: white;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
          }
        </style>
      </head>
      <body>
        <div class="nav-buttons">
          <a href="/backdoor/mailbox?userId=${userId}" class="button">Back to Mailboxes</a>
          <a href="/backdoor/mail?userId=${userId}" class="button">View All Emails</a>
        </div>

        <h1>Emails in ${currentAccount.email}</h1>
        <p>Showing ${emailIds.length} emails (${fullDetailEmails.filter(Boolean).length} with full details)</p>

        <!-- Full Detail Emails -->
        ${fullDetailEmails.filter(Boolean).map(email => `
          <div class="email-item">
            <div class="email-header">
              <h2 class="email-title">${email.title || 'No Subject'}</h2>
              <p class="email-meta"><strong>From:</strong> ${formatEmailAddress(email.from)}</p>
              <p class="email-meta"><strong>Date:</strong> ${formatDate(email.date)}</p>
              ${email.to ? `<p class="email-meta"><strong>To:</strong> ${formatEmailAddress(email.to)}</p>` : ''}
              ${email.cc ? `<p class="email-meta"><strong>CC:</strong> ${formatEmailAddress(email.cc)}</p>` : ''}
            </div>
            <div class="email-body">
              ${md.render(email.autoSummary)}
            </div>
          </div>
        `).join('')}

        <!-- Limited Detail Emails -->
        ${limitedDetailEmails.filter(Boolean).length > 0 ? `
          <div class="limited-details">
            <h2>Additional Emails (Limited Details)</h2>
            ${limitedDetailEmails.filter(Boolean).map(email => `
              <div class="limited-email">
                <strong>${email.title || 'No Subject'}</strong><br>
                <span>From: ${formatEmailAddress(email.from)}</span><br>
                <span>Date: ${formatDate(email.date)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="nav-buttons">
          <a href="/backdoor/mailbox?userId=${userId}" class="button">Back to Mailboxes</a>
          <a href="/backdoor/mail?userId=${userId}" class="button">View All Emails</a>
        </div>
      </body>
      </html>
    `;

    res.send(html);
};


/**
 * Returns emails from all mailboxes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleGetAllMail = async (req, res) => {
  const userId = await resolveUserId(req);
  const sortBy = req.query.sortBy || 'importance';

  const mailCacheService = await MailCacheService.create(userId);

  // Get email IDs based on sort parameter
  let emailIds = [];
  if (sortBy === 'importance') {
    emailIds = await mailCacheService.getInbox();
  } else { // 'purgeable'
    emailIds = await mailCacheService.getDeletables();
  }

  // Limit to 400 emails
  emailIds = emailIds.slice(0, 400);

  // Get email details
  const emails = await Promise.all(
    emailIds.map(async (id) => {
      try {
        return await mailCacheService.get(id);
      } catch (error) {
        system.logError('Failed to retrieve email', error, { emailId: id });
        return null;
      }
    })
  );
  
  
  
  const filteredEmails = emails.filter(Boolean);

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>KV2 - All Emails (${sortBy === 'importance' ? 'Important' : 'Purgeable'})</title>
      <style>${commonCss}
        .email-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
        }
        .email-table th {
          background-color: var(--primary-light);
          color: var(--primary-dark);
          text-align: left;
          padding: 10px;
          position: sticky;
          top: 0;
        }
        .email-table td {
          padding: 8px;
          border-bottom: 1px solid var(--border-color);
        }
        .email-table tr:hover {
          background-color: var(--neutral-light);
        }
        .toggle-button {
          display: block;
          margin: 20px 0;
          padding: 10px 15px;
          background-color: var(--primary-color);
          color: white;
          text-decoration: none;
          border-radius: 4px;
          text-align: center;
          font-weight: bold;
        }
        .score {
          text-align: center;
          font-weight: bold;
        }
        .action-buttons {
          display: flex;
          gap: 5px;
        }
        .action-buttons .button {
          padding: 5px 8px;
          margin: 0;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <h1>All Emails (${sortBy === 'importance' ? 'Important' : 'Purgeable'})</h1>
      <p>User ID: ${userId}</p>

      <a href="/backdoor/mail?userId=${userId}&sortBy=${sortBy === 'importance' ? 'purgeable' : 'importance'}" class="toggle-button">
        Switch to ${sortBy === 'importance' ? 'Purgeable' : 'Important'} View
      </a>

      ${filteredEmails.length > 0 ? `
        <table class="email-table">
          <thead>
            <tr>
              <th>Sender</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Importance</th>
              <th>Purgeable</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filteredEmails.map(email => `
              <tr>
                <td>${email.from ? email.from.replace(/<.*>/, '').trim() : 'Unknown'}</td>
                <td>${email.title || 'No Subject'}</td>
                <td class="score">${email.priorityScore !== undefined ? email.priorityScore.toFixed(2) : 'N/A'}</td>
                <td class="score">${email.importanceScore !== undefined ? email.importanceScore.toFixed(2) : 'N/A'}</td>
                <td class="score">${email.deletableScore !== undefined ? email.deletableScore.toFixed(2) : 'N/A'}</td>
                <td>
                  <div class="action-buttons">
                    <a href="/backdoor/mail/${encodeURIComponent(email._id)}?userId=${userId}" class="button">View</a>
                    <a href="/backdoor/delete-email?emailId=${encodeURIComponent(email._id)}&userId=${userId}" class="button danger">Delete</a>
                    <a href="/backdoor/archive-mail?emailId=${encodeURIComponent(email._id)}&userId=${userId}" class="button">Archive</a>
                    <a href="/backdoor/junk-email?emailId=${encodeURIComponent(email._id)}&userId=${userId}" class="button danger">Junk</a>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : `
        <div class="no-data-message">No emails found.</div>
      `}

      <a href="/backdoor/mail?userId=${userId}&sortBy=${sortBy === 'importance' ? 'purgeable' : 'importance'}" class="toggle-button">
        Switch to ${sortBy === 'importance' ? 'Purgeable' : 'Important'} View
      </a>
    </body>
    </html>
  `;

  res.send(html);
};

/**
 * Returns a list of all tasks from ClickUp with options to view details or delete
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleGetAllTasks = async (req, res) => {
  const userId = await resolveUserId(req);
  
  const taskService = await TaskService.create(userId);
  
  const teams = await taskService.getWorkspaces();
  if (!teams || teams.length === 0) {
    throw system.mkError('No ClickUp teams found for user');
  }
  const team = teams[0];
  
  // Get tasks assigned to current user
  system.logInfo("Getting tasks assigned to user: " + userId);
  const assignedTasks = await taskService.getOwnTasks(team.id);

  system.logInfo("Getting tasks in team: " + team.id);
  const tasks = await taskService.getAllTasks(team.id);
  system.logInfo("Tasks", {tasks});
  
  // Group tasks by space, folder and list
  const spaces = [];
  const spacesMap = new Map();
  
  tasks.forEach(task => {
    const spaceName = task.space?.name || 'No Space';
    const folderName = task.folder?.name;
    const listName = task.list?.name || 'No List';
    
    let space = spacesMap.get(spaceName);
    if (!space) {
      space = {
        id: task.space?.id || 'none',
        name: spaceName,
        folders: new Map(),
        lists: []
      };
      spacesMap.set(spaceName, space);
      spaces.push(space);
    }
    
    if (folderName) {
      let folder = space.folders.get(folderName);
      if (!folder) {
        folder = {
          id: task.folder.id,
          name: folderName,
          lists: []
        };
        space.folders.set(folderName, folder);
      }
      
      let list = folder.lists.find(l => l.id === task.list.id);
      if (!list) {
        list = {
          id: task.list.id,
          name: listName,
          tasks: []
        };
        folder.lists.push(list);
      }
      list.tasks.push(task);
    } else {
      let list = space.lists.find(l => l.id === task.list.id);
      if (!list) {
        list = {
          id: task.list.id,
          name: listName,
          tasks: []
        };
        space.lists.push(list);
      }
      list.tasks.push(task);
    }
  });
  
  // Convert Maps to arrays for easier template handling
  spaces.forEach(space => {
    space.folders = Array.from(space.folders.values());
  });
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>KV2 - ClickUp Tasks</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1, h2 { color: #333; }
        .hierarchy-item {
          margin-left: 20px;
          border-left: 1px solid #ddd;
          padding-left: 15px;
        }
        .space-item {
          border: 1px solid #4285f4;
          padding: 15px;
          margin-bottom: 15px;
          border-radius: 5px;
          background-color: #e8f0fe;
        }
        .folder-item {
          border: 1px solid #34a853;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          background-color: #e6f4ea;
        }
        .list-item {
          border: 1px solid #fbbc05;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          background-color: #fef7e0;
        }
        .task-item {
          border: 1px solid #ddd;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          background-color: #f9f9f9;
        }
        .assigned-tasks {
          background-color: #e8f5e9;
          padding: 20px;
          margin-bottom: 30px;
          border-radius: 5px;
          border: 1px solid #81c784;
        }
        .task-actions { margin-top: 10px; }
        .label {
          display: inline-block;
          padding: 3px 8px;
          margin-right: 5px;
          border-radius: 3px;
          font-size: 12px;
          background-color: #e1e1e1;
        }
        .form-container {
          background-color: #f0f0f0;
          padding: 20px;
          margin-bottom: 30px;
          border-radius: 5px;
        }
        .form-group {
          margin-bottom: 15px;
        }
        label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }
        input[type="text"], textarea, select {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-sizing: border-box;
        }
        textarea {
          height: 100px;
        }
        button {
          background-color: #4285f4;
          color: white;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
        }
        a.button {
          display: inline-block;
          padding: 5px 10px;
          background-color: #4285f4;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin-right: 10px;
          font-size: 14px;
        }
        a.delete-button {
          background-color: #d93025;
        }
      </style>
    </head>
    <body>
      <h1>ClickUp Tasks</h1>
      <p>User ID: ${userId}</p>

      <div class="assigned-tasks">
        <h2>Tasks Assigned to Me</h2>
        ${assignedTasks.length > 0 ? assignedTasks.map(task => `
          <div class="task-item">
            <div>${task.name}</div>
            <div class="task-actions">
              <a href="/backdoor/task/${task.id}?userId=${userId}" class="button">View Details</a>
              <a href="/backdoor/task/${task.id}?userId=${userId}&delete=true" class="button delete-button">Delete</a>
            </div>
          </div>
        `).join('') : '<p>No tasks assigned to you</p>'}
      </div>

      <div class="form-container">
        <h2>Create New Task</h2>
        <form action="/backdoor/new-task" method="GET">
          <input type="hidden" name="userId" value="${userId}">

          <div class="form-group">
            <label for="title">Task Title</label>
            <input type="text" id="title" name="title" required>
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" name="description"></textarea>
          </div>

          <div class="form-group">
            <label for="list">List ID</label>
            <input type="text" id="list" name="list" required>
          </div>

          <div class="form-group">
            <label for="priority">Priority</label>
            <select id="priority" name="priority">
              <option value="1">Urgent</option>
              <option value="2">High</option>
              <option value="3" selected>Normal</option>
              <option value="4">Low</option>
            </select>
          </div>

          <div class="form-group">
            <label for="tags">Tags (comma separated)</label>
            <input type="text" id="tags" name="tags">
          </div>

          <button type="submit">Create Task</button>
        </form>
      </div>
      
      <div class="spaces-container">
        <h2>Spaces</h2>
        ${spaces.map(space => `
          <div class="space-item">
            <h3>${space.name} (ID: ${space.id})</h3>

            ${space.folders.map(folder => `
              <div class="folder-item hierarchy-item">
                <h4>${folder.name} (ID: ${folder.id})</h4>
                ${folder.lists.map(list => `
                  <div class="list-item hierarchy-item">
                    <h5>${list.name} (ID: ${list.id})</h5>
                    ${list.tasks.map(task => `
                      <div class="task-item hierarchy-item">
                        <div>${task.name} (ID: ${task.id})</div>
                        <div class="task-actions">
                          <a href="/backdoor/task/${task.id}?userId=${userId}" class="button">View Details</a>
                          <a href="/backdoor/task/${task.id}?userId=${userId}&delete=true" class="button delete-button">Delete</a>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                `).join('')}
              </div>
            `).join('')}

            ${space.lists.map(list => `
              <div class="list-item hierarchy-item">
                <h5>${list.name} (ID: ${list.id})</h5>
                ${list.tasks.map(task => `
                  <div class="task-item hierarchy-item">
                    <div>${task.name}</div>
                    <div class="task-actions">
                      <a href="/backdoor/task/${task.id}?userId=${userId}" class="button">View Details</a>
                      <a href="/backdoor/task/${task.id}?userId=${userId}&delete=true" class="button delete-button">Delete</a>
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </body>
    </html>
  `;
  
  res.send(html);
};

const handleGetNewTask = async (req, res) => {
  const { userId, title, description, list, priority, tags } = req.query;
  if (!userId || !title || !list) {
    throw system.mkError('Missing required parameters: userId, title, and list are required');
  }

  const taskService = await TaskService.create(userId);

  const taskData = {
    list_id: list,
    name: title,
    description: description || '',
    priority: priority ? parseInt(priority) : 3
  };

  // Add tags if provided
  if (tags) {
    taskData.tags = tags.split(',').map(tag => tag.trim()).filter(Boolean);
  }

  const newTask = await taskService.createTask(list, taskData);

  // Redirect to the task details page
  res.redirect(`/backdoor/task/${newTask.id}?userId=${userId}`);
}

/**
 * Displays task details or deletes a task and shows the deleted task details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleGetTask = async (req, res) => {
  const userId = await resolveUserId(req);
  const taskId = req.params.id;
  const shouldDelete = req.query.delete === 'true';

  if (!taskId) {
    throw system.mkError('Missing required parameter: taskId');
  }

  const taskService = await TaskService.create(userId);
  let task;
  let deletedMessage = '';

  // Delete the task if requested
  if (shouldDelete) {
    task = await taskService.getTaskDetails(taskId);
    await taskService.deleteTask(taskId);
    deletedMessage = `<div style="padding: 15px; background-color: #fde0dc; border-radius: 5px; margin-bottom: 20px;">
      <h3 style="color: #d93025; margin-top: 0;">Task Deleted</h3>
      <p>The task "${task.name}" has been successfully deleted.</p>
    </div>`;
  } else {
    task = await taskService.getTaskDetails(taskId);
  }

  if (!task) {
    throw system.mkError('Task not found', { taskId });
  }
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>KV2 - Task Details</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1, h2 { color: #333; }
        .task-container {
          background-color: #f9f9f9;
          border: 1px solid #ddd;
          padding: 20px;
          border-radius: 5px;
        }
        .task-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 1px solid #eee;
        }
        .task-title {
          margin: 0;
          font-size: 24px;
        }
        .task-status {
          padding: 5px 10px;
          border-radius: 15px;
          font-size: 14px;
          font-weight: bold;
        }
        .task-metadata {
          margin-bottom: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 10px;
        }
        .meta-item {
          background-color: #f0f0f0;
          padding: 10px;
          border-radius: 4px;
        }
        .meta-label {
          font-weight: bold;
          margin-bottom: 5px;
        }
        .label {
          display: inline-block;
          padding: 3px 8px;
          margin-right: 5px;
          border-radius: 3px;
          font-size: 12px;
          background-color: #e1e1e1;
        }
        .description {
          background-color: white;
          padding: 15px;
          border-radius: 4px;
          border: 1px solid #eee;
          margin-top: 20px;
          white-space: pre-line;
        }
        .button {
          display: inline-block;
          padding: 8px 15px;
          background-color: #4285f4;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      ${deletedMessage}

      <h1>Task Details</h1>
      <p><a href="/backdoor/task?userId=${userId}" class="button">Back to Tasks</a></p>

      <div class="task-container">
        <div class="task-header">
          <h2 class="task-title">${task.name}</h2>
          <span class="task-status"><a href="${task.url}">Open in ClickUp</a></span>
          <span class="task-status" style="background-color: ${task.status?.color || '#e1e1e1'}">
            ${task.status || 'No Status'}
          </span>
        </div>

        <div class="task-metadata">
          <div class="meta-item">
            <div class="meta-label">Project</div>
            <div>${task.project_id || 'None'}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Folder</div>
            <div>${task.folder_id || 'None'}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">List</div>
            <div>${task.list_id || 'None'}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Priority</div>
            <div>${task.priority || 'None'}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Created</div>
            <div>${task.date_created.toLocaleString()}</div>
          </div>

          <div class="meta-item">
            <div class="meta-label">Due Date</div>
            <div>${task.due_date ? task.due_date.toLocaleString() : 'None'}</div>
          </div>
        </div>

        ${task.tags && task.tags.length > 0 ? 
          `<div class="meta-item" style="margin-top: 10px;">
            <div class="meta-label">Tags</div>
            <div>
              ${task.tags.map(tag => 
                `<span class="label" style="background-color: ${tag.tag_fg || '#e1e1e1'}">${tag.name}</span>`
              ).join(' ')}
            </div>
          </div>` : ''
        }

        <h3>Description</h3>
        <div class="description">${task.description || 'No description provided.'}</div>

        ${task.assignees && task.assignees.length > 0 ? 
          `<h3>Assignees</h3>
          <div>
            ${task.assignees.map(assignee => 
              `<div>${assignee.username || assignee.email || 'Unknown user'}</div>`
            ).join('')}
          </div>` : ''
        }
      </div>

      <p><a href="/backdoor/task?userId=${userId}" class="button">Back to Tasks</a></p>
    </body>
    </html>
  `;

  res.send(html);
};



function handleSmsLink(req, res) {
  const {number, body} = req.query;
  
  if (!number || !body) {
    throw system.mkError('Missing required parameters: number and body');
  }
  
  res.redirect(`sms:${number}?body=${encodeURIComponent(body)}`);
}


/**
 * Helper function to display a single email by ID
 * @param {string} emailId - The email ID to retrieve
 * @param {string} userId - The user ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function handleViewSingleEmail(emailId, userId, res) {
  try {
    const mailService = await MailService.create(userId);
    const email = await mailService.get(emailId);

    if (!email) {
      return res.status(404).send(`
        <html lang="en">
          <head>
            <title>Email Not Found</title>
            <style>${commonCss}</style>
          </head>
          <body>
            <h1 style="color: var(--danger-color);">Email Not Found</h1>
            <div class="no-data-message">The requested email could not be found.</div>
            <div class="nav-buttons">
              <a class="button" href="/backdoor/mail?userId=${userId}">View All Emails</a>
            </div>
          </body>
        </html>
      `);
    }

    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      return date.toISOString();
    };

    const formatEmailAddress = (address) => {
      if (!address) return 'Unknown';
      if (typeof address !== 'string') return 'Invalid Address';
      
      if (address.includes('<') && address.includes('>')) {
        const match = address.match(/(.*?)\s*<(.+?)>/);
        if (match) {
          const [_, name, email] = match;
          return `${name.trim() || email.trim()} &lt;${email.trim()}&gt;`;
        }
      }
      return address.trim();
    };

    
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email: ${email.title || 'No Subject'}</title>
        <style>
          ${commonCss}
          .container { max-width: 800px; margin: 0 auto; }
          .email-header { background-color: var(--neutral-light); padding: 20px 15px; border-radius: 5px; margin: 10px 0 20px 0; }
          .email-meta { margin: 5px 0; color: var(--neutral-dark); }
          .text-content { white-space: pre-wrap; background-color: white; padding: 15px; border-radius: 5px; border: 1px solid var(--border-color); }
          .summary { background-color: var(--secondary-light); padding: 15px; border-radius: 5px; margin: 20px 0; }

          @media screen and (max-width: 480px) {
            body { font-size: 16px; }
            h1 { font-size: 24px; }
            h3 { font-size: 20px; }
            .email-meta { font-size: 16px; }
            .text-content { font-size: 16px; }
            .button { font-size: 16px; padding: 10px 20px; display: block; margin-bottom: 10px; text-align: center; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="actions">
            <a href="${mailService.getLink(emailId)}" class="button" target="_blank">Open in Gmail</a>
            <a href="/backdoor/archive-mail?emailId=${encodeURIComponent(emailId)}&userId=${userId}" class="button">Archive</a>
            <a href="/backdoor/delete-email?emailId=${encodeURIComponent(emailId)}&userId=${userId}" class="button danger">Delete</a>
            <a href="/backdoor/junk-email?emailId=${encodeURIComponent(emailId)}&userId=${userId}" class="button danger">Mark as Junk</a>
          </div>

          <div class="email-header">
            <h1 style="margin-top: 0">${email.title || email.subject || 'No Subject'}</h1>
            <p class="email-meta"><strong>Cached ID:</strong> ${email._id || emailId}</p>
            <p class="email-meta"><strong>From:</strong> ${formatEmailAddress(email.from || email.sender)}</p>
            <p class="email-meta"><strong>Date:</strong> ${formatDate(email.date)}</p>
            ${email.to ? `<p class="email-meta"><strong>To:</strong> ${formatEmailAddress(email.to)}</p>` : ''}
            ${email.cc ? `<p class="email-meta"><strong>CC:</strong> ${formatEmailAddress(email.cc)}</p>` : ''}
          </div>

          <div class="summary">
            ${email.category ? `
              <p><strong>Category:</strong> ${email.category}</p>
            ` : ''}
            ${email.sentiment ? `<p><strong>Sentiment:</strong> ${email.sentiment}</p>` : ''}
            ${email.actionItems && email.actionItems.length > 0 ? `
              <p><strong>Action Items:</strong></p>
              <ul class="action-items">
                ${email.actionItems.map(item => `<li>${item}</li>`).join('')}
              </ul>
            ` : ''}
            ${email.deadline ? `<p><strong>Deadline:</strong> ${formatDate(email.deadline)}</p>` : ''}
            ${email.keyPeople ? `
              <p><strong>Key People:</strong> 
                ${email.keyPeople.map(person => `<span class="token">${person}</span>`).join('')}
              </p>
            ` : ''}
            ${email.labels ? `
              <p><strong>Labels:</strong> 
                ${email.labels.map(label => `<span class="token">${label}</span>`).join('')}
              </p>
            ` : ''}
            
            
            <p><strong>Scores:</strong> 
                ${email.priorityScore !== undefined ?
      `<span class="token">Priority: ${email.priorityScore.toFixed(2)}${email.priorityLabel ? ` (${email.priorityLabel})` : ''}</span>` : ''}
                ${email.importanceScore !== undefined ?
      `<span class="token">Importance: ${email.importanceScore.toFixed(2)}</span>` : ''}
                ${email.urgencyScore !== undefined ?
      `<span class="token">Urgency: ${email.urgencyScore.toFixed(2)}</span>` : ''}
                ${email.deletableScore !== undefined ?
      `<span class="token">Purgeable: ${email.deletableScore.toFixed(2)}</span>` : ''}
            </p>
          </div>

          ${email.autoSummary || email.shortSummary ? `
            <div class="summary">
              ${email.shortSummary ? `
                <h3>Short Summary</h3>
                ${md.render(email.shortSummary)}
              ` : ''}
              ${email.autoSummary ? `
                <h3>Extended Summary</h3>
                ${md.render(email.autoSummary)}
              ` : ''}
            </div>
          ` : ''}
          
          <div class="text-content">
            <h3>Email Content</h3>
            <pre>${email.textBody ? email.textBody.replace(/[<>]/g, c => ({
      '<': '&lt;',
      '>': '&gt;'
    })[c]) : 'No text content available'}</pre>
          </div>

          <div class="actions">
            <a href="/backdoor/mail?userId=${userId}" class="button">Back to All Emails</a>
          </div>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    system.logError('Failed to retrieve email', error, { emailId, userId });
    return system.handleError(res, 500, error, { route: '/backdoor/mail', emailId });
  }
}

/**
 * Handles viewing a specific email by ID using path parameter
 * @param {Object} req - Express request object with id path parameter
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleViewEmailById = async (req, res) => {
  try {
    const userId = await resolveUserId(req);
    const emailId = req.params.id;

    if (!emailId) {
      return system.handleError(res, 400, system.mkError('Missing required parameter: id'));
    }

    return await handleViewSingleEmail(emailId, userId, res);
  } catch (error) {
    system.logError('Failed to retrieve email', error, { emailId: req.params.id, userId: req.query.userId });
    return system.handleError(res, 500, error, { route: '/backdoor/mail/:id' });
  }
};

module.exports = {
  handleGetAccounts,
  handleDeleteAccount,
  handleGetAllTasks,
  handleGetTask,
  handleGetMailboxes,
  handleGetMail,
  handleGetAllMail,
  handleGetNewTask,
  handleSmsLink,
  handleDeleteEmail,
  handleJunkEmail,
  handleViewEmailById,
  handleArchiveEmail
};
