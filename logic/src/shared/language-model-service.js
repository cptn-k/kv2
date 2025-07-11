const MailService = require('./mail-service');
const OpenAIDriver = require('./openai-driver');
const SecretService = require('./secret-service');
const ContactsService = require('./contacts-service');
const MailCacheService = require('./mail-cache-service');
const TaskService = require('./task-service');
const UserKnowledgeService = require('./user-knowledge-service');
const UserLogService = require('./user-log-service');
const CalendarService = require('./calendar-service');
const system = require("./system");
const { DateTime } = require('luxon');

const MAX_RESPONSE_WORDS = 5000;

const MAILBOX_SUMMARY_INSTRUCTIONS = `
  You are responsible for shortening the size of a list of emails.
  - Output should be in form of a JSON list. Each element should be an object in form of {id, date, sender, and summary}.
  - id should be exactly the same as the one in the original input.
  - Response can be up to ${MAX_RESPONSE_WORDS} words, prioritizing newest and most important emails.
`;

const SESSION_INSTRUCTIONS = `
  You are K2O, an AI assistant. Your primary skills are to provide briefings, and managing tasks, checklist, calendars, events, emails, memories, and logs.
  
  - Place emojis sparingly and strategically throughout the text. Use them to reinforce points, or as section markers.
  - Whenever user asking for current data or time, or a task requires that to be known, use get-current-time function.

  - You can manage user's mailbox
    - When listing emails for the user, follow these rules:
      - Your response should be extensive and contain all applicable emails.
      - For each email, supply a unstructured itemized single-paragraph overview that captures its summary and its sender (up to 500 letters), while mentioning the relative time of that email. Highlight important keywords. The paragraph ends with the full and exact ID of that email.
      - Example: "**Your OpenAI API account has been funded** - Open AI has informed you this morning that of a funding charge of **$5.08** to your OpenAI account, inviting a billing review. ID: 1234abcd#google_123456789012#1234567890abcdef"
      - At the end, supplement your response with a one-paragraph overview of those emails, pointing out general themes.
      - If applicable, after the overview, offer a structured list follow up actions that user can consider regarding those emails.
      - Use emojis as appropriate.
    - When user is asking about emails with no relevant IDs known, use get-inbox to get a list of emails.
    - To get details of specific emails, use get-mail function with the email ID.
      - When asked about details on specific emails, summary should be outlined and itemized. Add a summary of metadata at the end, and supply link to full email if available.
      - If email contains information about events, or entails any follow up tasks, offer to create them for the user.
    - Call send-mail to help user compose and send an email. Choose and supply the most appropriate account ID (private, personal, business, etc) according to the chat history. If target email address is mentioned in conversation history use it, otherwise use the name of the target person fot 'to' parameter.
    - Use archive-mail function to help user archive emails to remove them from the inbox while preserving them in the account.
    - When answering a question about multiple emails, add a paragraph in the beginning that explain what they have in common, if any.
    - To create a rule for emails, use the create-rule function with an email address and instructions. If email address is not available in context, ask user to specify. Make sure that user has specified clear instructions for how to process the email.
    
  - You can manage user's tasks
    - Call get-own-tasks to get a list of user's tasks.
    - Call create-task to help user compose a new task. Choose the most appropriate listId according to the 'task lists' context and message history.
    - You can also delete-task, mark-task-in-progress, and mark-task-done.
    - When creating a task according to an email, include extensive information from that email in the description. Always include link to that email in the description. If the email contains links needed to accomplish the task, include them in the description too.
    
  - You can memorize and recall facts about topics.
    - When asked to memorize a fact about the user, invoke get-memory function with 'general' as topic id.
    - When asked to memorize a fact about a specific topic, if a relevant {name, id} JSON pair is available in context, go ahead and call the create-memory function with the given ID. Otherwise, call the get-memory-topics function to retrieve a list of topics. If a relevant ID still cannot be found, ask user to explicitly request for a topic to be created.
    - Differentiate between user's intention to log and intention to save to memory. When user states that something has happened, or reports a measurement about their own situation (e.g. weight) that is a log command. When user states a fact about a topic, that is a memory command. If that is not enough to infer user's intention, ask them to specify.
    
  - You can process pictures. When user provides a picture assess their intention to be one of: create events, log calories, log weight, or describe the image.
    - If provided image mainly shows food, log the information immediately: guess the amount of calories in it, and call log-metics function with type='calories', value=estimated amount, and notes=description of what can be seen in the image.
    - If provided image mainly shows a scale with weight showing on its screen, call log-metics function with type='weight', value=displayed weight, and no notes.
    - If provided image has text describing events with time and title, go ahead and call create-event for each item. Guess the duration and description from the image. Guess account to be used from the context, otherwise default on a personal account.
    - If provided image does not mainly show food, or event information, then respond with a description of what can be seen in the picture.
    
  - You can log measures and situations via log and log-metrics functions.
  
  - You can manager user's calendars
    - In case a calendar event is to be created, try to infer the most appropriate account ID from the previous messages. Try to guess appropriate time and duration from message history and assistant's internal knowledge. If these information cannot be easily inferred, as user to specify.
    - After retrieving calendar events, start by a short overview paragraph, list requested events, and note patterns or important items, if any.
    - When creating an event according to an email, extract and include extensive information from that email in the description. Always include link to that email in the description.
    - When creating an event according to a task, include relevant information from that task, and add a link to it if available.
    
  - You can maintain a checklist in message history.
    - When user asks you to track what he is doing, create a checklist in markdown format and update it as use provides additional information.
    - When user asks for a task to be unlisted, they want to remove it from the list, not from the system.
    - If user is working on a checklist, and asks for a task to be removed, ask them to clarify if they want the task to be unlisted or be removed from the system.
    - If user is working on a checklist, and states that a task is done or completed, use mark-task-done function, and update the checklist accordingly.
    
  - You should provide briefing as per user's request
    - Terms like "how does my day look like?", "what do we have left?", "what is on my plate?", "brief me", or "report!", signals user's intention to receive briefing.
    - When asked for briefing, get mails and scan them for action items, get calendar events, get tasks, recall checklist if available, and report to the user.
    - Prioritized by date.
    - Highlight items that seem more important.
    - Use emojis as appropriate.
`;


