/**
 * Chat Service
 *
 * Handles processing of chat messages and interactions with language models
 * for various messaging platforms like Slack.
 */

const Slack = require('./slack-driver');
const fastq = require('fastq');
const LanguageModelService = require('./language-model-service');
const userService = require('./user-service');
const system = require('./system');
const secretService = require("./secret-service");
const firestore = require('./firestore');
const NodeCache = require('node-cache');
const MailService = require("./mail-service");
const TaskService = require("./task-service");
const CalendarService = require("./calendar-service");
const CacheService = require("./cache-service");
const MailCacheService = require("./mail-cache-service");

/**
 * Formats a date in RFC 2822 format
 * @param {Date|number|string} date - Date to format
 * @param {string} [timezone='America/Los_Angeles'] - Timezone to use
 * @returns {string} Formatted date string in RFC 2822 format
 */
function formatRFC2822Date(date, timezone = 'America/Los_Angeles') {
  if (!date) return 'None';
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}

// Cache for language model instances with 30min TTL
const llmTTL = 1800;
const lmCache = new NodeCache({
  stdTTL: llmTTL,
  checkperiod: 600,
  deleteOnExpire: (key, value) => {
    system.logInfo('Language model cache item expired', {key});
  }
});


// To track repeat submission of same event.
const recentEventTimestamps = new NodeCache({stdTTL: 300});

// Cache for Slack client instance
let slackClientInstance = null;


/**
 * Single message queue for processing all messages
 */
const messageQueue = fastq(async (job, cb) => {
  system.logInfo('Processing message', job.event);
  try {
    await processQueuedJob(job.event);
  } catch (error) {
    system.logError('Failed to process queued event', error, job.event);
  }
  cb();
}, 1);


async function processQueuedJob(event) {
  if (event.text && event.text.match(/@\S+\s+\^account/)) {
    await processAccountCommand(event);
  } else {
    await processQueuedEvent(event);
  }
}


async function processAccountCommand(event) {
  const slackClient = await getSlackClient();
  await slackClient.postMessage(event.channel,
    "_Account command is not implemented_", event.thread_ts || event.ts);
}


/**
 * Saves the action in the Firestore collection `k2o-chat`.
 *
 * @param {string} ts - A unique timestamp to identify the action.
 * @param {string} name - The name of the action.
 * @param {Object} params - The parameters of the action.
 * @returns {Promise<void>} Resolves when data is successfully written.
 */
const bookAction = (ts, name, params) => firestore
  .write('k2o-chat', `action#${ts}`, {
      ts,
      name,
      params: Object.fromEntries(
        Object.entries(params).filter(([_, v]) => v != null)
      ),
      createdAt: Date.now()
    })
  .then(() => system.logInfo("Action booked", {name, params}))


/**
 * Retrieves the action booked with the given timestamp from Firestore.
 *
 * @returns {Promise<Object|null>} The action data if it exists, or null if not found.
 * @param event
 */
async function triggerAction(event) {
  const data = await firestore.read('k2o-chat', `action#${event.item.ts}`);
  if(!data) {
    system.logInfo("Ignoring reaction. No relevant action is booked.", event);
    return;
  }
  
  let userId = await userService.getUserBySlackId(event.user);
  if (!userId) {
    throw new Error(`User not found for Slack ID: ${event.user}`);
  }
  
  const params = data.params;
  
  switch (data.name) {
    case 'sendMail':
      const mailer = await MailService.create(userId);
      await mailer.sendMail(params.account, params.to, params.subject,
        params.body, params.inResponseTo, params.cc, params.replyToAll)
      break;
    case 'createTask': {
        const service = await TaskService.create(userId);
        await service.createTask(params.listId, {
          name: params.title,
          description: params.description,
          priority: params.priority,
          due_date: params.due,
          due_date_time: (params.due % 86400000) !== 0,
        })
      }
      break;
    case 'deleteTask': {
        const service = await TaskService.create(userId);
        await service.deleteTask(params.id);
      }
      break;
    case 'createEvent': {
      const service = await CalendarService.create(userId);
      
      const startTime = new Date(params.start);
      const endTime = new Date(startTime.getTime() + params.duration * 60000);
      
      const p = {
        summary: params.title,
        start: {
          dateTime: startTime,
          timeZone: 'UTC'
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'UTC'
        },
          location: params.location,
          description: params.description
        };
        system.logInfo("Creating event", p);
        await service.createEvent(params.accountId, p);
      }
      break;
    case 'refreshCache': {
      const callbacks = new Callbacks(event.item.channel, event.item.ts, userId);
      await CacheService.refreshCache(params.userId, callbacks);
      break;
    }
    default:
      system.logError("Unknown action type", null, data);
  }
  
  slackClientInstance.addReaction(event.item.channel, 'raised_hands', event.item.ts)
    .catch(e => system.logError('Failed to add \'raised_hands\' reaction', e, event));
  
  system.logInfo("Action triggered", {...data});
}


