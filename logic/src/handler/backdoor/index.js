const rulesHandler = require('./rules-handler');
const knowledgeHandler = require('./knowledge-handler');
const backdoor = require('./backdoor-handler');
const { resolveUserIdMiddleware } = require('../middleware');
const {db} = require('../../shared/firestore');

/**
 * Configures and exports the backdoor routes
 * @param {Object} app - Express app instance
 */
function setupBackdoorRoutes(app) {
  app.get('/backdoor/accounts', backdoor.handleGetAccounts);
  app.get('/backdoor/delete-account', backdoor.handleDeleteAccount);
  app.get('/backdoor/mailbox', backdoor.handleGetMailboxes);
  app.get('/backdoor/mailbox/:id', backdoor.handleGetMail);
  app.get('/backdoor/mail', backdoor.handleGetAllMail);
  app.get('/backdoor/mail/:id', backdoor.handleViewEmailById);
  app.get('/backdoor/delete-email', backdoor.handleDeleteEmail);
  app.get('/backdoor/junk-email', backdoor.handleJunkEmail);
  app.get('/backdoor/archive-email', backdoor.handleArchiveEmail);
  app.get('/backdoor/task', backdoor.handleGetAllTasks);
  app.get('/backdoor/task/:id', backdoor.handleGetTask);
  app.get('/backdoor/new-task', backdoor.handleGetNewTask);
  app.get('/backdoor/sms', backdoor.handleSmsLink);
  
  // Apply middleware to all backdoor routes
  app.use(['/backdoor/rule', '/backdoor/delete-rule', '/backdoor/new-rule'], resolveUserIdMiddleware);
  app.use(['/backdoor/knowledge', '/backdoor/delete-knowledge', '/backdoor/new-knowledge'], resolveUserIdMiddleware);

  // Rules endpoints
  app.get('/backdoor/rule', rulesHandler.handleGetAllRules);
  app.get('/backdoor/delete-rule', rulesHandler.handleDeleteRule);
  app.get('/backdoor/new-rule', rulesHandler.handleNewRule);

  // Knowledge endpoints
  app.get('/backdoor/knowledge', knowledgeHandler.handleGetAllKnowledge);
  app.get('/backdoor/delete-file', knowledgeHandler.handleDeleteFile);
  app.get('/backdoor/create-file', knowledgeHandler.handleCreateFile);
  app.get('/backdoor/new-record', knowledgeHandler.handleNewRecord);
  app.get('/backdoor/delete-record', knowledgeHandler.handleDeleteRecord);
  
  
}

module.exports = { setupBackdoorRoutes };
