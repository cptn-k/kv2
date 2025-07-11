const MailCacheService = require('./mail-cache-service');
const ContactsCacheService = require('./contacts-cache-service');
const TaskService = require('./task-service');


async function refreshCache(userId, callbacks) {
  await TaskService.create(userId)
    .then(t => t.getTaskLists(true));
  
  await ContactsCacheService.create(userId)
    .then(s =>  s.updateContacts());
  
  await MailCacheService.create(userId)
    .then(s => s.importNewEmails()
      .then(() => s.supplySummaries()));
}


module.exports = {
  refreshCache
};