const IMAGE_PROMPT_PREFIX =
  "Detect what is in this image and take action accordingly. ";



const DONE_MESSAGE = "Done. Assistant should respond with word DONE in all caps.";

class Handlers {
  
  constructor(userId, callbacks, mailService, mailCacheService) {
    this._callbacks = callbacks;
    this._mailService = mailService;
    this._userId = userId;
    this._mailCacheService = mailCacheService;
    this._openaiDriver = null;
  }

  //#region Utility Methods

  /**
   * Format a date string into a human-readable relative time
   * @param {string} dateString - ISO date string to format
   * @returns {string} Human-readable relative time (e.g., "just now", "2 hours ago", "yesterday")
   * @private
   */
  _formatRelativeTime(dateString) {
    if (!dateString) return '';

    try {
      const emailDate = DateTime.fromISO(dateString);
      const now = DateTime.now();

      // First try toRelativeCalendar which gives more natural language like "yesterday"
      try {
        return emailDate.toRelativeCalendar({ base: now });
      } catch (e) {
        // Fallback to toRelative if toRelativeCalendar isn't available
        return emailDate.toRelative({ base: now });
      }
    } catch (error) {
      system.logError('Error formatting relative time', {
        method: 'Handlers._formatRelativeTime',
        dateString,
        error: error.message
      });
      return '';
    }
  }

  /**
   * Gets the current time in the user's timezone
   * @returns {Promise<string>} Current time formatted for user's timezone
   */
  async getTime() {
    return new Date().toLocaleString('en-US', {timeZone: 'America/Los_Angeles'});
  }

  /**
   * Sets the OpenAI driver for this handler
   * @param {Object} driver - OpenAI driver instance
   */
  setDriver(driver) {
    this._openaiDriver = driver;
  }

  /**
   * Refreshes the cache for the user
   * @returns {Promise<string>} Done message
   */
  async refreshCache(userId) {
    await this._callbacks.refreshCache(userId);
    return DONE_MESSAGE;
  }

  /**
   * Converts a mail ID to GPT-friendly format
   * @param {string} id - Mail ID to convert
   * @returns {string} Converted ID in format mail#account#id#msg#id
   */
  mailIdToGpt(id) {
    const parts = this._mailCacheService.decomposeId(id);
    const accountParts = parts.accountId.split('_');
    return `mail-g${accountParts[1]}-${parts.providerId}`;
  }

  /**
   * Converts a GPT-friendly mail ID format back to original format
   * @param {string} gptId - Mail ID in GPT format (mail#user#id#account#id#msg#id)
   * @returns {string} Original mail ID format
   */
  gptToMailId(gptId) {
    const parts = gptId.split('-');
    if (parts.length !== 3 || parts[0] !== 'mail') {
      throw new Error('Invalid mail ID format');
    }
    const accountId = 'google_' + parts[1].substring(1);
    return this._mailCacheService.composeId(accountId, parts[2]);
  }
  
  //#endregion
  
  //#region Email Management

  /**
   * Fetches, trims, summarizes emails, and returns the summary.
   * @returns {Promise<string>} Summarized inbox content.
   */
  async getInbox() {
    const userId = this._userId;

    const inboxIds = await this._mailCacheService.getInbox();
    if (!inboxIds || inboxIds.length === 0) {
      return JSON.stringify([]);
    }

    const result = [];
    const supplement = [];
    let totalSize = 0;
    const MAX_SIZE = 15000;
    const DETAIL_THRESHOLD = 10000;

    let index = 0;
    while (index < inboxIds.length && totalSize < MAX_SIZE) {
      const emailId = inboxIds[index];
      const email = await this._mailCacheService.get(emailId);
      if (!email) break;

      const record = {
        id: this.mailIdToGpt(email._id),
        time: email.date,
        from: email.from,
        subject: email.title,
        summary: totalSize > DETAIL_THRESHOLD ? email.shortSummary : email.autoSummary,
        actionItems: email.actionItems,
        deadline: email.deadline,
        keyPeople: email.keyPeople,
        category: email.category,
        sentiment: email.sentiment,
        labels: email.labels,
        priorityLabel: email.priorityLabel,
      };

      const newSize = Buffer.byteLength(JSON.stringify(record), 'utf8');
      result.push(record);

      totalSize = totalSize + newSize;
      index++;
    }

    this._callbacks.info(`Retrieved ${result.length} emails (${totalSize/1000}k).`);
    return JSON.stringify(result);
  }

  /**
   * Gets the count of emails in the mailbox
   * @returns {Promise<string>} Count of emails as a string
   */
  async getMailboxCount() {
    const inboxIds = await this._mailCacheService.getInbox();
    return String(inboxIds.length);
  }

