const UserKnowledgeService = require('../../shared/user-knowledge-service');
const system = require('../../shared/system');
const renderHtml = require('../../shared/html-renderer');
const firestore = require('../../shared/firestore');

/**
 * Renders the knowledge list page with files and their records
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetAllKnowledge(req, res) {
  try {
    const userId = req.userId;
    const knowledgeService = UserKnowledgeService.forUser(userId);

    // Get all knowledge files
    const files = await knowledgeService.listFiles();

    const formatDate = (timestamp) => {
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Process each file to get its records
    const filesWithRecords = await Promise.all(files.map(async (file) => {
      const records = await knowledgeService.listRecords(file._id);

      // Format records HTML for this file
      const recordsHtml = records.length === 0 ?
        '<div class="no-records">No records in this file.</div>' :
        records.map(record => `
          <div class="record-item">
            <div class="record-header">
              <div class="record-date">Added: ${formatDate(record.createdAt)}</div>
              <a href="/backdoor/delete-record?userId=${userId}&fileId=${encodeURIComponent(file._id)}&recordId=${record._id}" class="delete-link">Delete</a>
            </div>
            <div class="record-content">${record.content}</div>
          </div>
        `).join('');

      return {
        ...file,
        recordsHtml
      };
    }));

    const template = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>KV2 - Knowledge Base</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1, h2, h3 { color: #333; }

          /* File Styling */
          .file-section {
            border: 1px solid #ddd;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 5px;
            background-color: #f9f9f9;
          }
          .file-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
          }
          .file-name {
            margin: 0;
            color: #2c3e50;
          }

          /* Record Styling */
          .record-item {
            border: 1px solid #ddd;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 5px;
            background-color: #fff;
          }
          .record-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
          }
          .record-date {
            color: #666;
            font-size: 14px;
          }
          .record-content {
            white-space: pre-wrap;
            margin-top: 10px;
          }

          /* Form Styling */
          .new-file-form, .new-record-form {
            background-color: #f0f0f0;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 20px;
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

          /* General Styling */
          .delete-link {
            color: #d9534f;
            text-decoration: none;
            font-size: 14px;
          }
          .delete-link:hover {
            text-decoration: underline;
          }
          .no-files, .no-records {
            padding: 20px;
            text-align: center;
            background-color: #f9f9f9;
            border-radius: 5px;
            color: #666;
            margin-bottom: 20px;
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
          .records-container {
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="nav-buttons">
          <a href="/backdoor/mailbox?userId={{userId}}" class="button">Back to Mailboxes</a>
          <a href="/backdoor/mail?userId={{userId}}" class="button">View All Emails</a>
        </div>

        <h1>Knowledge Base</h1>

        <!-- Create new file form -->
        <div class="new-file-form">
          <h2>Create New Knowledge File</h2>
          <form action="/backdoor/create-file" method="get">
            <input type="hidden" name="userId" value="{{userId}}">

            <div class="form-group">
              <label for="fileName">File Name:</label>
              <input type="text" id="fileName" name="fileName" required>
            </div>

            <button type="submit" class="submit-button">Create File</button>
          </form>
        </div>

        <!-- Display files and their records -->
        {{filesHtml}}

        <div class="nav-buttons">
          <a href="/backdoor/mailbox?userId={{userId}}" class="button">Back to Mailboxes</a>
          <a href="/backdoor/mail?userId={{userId}}" class="button">View All Emails</a>
        </div>
      </body>
      </html>
    `;
    
    const filesHtml = filesWithRecords.length === 0 ?
      '<div class="no-files">No knowledge files found.</div>' :
      filesWithRecords.map(file => `
        <div class="file-section" id="file-${file._id}">
          <div class="file-header">
            <h2 class="file-name">${file.name}</h2>
            <a href="/backdoor/delete-file?userId=${userId}&fileId=${encodeURIComponent(file._id)}" class="delete-link">Delete File</a>
          </div>

          <div class="records-container">
            ${file.recordsHtml}
          </div>

          <div class="new-record-form">
            <h3>Add New Record</h3>
            <form action="/backdoor/new-record" method="get">
              <input type="hidden" name="userId" value="${userId}">
              <input type="hidden" name="fileId" value="${file._id}">

              <div class="form-group">
                <label for="content-${file._id}">Content:</label>
                <textarea id="content-${file._id}" name="content" required></textarea>
              </div>

              <button type="submit" class="submit-button">Add Record</button>
            </form>
          </div>
        </div>
      `).join('');
    
    res.send(renderHtml(template, { userId, filesHtml }));
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleGetAllKnowledge' });
  }
}

/**
 * Handles creation of a new knowledge file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleCreateFile(req, res) {
  try {
    const { fileName, userId } = req.query;

    if (!fileName) {
      return res.status(400).send('Missing required parameter: fileName');
    }

    const knowledgeService = UserKnowledgeService.forUser(userId);
    await knowledgeService.createFile(fileName);

    // Redirect back to the knowledge page
    res.redirect(`/backdoor/knowledge?userId=${userId}`);
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleCreateFile' });
  }
}

/**
 * Handles deletion of a knowledge file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleDeleteFile(req, res) {
  try {
    const { fileId, userId } = req.query;

    if (!fileId) {
      return res.status(400).send('Missing required parameter: fileId');
    }

    const knowledgeService = UserKnowledgeService.forUser(userId);
    await knowledgeService.deleteFile(fileId);

    // Redirect back to the knowledge page
    res.redirect(`/backdoor/knowledge?userId=${userId}`);
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleDeleteFile' });
  }
}

/**
 * Handles creation of a new record in a file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleNewRecord(req, res) {
  try {
    const { fileId, content, userId } = req.query;

    if (!fileId) {
      return res.status(400).send('Missing required parameter: fileId');
    }
    if (!content) {
      return res.status(400).send('Missing required parameter: content');
    }

    const knowledgeService = UserKnowledgeService.forUser(userId);
    await knowledgeService.addRecord(fileId, content);

    // Redirect back to the knowledge page
    res.redirect(`/backdoor/knowledge?userId=${userId}#file-${encodeURIComponent(fileId)}`);
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleNewRecord' });
  }
}

/**
 * Handles deletion of a record from a file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleDeleteRecord(req, res) {
  try {
    const { fileId, recordId, userId } = req.query;

    if (!fileId) {
      return res.status(400).send('Missing required parameter: fileId');
    }
    if (!recordId) {
      return res.status(400).send('Missing required parameter: recordId');
    }

    const knowledgeService = UserKnowledgeService.forUser(userId);
    await knowledgeService.deleteRecord(fileId, recordId);

    // Redirect back to the knowledge page
    res.redirect(`/backdoor/knowledge?userId=${userId}#file-${fileId}`);
  } catch (error) {
    return system.handleError(res, 500, error, { endpoint: 'handleDeleteRecord' });
  }
}


module.exports = {
  handleGetAllKnowledge,
  handleCreateFile,
  handleDeleteFile,
  handleNewRecord,
  handleDeleteRecord
};