class Callbacks {
  constructor(channel, threadTs, userId) {
    this._channel = channel;
    this._threadTs = threadTs;
    this._userId = userId;
  }
  
  _post(message) {
    return getSlackClient()
      .then(client => client.postMessage(this._channel, message, this._threadTs))
      .then(response => response.ts)
      .catch(e => system.logError("Error posting message on slack", e,
        {message, chanel: this._channel, ts: this._threadTs}));
  }
  
  info(message) {
    this._post(`_${message}_`);
  }
  
  async sendMail(account, to, subject, body, inResponseTo, cc, replyToAll) {
    const mailService = await MailService.create(this._userId);
    const address = mailService.getAddressForAccount(account);
    const mail = inResponseTo ? await mailService.get(inResponseTo) : null;
    const content = "📤 _E-Mail ready. React :thumbsup: to send_\n\n"
      + "*" + subject + "*\n\n"
      + "*To:* " + to + "\n\n"
      + (cc ? "*CC:* " + JSON.stringify(cc) + "\n\n" : "")
      + (replyToAll ? "*Reply-To-All:* Enabled\n\n" : "")
      + (inResponseTo ? `*In response to:* ${mail.title} (ID: ${mail.messageId}) \n\n` : '')
      + "*Account:* " + (address?address:`Invalid (${account})`) + "\n\n"
      + "```" + body + "```";
    
    this._post(content).then(ts => bookAction(ts, 'sendMail',
      {account, to, subject, body, inResponseTo, cc, replyToAll}));
  }
  
  async createTask(taskList, title, description, priority, due, labels) {
    const taskService = await TaskService.create(this._userId);
    let taskListName;

    try {
      const taskLists = await taskService.getTaskLists();
      const matchedList = taskLists.find(list => list.id === taskList);
      taskListName = matchedList ? matchedList.name : `Unknown (${taskList})`;
    } catch (error) {
      taskListName = `Invalid (${taskList})`;
    }

    const content = "📌 _Task ready. React:thumbsup: to create._\n\n"
      + "*" + title + "*\n\n"
      + "*Description:* " + description + "\n\n"
      + "*Due:* " + formatRFC2822Date(due) + "\n\n"
      + "*Priority:* " + priority + "\n\n"
      + (labels ? "*Labels:* " + labels + "\n\n" : "")
      + "*List:* " + taskListName;
    
    this._post(content).then(ts => bookAction(ts,
      'createTask', {title, description, due, priority, labels, listId: taskList}));
  }
  
  async deleteTask(id) {
    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);
    
    const content = "_React :thumbsup: to confirm delete._\n\n"
      + "🗑️ Task: " + task.name;
    
    const ts = await this._post(content);
    await bookAction(ts, 'deleteTask', {id});
  }
  
  // TODO move out of this scope
  _formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }
  
  async createEvent(accountId, title, start, duration, description, location) {
    const mailService = await MailService.create(this._userId);
    const address = mailService.getAddressForAccount(accountId);

    const content = "📅 _Event ready. React :thumbsup: to create._\n\n"
      + "*" + title + "*\n\n"
      + "*Start:* " + formatRFC2822Date(new Date(start)) + "\n\n"
      + "*Duration:* " + this._formatDuration(duration) + "\n\n"
      + "*Description:* " + description + "\n\n"
      + "*Location:* " + location + "\n\n"
      + "*Account:* " + (address ? address : `Invalid (${accountId})`);
    
    system.logInfo('Creating event content', {content});
    
    const ts = await this._post(content)
    await bookAction(ts, 'createEvent',
      {accountId, title, start, duration, description, location});
  }
  
  async sendSms(to, message) {
    const encodedMessage = encodeURIComponent(message);
    await this._post(`<${system.getBaseUrl()}/backdoor/sms?number=${to}&body=${encodedMessage}|Send "${message}" to ${to}>`);
  }
  
  async refreshCache(userId) {
    const ts = await this._post("React :thumbsup: to refresh cache.");
    await bookAction(ts, 'refreshCache', {userId});
  }
}


/**
 * Removes Slack mention patterns from text
 * @param {string} text - The text to sanitize
 * @returns {string} Sanitized text with mention patterns removed
 */
function sanitizeSlackText(text) {
  return text ? text.replace(/<@[A-Za-z0-9]+>/g, '').trim() : text;
}