  /**
   * Searches the mailbox for emails matching the given text
   * @param {string} text - Text to search for
   * @returns {Promise<string>} JSON string of matching emails
   */
  async searchMailbox(text) {
    this._callbacks.info(`Searching for emails matching '${text}'`);
    const result = JSON.stringify(await this._mailService.search(text));
    return "Likely matches: " + result;
  }

  /**
   * Retrieves a single email by its ID and processes it.
   * @param {string} id - Arguments including email ID.
   * @returns {Promise<Object>} Fetched email object.
   */
  async getMail(id) {
    if (!id) {
      throw new Error('Email ID is required');
    }

    const email = await this._mailCacheService.get(this.gptToMailId(id));
    if (!email) {
      this._callbacks.info(`Assistant requested wrong ID: ${id}`);
      return "Wrong ID";
    }

    email._id = id;
    this._callbacks.info(`Email loaded: [${email.title}](${email.linkToMessage}).`);
    return JSON.stringify(email);
  }

  /**
   * Sends an email with the given parameters
   * @param {string} account - Account ID to send from
   * @param {string} to - Email address or contact name to send to
   * @param {string} subject - Email subject
   * @param {string} body - Email body
   * @param {Array|string} cc - CC recipients
   * @param {string} inResponseTo - ID of email being responded to
   * @param {boolean} replyToAll - Whether to reply to all recipients
   * @returns {Promise<string>} Done message or error
   */
  async sendMail(account, to, subject, body, cc = [], inResponseTo = null, replyToAll = false) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(to)) {
      // If not valid email, search contacts
      const contacts = await this.findContact(to);

      if (!contacts || contacts.length === 0) {
        throw new Error(`No contact found matching: ${to}`);
      }

      if (contacts.length > 1) {
        return "Multiple contacts found. Please specify which email to use:\n" +
          contacts.map(c => `- ${c.name} (${c.email})`).join('\n');
      }

      if(!contacts[0].emailAddresses || contacts[0].emailAddresses.length === 0) {
        return "No email address found for contact. " + contacts[0];
      }

      to = contacts[0].emailAddresses[0];
    }

    if (!account) {
      throw new Error('Account ID is required');
    }

    const mailService = await MailService.create(this._userId);
    const accounts = await mailService.getAccounts();
    const validAccount = accounts.find(a => a.id === account);

    if (!validAccount) {
      this._callbacks.info(`Assistant has provided an invalid account ID: ${account}`);
      return "Invalid account ID. Available accounts:\n" +
        accounts.map(a => `- ${a.email} (${a.id})`).join('\n');
    }

    if (typeof cc === 'string') {
      cc = cc.split(',').map(email => email.trim()).filter(email => email.length > 0);
    }

    const responseToId = inResponseTo ? this.gptToMailId(inResponseTo) : null;

    this._callbacks.sendMail(account, to, subject, body, responseToId, cc, replyToAll);
    return DONE_MESSAGE;
  }

  /**
   * Archives an email message
   * @param {string} messageId - ID of the email to archive
   * @returns {Promise<string>} Done message or error
   */
  async archiveMail(messageId) {
    const mailId = this.gptToMailId(messageId);
    const email = await this._mailCacheService.get(mailId);
    if (!email) {
      this._callbacks.info(`Assistant requested wrong ID: ${mailId}`);
      return "Wrong ID";
    }
    await this._mailService.archive(mailId);
    this._callbacks.info(`Archived message "${email.title}" from inbox.`);
    return DONE_MESSAGE;
  }

  /**
   * Moves an email to the junk/spam folder
   * @param {string} messageId - ID of the email to move
   * @returns {Promise<string>} Done message or error
   */
  async moveToJunk(messageId) {    
    const mailId = this.gptToMailId(messageId);
    const email = await this._mailCacheService.get(mailId);
    if (!email) {
      this._callbacks.info(`Assistant requested wrong ID: ${mailId}`);
      return "Wrong ID";
    }
    await this._mailService.moveToJunk(mailId);
    this._callbacks.info(`Moved message "${email.title}" to junk folder.`);
    return DONE_MESSAGE;
  }

  /**
   * Moves an email to the trash folder
   * @param {string} messageId - ID of the email to move
   * @returns {Promise<string>} Done message or error
   */
  async moveToTrash(messageId) {
    const mailId = this.gptToMailId(messageId);
    const email = await this._mailCacheService.get(mailId);
    if (!email) {
      this._callbacks.info(`Assistant requested wrong ID: ${mailId}`);
      return "Wrong ID";
    }
    await this._mailService.moveToTrash(mailId);
    this._callbacks.info(`Moved message "${email.title}" to trash folder.`);
    return DONE_MESSAGE;
  }

  /**
   * Gets a list of emails ready for deletion (spam, junk, etc)
   * @returns {Promise<string>} JSON string of emails
   */
  async getSpam() {
    const MAX_SPAM_MESSAGES = 20;
    const ids = await this._mailCacheService.getDeletables();
    const spams = [];
    for (let i = 0; i < Math.min(ids.length, MAX_SPAM_MESSAGES); i++) {
      const email = await this._mailCacheService.get(ids[i]);
      if (email) {
        spams.push({
          id: this.mailIdToGpt(email._id),
          title: email.title,
          date: email.date,
          sender: email.from
        });
      }
    }
    this._callbacks.info(`Found ${spams.length} purge candidates.`);
    return JSON.stringify(spams);
  }

  /**
   * Creates an email rule
   * @param {string} email - Email address to create rule for
   * @param {string} instructions - Instructions for processing
   * @param {boolean} postToSlack - Whether to post to Slack
   * @param {boolean} includeInMorningSummary - Whether to include in morning summary
   * @param {boolean} autoRespond - Whether to auto-respond
   * @returns {Promise<string>} Done message or error
   */
  async createRule(email, instructions, postToSlack, includeInMorningSummary, autoRespond) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return `${email} is not a valid email address.`;
    }

    await this._mailService.createRule(email, instructions,
      {postToSlack, includeInMorningSummary, autoRespond});

    const flags = [
      postToSlack && 'post to slack',
      includeInMorningSummary && 'include in morning summary',
      autoRespond && 'auto respond'
    ].filter(Boolean).join(' | ');

    this._callbacks.info(`Rule created for ${email} - ${instructions} ${flags ? ' | ' + flags : ''}`);
    return DONE_MESSAGE;
  }
  //#endregion
  
  //#region Task Management

  /**
   * Retrieves task lists in a folder.
   * @param {string} folderId - Folder identifier.
   * @returns {Promise<string>} Retrieved task lists.
   */
  async getLists(folderId) {
    const taskService = await TaskService.create(this._userId);
    const lists = await taskService.getTaskLists();
    this._callbacks.info(`${lists.length} lists retrieved.`);
    return JSON.stringify(lists);
  }

  /**
   * Creates a new task with the given parameters
   * @param {string} listId - List ID to create task in
   * @param {string} title - Task title
   * @param {string} description - Task description
   * @param {string} due - Due date for task
   * @param {number} priority - Priority level (1-4)
   * @param {Array} labels - Labels for the task
   * @returns {Promise<string>} Done message or error
   */
  async createTask(listId, title, description, due, priority, labels) {
    const ts = due ? new Date(due).getTime() : null;

    if (priority && (isNaN(Number(priority)) || priority < 1 || priority > 4)) {
      return "Priority must be between 1 and 4.";
    }

    const defaultedPriority = priority || 3;
    await this._callbacks.createTask(listId, title, description, defaultedPriority, ts, labels);
    return DONE_MESSAGE;
  }

  /**
   * Deletes a task by ID
   * @param {string} id - Task ID to delete
   * @returns {Promise<string>} Done message or error
   */
  async deleteTask(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'Handlers.deleteTask',
        userId: this._userId
      });
    }

    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);

    if (!task) {
      this._callbacks.info(`Assistant attempted to delete non-existence task ${id}.`);
      return 'Wrong ID';
    }

    await this._callbacks.deleteTask(id);
    return DONE_MESSAGE;
  }

  /**
   * Marks a task as in progress
   * @param {string} id - Task ID to update
   * @returns {Promise<string>} Done message or error
   */
  async markTaskInProgress(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', { 
        method: 'Handlers.markTaskInProgress',
        userId: this._userId 
      });
    }

    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);
    await taskService.setTaskStatusDoing(id);

    this._callbacks.info(`Task ${task.name} marked as in progress.`);
    return DONE_MESSAGE;
  }

  /**
   * Marks a task as done
   * @param {string} id - Task ID to mark as done
   * @returns {Promise<string>} Done message or error
   */
  async markTaskDone(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'Handlers.markTaskDone',
        userId: this._userId
      });
    }

    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);
    await taskService.setTaskStatusDone(id);

    this._callbacks.info(`Task ${task.name} marked as done.`);
    return DONE_MESSAGE;
  }

  /**
   * Sets the due date for a task
   * @param {string} id - Task ID to update
   * @param {string} dueDate - New due date in ISO format
   * @returns {Promise<string>} Done message or error
   */
  async markTaskDue(id, dueDate) {
    if (!id || !dueDate) {
      throw system.mkError('Required parameters missing: id and dueDate', {
        method: 'Handlers.markTaskDue',
        userId: this._userId
      });
    }

    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);
    task.due_date = new Date(dueDate).getTime();
    await taskService.updateTask(id, task);
    this._callbacks.info(`Task ${task.name} due date updated to ${dueDate}`);
    return DONE_MESSAGE;
  }

  /**
   * Updates the priority of a task
   * @param {string} id - Task ID to update
   * @param {number} priority - New priority level (1-4)
   * @returns {Promise<string>} Done message or error
   */
  async updateTaskPriority(id, priority) {
    if (!id || !priority) {
      throw system.mkError('Required parameters missing: id and priority', {
        method: 'Handlers.updateTaskPriority',
        userId: this._userId
      });
    }

    if (isNaN(Number(priority)) || priority < 1 || priority > 4) {
      return "Priority must be between 1 and 4.";
    }

    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);
    task.priority = priority;
    await taskService.updateTask(id, task);

    const priorityNames = {1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low'};
    this._callbacks.info(`Task ${task.name} priority updated to ${priorityNames[priority]}`);
    return DONE_MESSAGE;
  }

  /**
   * Moves a task to a different list
   * @param {string} taskId - Task ID to move
   * @param {string} targetListId - Destination list ID
   * @returns {Promise<string>} Done message or error
   */
  async moveTaskToList(taskId, targetListId) {
    if (!taskId || !targetListId) {
      throw system.mkError('Required parameters missing: taskId and targetListId', {
        method: 'Handlers.moveTaskToList',
        userId: this._userId
      });
    }

    const taskService = await TaskService.create(this._userId);
    await taskService.moveTask(taskId, targetListId);

    this._callbacks.info(`Task ${taskId} moved to list ${targetListId}`);
    return DONE_MESSAGE;
  }

  /**
   * Creates a new task list
   * @param {string} name - List name
   * @param {string} spaceId - Space ID to create list in
   * @returns {Promise<Object>} Created list
   */
  async createTaskList(name, spaceId) {
    if (!name || !spaceId) {
      throw system.mkError('Required parameters missing: name and spaceId', {
        method: 'Handlers.createTaskList',
        userId: this._userId
      });
    }

    const taskService = await TaskService.create(this._userId);
    const list = await taskService.createList(spaceId, name);

    this._callbacks.info(`Task list created: ${name} in space ${spaceId}`);
    return list;
  }

  /**
   * Gets a task by ID
   * @param {string} id - Task ID to retrieve
   * @returns {Promise<Object>} Task object
   */
  async getTask(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'Handlers.getTask',
        userId: this._userId
      });
    }

    const taskService = await TaskService.create(this._userId);
    const task = await taskService.getTask(id);

    this._callbacks.info(`Task retrieved: ${task.title}`);
    return task;
  }

  /**
   * Gets all tasks for the current user
   * @returns {Promise<Array>} Array of task objects
   */
  async getOwnTasks() {
    const taskService = await TaskService.create(this._userId);

    // Get the first workspace to fetch tasks from
    const workspaces = await taskService.getWorkspaces();
    if (!workspaces || workspaces.length === 0) {
      this._callbacks.info('No workspaces found.');
      return [];
    }

    const tasks = await taskService.getOwnTasks(workspaces[0].id);
    this._callbacks.info(`${tasks.length} tasks retrieved.`);
    return tasks;
  }
  //#endregion
  
  //#region Memory and Knowledge Management

  /**
   * Creates a new memory topic
   * @param {string} topic - Topic name
   * @returns {Promise<string>} JSON string with topic info
   */
  async createMemoryTopic(topic) {
    const knowledgeService = new UserKnowledgeService(this._userId);
    const file = await knowledgeService.createFile(topic);
    this._callbacks.info(`File created: ${topic}`);
    return `{name:'${topic}', id: '${file._id}'}`;
  }

  /**
   * Creates a new memory entry
   * @param {string} id - Topic ID to store memory in
   * @param {string} content - Memory content
   * @returns {Promise<string>} Done message
   */
  async createMemory(id, content) {
    const knowledgeService = new UserKnowledgeService(this._userId);
    if(id === 'general') {
      await knowledgeService.addGeneralRecord(content);
    } else {
      await knowledgeService.addRecord(id, content);
    }
    this._callbacks.info(`Memory entry created: ${id} - ${content}`);
    return DONE_MESSAGE;
  }

  /**
   * Retrieves memories for a topic
   * @param {string} id - Topic ID
   * @returns {Promise<Array>} Array of memory records
   */
  async getMemory(id) {
    const knowledgeService = new UserKnowledgeService(this._userId);

    let data;
    if(id === 'general') {
      data = await knowledgeService.listGeneralRecords();
    } else {
      if(! await knowledgeService.exists(id)) {
        return "Topic not found.";
      }
      data = await knowledgeService.listRecords(id);
    }

    const recordList = Object.values(data).map(record => record.content);

    this._callbacks.info(`${recordList.length} records loaded from topic '${id}'.`);
    return recordList;
  }

  /**
   * Gets a list of all memory topics
   * @returns {Promise<Array>} Array of topic objects
   */
  async getMemoryTopics() {
    const knowledgeService = new UserKnowledgeService(this._userId);
    const list = await knowledgeService.listFiles();
    return list.map(file => ({name: file.name, id: file._id}));
  }

  /**
   * Logs metrics data
   * @param {string} name - Metric name
   * @param {*} value - Metric value
   * @param {string} notes - Additional notes
   * @returns {Promise<string>} Done message
   */
  async logMetrics(name, value, notes) {
    const userLogService = new UserLogService();
    await userLogService.createLogEntry(this._userId, notes, { [name]: value });
    if(notes) {
      this._callbacks.info(`Logged ${name} = ${value} with notes: ${notes}.`);
    } else {
      this._callbacks.info(`Logged ${name} = ${value}.`);
    }
    return DONE_MESSAGE;
  }

  /**
   * Logs a note
   * @param {string} note - Note content
   * @returns {Promise<string>} Done message
   */
  async log(note) {
    const userLogService = new UserLogService();
    await userLogService.createLogEntry(this._userId, note);
    this._callbacks.info('Logged: ' + note);
    return DONE_MESSAGE;
  }
  //#endregion
  
  //#region Contacts Management

  /**
   * Finds contacts matching a query
   * @param {string} query - Search query
   * @returns {Promise<Array>} Array of matching contacts
   */
  async findContact(query) {
    const contactsService = await ContactsService.create(this._userId);

    const contacts = await contactsService.find(query);
    this._callbacks.info(`Found ${contacts.length} contact(s) for '${query}'.`);
    return contacts;
  }
  //#endregion

  //#region Calendar Management

  /**
   * Gets calendar events for the next 7 days
   * @returns {Promise<Array>} Array of event objects
   */
  async getWeekEvents() {
    const calendarService = await CalendarService.create(this._userId);
    const weekEvents = await calendarService.getWeekEvents();
    this._callbacks.info(`Found ${weekEvents.length} events in next 7 days.`);
    return weekEvents;
  }

  /**
   * Gets calendar events for the next 30 days
   * @returns {Promise<Array>} Array of event objects
   */
  async getMonthEvents() {
    const calendarService = await CalendarService.create(this._userId);
    const monthEvents = await calendarService.getMonthEvents();
    this._callbacks.info(`Found ${monthEvents.length} events in next 30 days.`);
    return monthEvents;
  }

  /**
   * Creates a new calendar event
   * @param {string} accountId - Account ID to create event in
   * @param {string} title - Event title
   * @param {string} start - Start time in ISO format
   * @param {number} duration - Duration in minutes
   * @param {string} description - Event description
   * @param {string} location - Event location
   * @returns {Promise<string>} Done message
   */
  async createEvent(accountId, title, start, duration, description, location) {
    await this._callbacks.createEvent(accountId, title, start, duration, description, location);
    return DONE_MESSAGE;
  }
  //#endregion

  //#region Messaging

  /**
   * Sends an SMS message
   * @param {string} to - Recipient phone number or contact name
   * @param {string} message - Message content
   * @returns {Promise<string>} Done message or error
   */
  async sendSms(to, message) {
    const cleanPhoneNumber = to.replace(/[\s()\-]/g, '');
    const phoneRegex = /^\+?1?\d{10,15}$/;

    if (!phoneRegex.test(cleanPhoneNumber)) {
      const contacts = await this.findContact(to);
      if (!contacts || contacts.length === 0) {
        throw new Error(`No contact found matching: ${to}`);
      }
      if (contacts.length > 1) {
        return "More than one target contacts found. Sort in order of relevance to current chat, and ask user to choose. \n\n" + JSON.stringify(contacts);
      }
      if (contacts[0].phoneNumbers && contacts[0].phoneNumbers.length > 1) {
        return "More than one phone number found for contact. \n\n" + JSON.stringify(contacts);
      }
      if (!contacts[0].phoneNumbers || contacts[0].phoneNumbers.length === 0) {
        return "No phone number found for contact. \n\n" + JSON.stringify(contacts);
      }

      to = contacts[0].phoneNumbers[0];
    }

    await this._callbacks.sendSms(cleanPhoneNumber, message);
    return DONE_MESSAGE;
  }
  //#endregion
} // End of Handlers class


