const MailService = require('../../shared/mail-service');
const system = require('../../shared/system');
const renderHtml = require('../../shared/html-renderer');

/**
 * Renders the mail rules list page with form to add new rules
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetAllRules(req, res) {
  try {
    const userId = req.userId;
    const mailService = await MailService.create(userId);
    const rules = await mailService.listRules();

    const rulesList = rules.length === 0 ?
      '<div class="no-rules">No mail rules created yet.</div>' :
      rules.map(rule => `
        <div class="rule-item">
          <div class="rule-header">
            <div class="rule-title">Sender: ${rule.senderEmail}</div>
            <a href="/backdoor/delete-rule?userId=${userId}&ruleId=${encodeURIComponent(rule._id)}" class="delete-link">Delete</a>
          </div>
          <div class="rule-action">
            <strong>Action:</strong> ${rule.action}
          </div>
          <div class="rule-flags">
            <strong>Options:</strong> 
            ${rule.flags.postToSlack ? 'Post to Slack' : ''}
            ${rule.flags.postToSlack && (rule.flags.includeMorningSummary || rule.flags.autoRespond) ? ' | ' : ''}
            ${rule.flags.includeMorningSummary ? 'Include in Morning Summary' : ''}
            ${rule.flags.includeMorningSummary && rule.flags.autoRespond ? ' | ' : ''}
            ${rule.flags.autoRespond ? 'Auto-Respond' : ''}
            ${!rule.flags.postToSlack && !rule.flags.includeMorningSummary && !rule.flags.autoRespond ? 'None' : ''}
          </div>
        </div>
      `).join('');

    const template = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>KV2 - Mail Rules</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          .rule-item {
            border: 1px solid #ddd;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 5px;
            background-color: #f9f9f9;
          }
          .rule-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
          }
          .rule-title {
            font-size: 18px;
            font-weight: bold;
          }
          .rule-action {
            margin-top: 10px;
            color: #555;
          }
          .rule-flags {
            margin-top: 10px;
            font-size: 14px;
          }
          .delete-link {
            color: #d9534f;
            text-decoration: none;
            font-size: 14px;
          }
          .delete-link:hover {
            text-decoration: underline;
          }
          .new-rule-form {
            background-color: #f0f0f0;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 30px;
          }
          .form-group {
            margin-bottom: 15px;
          }
          label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
          }
          input[type="text"], textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
          }
          textarea {
            min-height: 100px;
          }
          .checkbox-group {
            margin-top: 5px;
          }
          .checkbox-label {
            font-weight: normal;
            display: inline-block;
            margin-right: 15px;
          }
          .submit-button {
            background-color: #4285f4;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
          }
          .submit-button:hover {
            background-color: #3b78e7;
          }
          .no-rules {
            padding: 20px;
            text-align: center;
            background-color: #f9f9f9;
            border-radius: 5px;
            color: #666;
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
          <a href="/backdoor/mailbox?userId={{userId}}" class="button">Back to Mailboxes</a>
          <a href="/backdoor/mail?userId={{userId}}" class="button">View All Emails</a>
        </div>

        <h1>Mail Rules</h1>

        <div class="new-rule-form">
          <h2>Add New Rule</h2>
          <form action="/backdoor/new-rule" method="get">
            <input type="hidden" name="userId" value="{{userId}}">

            <div class="form-group">
              <label for="senderEmail">Sender Email (contains):</label>
              <input type="text" id="senderEmail" name="senderEmail" required>
            </div>

            <div class="form-group">
              <label for="action">Action Description:</label>
              <textarea id="action" name="action" required></textarea>
            </div>

            <div class="form-group">
              <label>Options:</label>
              <div class="checkbox-group">
                <label class="checkbox-label">
                  <input type="checkbox" name="postToSlack" value="true"> Post to Slack
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" name="includeMorningSummary" value="true"> Include in Morning Summary
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" name="autoRespond" value="true"> Auto-Respond
                </label>
              </div>
            </div>

            <button type="submit" class="submit-button">Create Rule</button>
          </form>
        </div>

        {{rulesList}}

        <div class="nav-buttons">
          <a href="/backdoor/mailbox?userId={{userId}}" class="button">Back to Mailboxes</a>
          <a href="/backdoor/mail?userId={{userId}}" class="button">View All Emails</a>
        </div>
      </body>
      </html>
    `;

    res.send(renderHtml(template, { userId, rulesList }));
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleGetAllRules' });
  }
}

/**
 * Handles deletion of a mail rule
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleDeleteRule(req, res) {
  try {
    const userId = req.userId;
    const ruleId = req.query.ruleId;

    if (!ruleId) {
      return res.status(400).send('Missing required parameter: ruleId');
    }

    const mailService = await MailService.create(userId);
    await mailService.deleteRule(ruleId);

    // Redirect back to the rules page
    res.redirect(`/backdoor/rule?userId=${userId}`);
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleDeleteRule' });
  }
}

/**
 * Handles creation of a new mail rule
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleNewRule(req, res) {
  try {
    const userId = req.userId;
    const { senderEmail, action, postToSlack, includeMorningSummary, autoRespond } = req.query;

    if (!senderEmail || !action) {
      return res.status(400).send('Missing required parameters: senderEmail and action are required');
    }

    const mailService = await MailService.create(userId);

    const flags = {
      postToSlack: postToSlack === 'true',
      includeMorningSummary: includeMorningSummary === 'true',
      autoRespond: autoRespond === 'true'
    };

    await mailService.createRule(senderEmail, action, flags);

    // Redirect back to the rules page
    res.redirect(`/backdoor/rule?userId=${userId}`);
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleNewRule' });
  }
}

module.exports = {
  handleGetAllRules,
  handleDeleteRule,
  handleNewRule
};