async function processQueuedEvent(event) {
  let userId = await userService.getUserBySlackId(event.user);
  if (!userId) {
    userId = await userService.createUser(event.user);
  }
  
  const slackClient = await getSlackClient();
  
  const threadTs = event.thread_ts || event.ts;
  const cacheKey = `lm#${threadTs}`;
  
  let lm = lmCache.get(cacheKey);
  
  if (!lm) {
    const callbacks = new Callbacks(event.channel, threadTs, userId);
    lm = await LanguageModelService.create(userId, `slack#${threadTs}`, callbacks);
    lmCache.set(cacheKey, lm);
  } else {
    lmCache.ttl(cacheKey, llmTTL);
  }
  
  const hasContext = await lm.contextExists();
  
  if (!hasContext) {
    system.logInfo("Ignoring event with no prior context.", {threadTs});
    return;
  }
  
  let imageUrl = null;
  
  if (event.files) {
    const destination = await slackClient.downloadFile(event.files[0]);
    imageUrl = system.getBaseUrl() + "/image/" + destination;
  }
  
  const sanitizedText = sanitizeSlackText(event.text);
  
  let lmReply;
  try {
    lmReply = await lm.sendMessage(sanitizedText, imageUrl);
  } catch (error) {
    system.logError('Failed to process message with language model', error);
    lmReply = "💥 " + error.message;
  }
  
  if (lmReply.includes('DONE')) {
    slackClient.addReaction(event.channel, 'ok_hand', event.ts)
      .catch(e => system.logError('Failed to add \'ok_hand\' reaction', e, event));
    return;
  }
  
  const idPref = userId.substring(0, 8);
  if(lmReply.includes('mail-')) {
    const mailService = await MailCacheService.create(userId);
    lmReply = lmReply.replace(
      new RegExp(`(?:ID:\\s*)?mail-g([a-zA-Z0-9]+)-([a-zA-Z0-9]+)`, 'g'), (match, accountId, messageId) => {
        const encodedId = encodeURIComponent(mailService.composeId('google_' + accountId, messageId));
        const encodedUserId = encodeURIComponent(userId);
        const encodedAccountId = encodeURIComponent(accountId);
        const mailLink = system.getBaseUrl() + '/backdoor/mail/' + encodedId + '?userId=' + encodedUserId + '&accountId=' + encodedAccountId;
        const deleteLink = system.getBaseUrl() + '/backdoor/delete-email?emailId=' + encodedId + '&userId=' + encodedUserId + '&accountId=' + encodedAccountId;
        const archiveLink = system.getBaseUrl() + '/backdoor/archive-email?emailId=' + encodedId + '&userId=' + encodedUserId + '&accountId=' + encodedAccountId;
        return `📧 (<${mailLink}|View> | <${deleteLink}|Delete> | <${archiveLink}|Archive>)`;
      });
  }
  
  await slackClient.postMessage(event.channel, lmReply, threadTs);
}


/**
 * Creates and returns a Slack client instance with the appropriate token
 * @returns {Promise<Slack>} A configured Slack client
 */
async function getSlackClient() {
  if (!slackClientInstance) {
    const token = await secretService.getSlackBotToken();
    slackClientInstance = await Slack.create(token);
  }
  return slackClientInstance;
}


/**
 * Process a Slack event
 * @param {Object} event - The Slack event object containing:
 * @returns {Promise<void>}
 */
async function handleSlackEvent(event) {
  system.logInfo('Incoming Slack event', {
    ...event,
    text: event.text ? event.text.replace(/[\r\n]+/g, ' ').slice(0, 100) : undefined
  });
  
  if (event.bot_id || event.subtype === 'bot_message') {
    system.logInfo("Ignoring bot's message.", {eventTs: event.event_ts});
    return;
  }
  
  if (recentEventTimestamps.get(event.event_ts)) {
    system.logInfo("Ignoring duplicate event.", {eventTs: event.event_ts});
    return;
  }
  recentEventTimestamps.set(event.event_ts, true);
  
  const client = await getSlackClient();
  const botId = client.getBotUserId();
  const isAppMention = event.text && event.text.includes(`<@${botId}>`);
  
  if (event.type === 'reaction_added' && event.reaction === '+1') {
    triggerAction(event)
      .catch(e => {
        system.logError('Failed to trigger action', e, event);
        client.addReaction(event.item.channel, '-1', event.item.ts)
          .catch(e => system.logError('Failed to add \'-1\' reaction', e, event));
      });
  } else if (event.thread_ts || isAppMention) {
    client.addReaction(event.channel, 'eyes', event.ts)
      .catch(e => system.logError('Failed to add \'eyes\' reaction', e, event));
    messageQueue.push({ event });
    system.logInfo('Event enqueued', event);
  } else {
    system.logInfo("Ignoring message. Nothing to act on.", {eventTs: event.event_ts});
  }
}


module.exports = {
  handleSlackEvent,
  bookAction,
  triggerAction
};