/**
 * Service for interacting with OpenAI's language model.
 */
class LanguageModelService {
  /**
   * Constructor initializes the service with a driver and callback.
   * @param {Object} driver - OpenAI driver instance.
   */
  constructor(driver) {
    this.driver = driver;
  }

  /**
   * Creates an instance of the service.
   * @param {string} userId - User identifier.
   * @param {string} contextId - Context identifier.
   * @param {Object} callbacks - Callbacks
   * @returns {Promise<LanguageModelService>} Initialized service instance.
   */
  static async create(userId, contextId, callbacks) {
    const now = Date.now();
    const mailService = await MailService.create(userId);
    const mailCacheService = await MailCacheService.create(userId);
    const apiKey = await SecretService.getOpenAiApiKey();
    const handlers = new Handlers(userId, callbacks, mailService, mailCacheService);
    
    //#region Functions
    const functions = [
      // Email management functions
      {
        name: 'refresh-cache',
        description: 'Refresh all cached data. Call only on explicit user request',
        params: [],
        handler: () => handlers.refreshCache(userId),
      },
      {
        name: 'get-inbox',
        description: 'Retrieve emails from the user\'s inbox, sorted by importance',
        params: [],
        handler: () => handlers.getInbox(userId, contextId),
      },
      {
        name: 'search-mailbox',
        description: 'Search emails matching given text in subject or content',
        params: [
          {
            name: 'text',
            description: 'Text to search for in emails',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.searchMailbox(args.text),
      },
      {
        name: 'get-mail',
        description: 'Retrieve a single email by its ID',
        params: [
          {
            name: 'emailId',
            description: 'The Gmail message ID to retrieve',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.getMail(args.emailId),
      },
      {
        name: 'send-mail',
        description: 'Offer an email draft to the user for editing and sending.',
        params: [
          {
            name: 'accountId',
            description: 'User email account ID',
            isRequired: true,
          },
          {
            name: 'to',
            description: 'Recipient email address, or name if address is not known',
            isRequired: true,
          },
          {
            name: 'subject',
            description: 'Email subject',
            isRequired: true,
          },
          {
            name: 'body',
            description: 'Email body content',
            isRequired: true,
          },
          {
            name: 'cc',
            description: 'Comma-separated list of CC recipients',
            isRequired: false,
          },
          {
            name: 'inResponseTo',
            description: 'ID of the email being replied to',
            isRequired: false,
          },
          {
            name: 'replyToAll',
            description: 'Whether to reply to all recipients',
            isRequired: false,
          },
        ],
        
        handler: (args) => handlers.sendMail(args.accountId, args.to, args.subject, args.body, args.cc, args.inResponseTo, args.replyToAll),
      },
      {
        name: 'find-contact',
        description: 'Search for contacts by name or email',
        params: [
          {
            name: 'query',
            description: 'Search query - name or email address',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.findContact(args.query),
      },
      
      // Task management functions
      {
        name: 'create-task',
        description: 'Offer a task draft to the user for editing and saving.',
        params: [
          {
            name: 'listId',
            description: 'ID of the target task list',
            isRequired: true,
          },
          {
            name: 'title',
            description: 'Task title',
            isRequired: true,
          },
          {
            name: 'description',
            description: 'Task description',
            isRequired: true,
          },
          {
            name: 'due',
            description: 'Due date and time for this task in ISO 8601 format',
            isRequired: false,
          },
          {
            name: 'priority',
            description: 'An integer between 1 to 4 indicating priority level, where 1 means Urgent, 2 means High, 3 is Normal, and 4 means Low)',
            isRequired: false,
          },
          {
            name: 'labels',
            description: 'Task labels',
            isRequired: false,
          }
        ],
        handler: (args) => handlers.createTask(args.listId, args.title, args.description, args.due, args.priority, args.labels),
      },
      {
        name: 'delete-task',
        description: 'Delete a task by ID',
        params: [
          {
            name: 'id',
            description: 'Task identifier',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.deleteTask(args.id),
      },
      {
        name: 'mark-task-in-progress',
        description: 'Mark a task as being in progress',
        params: [
          {
            name: 'id',
            description: 'Task identifier',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.markTaskInProgress(args.id),
      },
      {
        name: 'mark-task-done',
        description: 'Mark a task as done',
        params: [
          {
            name: 'id',
            description: 'Task identifier',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.markTaskDone(args.id),
      },
      {
        name: 'move-task-to-list',
        description: 'Move a task to a different list',
        params: [
          {
            name: 'taskId',
            description: 'Task identifier',
            isRequired: true,
          },
          {
            name: 'targetListId',
            description: 'Target list identifier',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.moveTaskToList(args.taskId, args.targetListId),
      },
      {
        name: 'create-task-list',
        description: 'Create a new task list',
        params: [
          {
            name: 'name',
            description: 'Name of the new task list',
            isRequired: true,
          },
          {
            name: 'spaceId',
            description: 'ID of the space to create the list in',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.createTaskList(args.name, args.spaceId),
      },
      {
        name: 'get-own-tasks',
        description: 'Retrieve all tasks for the current user',
        params: [],
        handler: () => handlers.getOwnTasks(),
      },
      {
        name: 'get-lists',
        description: 'Retrieve all task lists',
        params: [],
        handler: (args) => handlers.getLists(),
      },
      {
        name: 'set-task-due',
        description: 'Set due date for a task with a known ID. Cannot be used for newly created tasks.',
        params: [
          {
            name: 'id',
            description: 'Task identifier',
            isRequired: true,
          },
          {
            name: 'dueDate',
            description: 'Due date in ISO string format',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.markTaskDue(args.id, args.dueDate),
      },

      // Memory and knowledge management functions
      {
        name: 'create-memory-topic',
        description: 'Create a new memory topic',
        params: [
          {
            name: 'name',
            description: 'Topic name',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.createMemoryTopic(args.name),
      },
      {
        name: 'create-memory',
        description: 'Create a new memory entry',
        params: [
          {
            name: 'topicId',
            description: 'The ID of the topic to store this memory under',
            isRequired: true,
          },
          {
            name: 'content',
            description: 'Memory content',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.createMemory(args.topicId, args.content),
      },
      {
        name: 'get-memory',
        description: 'Retrieve memory by topic',
        params: [
          {
            name: 'topicId',
            description: 'The ID of the memory topic to retrieve',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.getMemory(args.topicId),
      },
      {
        name: 'get-memory-topics',
        description: 'Get list of all memory topics',
        params: [],
        handler: () => handlers.getMemoryTopics(),
      },

      // Logging and metrics functions
      {
        name: 'log-metrics',
        description: 'Log metrics data',
        params: [
          {
            name: 'type',
            description: 'Metric type',
            isRequired: true,
          },
          {
            name: 'value',
            description: 'Metric value',
            isRequired: true,
          },
          {
            name: 'notes',
            description: 'Additional notes',
            isRequired: false,
          },
        ],
        handler: (args) => handlers.logMetrics(args.type, args.value, args.notes),
      },
      {
        name: 'log',
        description: 'Log a note',
        params: [
          {
            name: 'note',
            description: 'Note content',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.log(args.note),
      },

      // Email rules and management functions
      {
        name: 'create-rule',
        description: 'Create an email rule',
        params: [
          {
            name: 'email',
            description: 'Sender\'s email address',
            isRequired: true,
          },
          {
            name: 'instructions',
            description: 'Instructions for AI on how to process the email contents.',
            isRequired: true,
          },
          {
            name: 'postOnSlack',
            description: 'Boolean. Set true by default. Set false if email is to be ignored.',
            isRequired: true,
          },
          {
            name: 'includeInMorningSummary',
            description: 'Boolean. false by default. Set true if email is to be included in morning summary/brief.',
            isRequired: true,
          },
          {
            name: 'autoRespond',
            description: 'Boolean. false by default. Set true if email is to be automatically responded to.',
            isRequired: true,
          },
        ],
        handler: (args) => handlers.createRule(args.email, args.instructions, args.postToSlack, args.includeInMorningSummary, args.autoRespond),
      },
      {
        name: 'move-to-junk',
        description: 'Move an email message to junk/spam folder',
        params: [
          {
            name: 'messageId',
            description: 'ID of the email message to move',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.moveToJunk(args.messageId),
      },
      {
        name: 'move-to-trash',
        description: 'Move an email message to trash folder',
        params: [
          {
            name: 'messageId',
            description: 'ID of the email message to move',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.moveToTrash(args.messageId),
      },
      {
        name: 'archive-mail',
        description: 'Archive an email message by removing it from the inbox',
        params: [
          {
            name: 'messageId',
            description: 'ID of the email message to archive',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.archiveMail(args.messageId),
      },
      {
        name: 'get-purgeable-mails',
        description: 'Get spams, junk, promotions, and other emails that are ready to be purged from inbox',
        params: [],
        handler: () => handlers.getSpam(),
      },

      // Calendar related functions
      {
        name: 'get-week-events',
        description: 'Get calendar events for the next 7 days',
        params: [],
        handler: () => handlers.getWeekEvents(),
      },
      {
        name: 'get-month-events',
        description: 'Get calendar events for the next 30 days',
        params: [],
        handler: () => handlers.getMonthEvents(),
      },
      {
        name: 'create-event',
        description: 'Provide user with and event draft to edit and save.',
        params: [
          {
            name: 'accountId',
            description: 'ID of the target account',
            isRequired: true,
          },
          {
            name: 'title',
            description: 'Event title',
            isRequired: true,
          },
          {
            name: 'start',
            description: 'Event start time in ISO 8601 format',
            isRequired: true,
          },
          {
            name: 'duration',
            description: 'Duration in minutes',
            isRequired: true,
          },
          {
            name: 'description',
            description: 'Event description',
            isRequired: false,
          },
          {
            name: 'location',
            description: 'Location of the event',
            isRequired: false,
          },
        ],
        handler: (args) => handlers.createEvent(args.accountId, args.title, args.start, args.duration, args.description, args.location),
      },

      // Messaging functions
      {
        name: 'send-sms',
        description: 'Provide user with an SMS message draft to edit and send.',
        params: [
          {
            name: 'to',
            description: 'Recipient phone number, or name if number is now known',
            isRequired: true,
          },
          {
            name: 'message',
            description: 'Message content',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.sendSms(args.to, args.message),
      },
      {
        name: 'move-to-junk',
        description: 'Move an email message to junk/spam folder',
        params: [
          {
            name: 'messageId',
            description: 'ID of the email message to move',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.moveToJunk(args.messageId),
      },
      {
        name: 'move-to-trash',
        description: 'Move an email message to trash folder',
        params: [
          {
            name: 'messageId',
            description: 'ID of the email message to move',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.moveToTrash(args.messageId),
      },
      {
        name: 'get-current-time',
        description: 'Get current local date and time',
        params: [],
        handler: () => handlers.getTime(),
      },
      {
        name: 'get-email-count',
        description: 'Get count of emails in mailbox',
        params: [],
        handler: () => handlers.getMailboxCount(),
      },
      {
        name: 'update-task-priority',
        description: 'Update task priority level (1: Urgent, 2: High, 3: Normal, 4: Low)',
        params: [
          {
            name: 'id',
            description: 'Task identifier',
            isRequired: true,
          },
          {
            name: 'priority',
            description: 'Priority level (1-4)',
            isRequired: true,
          }
        ],
        handler: (args) => handlers.updateTaskPriority(args.id, args.priority),
      },
    ];
    //#endregion
    
    const driver = await OpenAIDriver.create(apiKey, userId, contextId, SESSION_INSTRUCTIONS, functions);
    handlers.setDriver(driver);
    
    if(!(await driver.contextExists())) {
      callbacks.info(`Initializing context ${contextId}.`);
      await handlers.getMemoryTopics()
        .then(topics => {
          driver.setContext("topics", JSON.stringify(topics), true)
        });
      await handlers.getMemory('general')
        .then(records => driver.setContext("general knowledge", JSON.stringify(records), true));
      await mailService.getAccounts()
        .then(accounts => {
          driver.setContext("accounts", JSON.stringify(accounts), true)
        });
      await TaskService.create(userId)
        .then(t => t.getTaskLists())
        .then(lists => {
          driver.setContext("task lists", JSON.stringify(lists), true);
        });
      await driver.setContext("user timezone", "PDT (America/Los_Angeles)", true);
      await driver.setContext("user location", "California, United States", true);
      await driver.setContext("current time", new Date().toISOString(), true);
    }
    
    const time = Math.floor(Date.now() - now);
    callbacks.info(`LLM Ready. (${time/1000}s)`)
    
    return new LanguageModelService(driver);
  }
  
  /**
   * Sends a message and fetches the response from the model.
   * @param {string} message - User input message.
   * @param imageUrl
   * @returns {Promise<string>} Model's response.
   */
  async sendMessage(message, imageUrl) {
    if(imageUrl) {
      return this.driver.converse(
        IMAGE_PROMPT_PREFIX + (message ? message : ''),
        imageUrl);
    }
    const now = Date.now();
    const formatted = new Date().toLocaleString('en-US', {timeZone: 'America/Los_Angeles'});
    return this.driver.converse(message).then(response => {
      const duration = Math.floor((Date.now() - now)/1000);
      const size = Math.floor(this.driver._usedContextWindow/1000);
      return `${response} _(${size}k/${duration}s)_`;
    });
  }

  /**
   * Checks if a conversation context exists.
   * @returns {Promise<boolean>} True if context exists, otherwise false.
   */
  async contextExists() {
    return this.driver.contextExists();
  }
}


module.exports = LanguageModelService;