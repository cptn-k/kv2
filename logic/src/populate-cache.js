/**
 * Cache Populator
 *
 * This script retrieves and caches data from each user's accounts:
 * 1. Emails from inboxes (first 400 messages)
 * 2. Contacts from Google Contacts
 *
 * This helps in pre-populating the cache for faster access during regular application usage.
 *
 * Usage: node logic/src/populate-cache.js <userId>
 */

const MailCacheService = require('./shared/mail-cache-service');
const ContactsCacheService = require('./shared/contacts-cache-service');
const TaskService = require('./shared/task-service');


// Get userId from command line arguments
const userId = process.argv[2];
if (!userId) {
  console.error('Usage: node populate-cache.js <userId>');
  process.exit(1);
}


function main() {
  // TaskService.create(userId)
  //   .then(t => t.getTaskLists(true))
  //   .then(lists => {
  //     console.log("Task Lists Done.");
  //   });
  //
  // const willDoContacts = ContactsCacheService.create(userId)
  //   .then(s =>  s.updateContacts()
  //     .then(() => console.log("Contacts Done.")))
  //   .catch(error => {
  //     console.error('Contacts cache update failed:', error);
  //   });

  const willDoContacts = Promise.resolve();
  
  const willDoMails = willDoContacts.then(() => MailCacheService.create(userId))
    .then(s => s.importNewEmails()
      //.then(() => s.resetSummarizationQueue())
      .then(() => s.rescore())
      //.then(() => s.supplySummaries())
      .then(() => console.log("Mails Done.")))
    .catch(error => {
      console.error('Mail cache update failed:', error);
    });
  
  willDoMails.then(() => {
    console.log("All Done.");
  });
}


main();