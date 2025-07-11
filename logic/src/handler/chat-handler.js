const LanguageModelService = require('../shared/language-model-service');
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt();
const system = require('../shared/system');


const callbacks = {
  info(message) {
    system.logInfo(message);
  },
  sendMail(account, to, subject, body, inResponseTo, cc, replyToAll) {
    system.logInfo("sendMail", {account, to, subject, body, inResponseTo, cc, replyToAll});
  },
  createTask(taskList, title, description, due, labels, path)  {
    system.logInfo("createTask", {taskList, title, description, due, labels, path});
  },
  deleteTask(id) {
    system.logInfo("deleteTask", {id});
  },
  createEvent(accountId, title, start, duration, description, attendees) {
    system.logInfo("createEvent", {accountId, title, start, duration, description, attendees});
  }
}


function send(req, res) {
  const { message, imageUrl, userId, contextId } = req.body;
  const ctx = contextId || system.mkUUID();
  const outputType = req.query.output || 'json';
  
  if (!userId) {
    return res.status(400).json({error: 'Missing userId'});
  }
  
  if (!message && !imageUrl) {
    return res.status(400).json({error: 'Either message or imageUrl is required'});
  }

  if (!['json', 'html'].includes(outputType)) {
    return res.status(400).json({ error: 'Invalid output type' });
  }

  LanguageModelService.create(userId, ctx, callbacks)
    .then(service => service.sendMessage(message, imageUrl))
    .then(replyContent => {
      if (outputType === 'json') {
        return res.json({
          response: replyContent,
          contextId: ctx
        });
      } else if (outputType === 'html') {
        return res.send(md.render(replyContent + `\n\n"contextId":"${ctx}",`));
      }
    })
    .catch(err => {
      return system.handleError(res, 500, err, { userId, contextId: ctx, message });
    });
}

module.exports = { send };
