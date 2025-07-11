/**
 * @fileoverview OpenAI Driver - Manages interactions with OpenAI's API and conversation context
 *
 * This module provides a driver class to handle conversations with OpenAI's GPT models,
 * including conversation persistence, function calling capabilities, and context management.
 * It supports various GPT-4 models and handles message history with token limits.
 *
 * @module openai-driver
 * @author K2O Development Team
 * @version 1.0.0
 *
 * @license MIT
 * @copyright (c) 2025 K2O Development Team
 *
 * NOTE: Areas for improvement (technical debt):
 * - Improve error handling in API calls
 * - Handle potential issues in token truncation for multibyte characters
 * - Validate Firestore document initialization to handle missing documents gracefully
 * - Optimize performance and memory usage in conversation trimming logic
 * - Handle concurrent Firestore operations safely
 * - Introduce validation for function definitions and parameters
 * - Extend cleanup to manage other active resources like timers or listeners
 * - Allow configuration of constants like message length limits
 * - Avoid logging sensitive information in debug logs
 * 
 * Version History:
 * - 1.0.0 (2025-06): Initial release
 *   - Basic conversation management
 *   - Function calling support
 *   - Firestore persistence
 *   - Token and message length limits
 *   - Named contexts support
 */

const { OpenAI } = require('openai');
const firestore = require('./firestore');
const system = require('./system');

const STORE_NAME = 'k2o-chat';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 300;
const MAX_HISTORY_SIZE = 80000;
const SUPPORTED_MODELS = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o4-mini',
  'gpt-4o',
  'gpt-4o-mini'
];


function logAppendedMessage(contextId, messages, tracker = '') {
  if (!messages || messages.length === 0) return;

  const message = messages[messages.length - 1];
  const messageString = JSON.stringify(message);
  const lastLength = messageString.length;

  const truncated = {};
  Object.entries(message).forEach(([key, value]) => {
    if (typeof value === 'string') {
      truncated[key] = value.length > MAX_MESSAGE_LENGTH ? value.slice(0, MAX_MESSAGE_LENGTH) + '…' : value;
    } else {
      truncated[key] = value;
    }
  });

  system.logInfo(`Message appended to context`, {
    contextId,
    message: truncated,
    messageLength: lastLength,
    messageCount: messages.length
  });
}



function makeKey(contextId) {
  return `chat#${contextId}`;
}


function optimizeConversationHistory(doc) {
  if (!doc.messages || !Array.isArray(doc.messages) || doc.messages.length === 0) {
    return;
  }
  
  let cumulativeSize = doc.messages.reduce((sum, msg) => sum + (msg?.size ?? 0), 0);
  
  if (cumulativeSize <= MAX_HISTORY_SIZE) {
    return;
  }

  while (cumulativeSize > MAX_HISTORY_SIZE && doc.messages.length > 0) {
    const firstMsg = doc.messages[0];
    
    if (firstMsg.role === 'system' && firstMsg.context === 'global') {
      break;
    }
    
    if (firstMsg.role === 'tool') {
      break;
    }
    
    if (firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {
      if (doc.messages.length < 2) {
        throw new Error('Message with tool_calls has no following message');
      }
      const nextMsg = doc.messages[1];
      if (nextMsg.role !== 'tool') {
        throw new Error('Message with tool_calls must be followed by a message with role=tool');
      }
      cumulativeSize -= (firstMsg?.size ?? 0) + (nextMsg?.size ?? 0);
      doc.messages.splice(0, 2);
    } else {
      cumulativeSize -= (firstMsg?.size ?? 0);
      doc.messages.splice(0, 1);
    }
  }
}


/**
 * A class to handle interactions with OpenAI's API and manage conversations.
 * Provides functionality for storing conversations, handling function calls,
 * and managing message context.
 */
class OpenAiDriver {
  tracker =  String(Math.floor(100000 + Math.random() * 900000));

  /**
   * Creates a new instance of OpenAiDriver with validation.
   * @param {string} apiKey - The OpenAI API key.
   * @param {string} userId - The user identifier.
   * @param {string} contextId - The conversation context identifier.
   * @param {string} [instructions=''] - System instructions for the conversation.
   * @param {Array} [functions=[]] - Array of functions available for the AI to call.
   *                               Each function can have a contextName property that allows
   *                               its results to overwrite previous results with the same context.
   * @param {string} [model=DEFAULT_MODEL] - The OpenAI model to use.
   * @returns {Promise<OpenAiDriver>} A new instance of OpenAiDriver.
   * @throws {Error} If contextId is missing or model is not supported.
   */
  static async create(apiKey, userId, contextId, instructions = '', functions = [], model = DEFAULT_MODEL) {
    if (!contextId) {
      throw new Error('contextId is required for driver creation');
    }
    if (!SUPPORTED_MODELS.includes(model)) {
      throw new Error(`Unsupported model: ${model}`);
    }
    return new OpenAiDriver(apiKey, userId, contextId, instructions, functions, model);
  }


  /**
   * Creates a new instance of OpenAiDriver.
   * @param {string} apiKey - The OpenAI API key.
   * @param {string} userId - The user identifier.
   * @param {string} contextId - The conversation context identifier.
   * @param {string} [instructions=''] - System instructions for the conversation.
   * @param {Array} [functions=[]] - Array of functions available for the AI to call.
   * @param {string} [model=DEFAULT_MODEL] - The OpenAI model to use.
   */
  constructor(apiKey, userId, contextId, instructions = '', functions = [], model = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey: apiKey.trim() });
    this._userId = userId;
    this._contextId = contextId;
    this._instructions = instructions;
    this._model = model;
    this._functionMap = new Map();
    this._usedContextWindow = 0;
    this._processFunctions(functions);
  }


  /**
   * Processes functions passed to the driver and prepares them for OpenAI
   * @param {Array} functions - Array of function definitions
   * @private
   */
  _processFunctions(functions) {
    this._functionMap.clear();

    if (!functions || !Array.isArray(functions) || functions.length === 0) {
      this._functionDefs = [];
      return;
    }

    this._functionDefs = functions.map(fn => {
      this._functionMap.set(fn.name, { 
        handler: fn.handler, 
        contextName: fn.contextName || null 
      });

      const properties = {};
      const required = [];

      fn.params.forEach(p => {
        properties[p.name] = { type: 'string', description: p.description };
        if (p.isRequired) required.push(p.name);
      });

      return {
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description || '',
          parameters: { type: 'object', properties, required }
        }
      };
    });
  }

  /**
   * Saves the conversation state to Firestore.
   * This method is now a no-op since append() always saves immediately.
   * Kept for backward compatibility.
   * @returns {Promise<void>}
   */
  async saveConversation() {
    // No-op - append() now saves immediately
    return Promise.resolve();
  }

  /**
   * Cleans up resources by clearing function maps and references.
   */
  cleanup() {
    if (this._functionMap) this._functionMap.clear();
    this._functionDefs = null;
  }


  /**
   * Appends a message to the conversation history
   * @param {Object} message - The message to append
   * @param {boolean} [overwrite=false] - Whether to overwrite existing messages with the same context
   * @returns {Object} The updated conversation document
   */
  async append(message, overwrite = false) {
    // Always load the appendlatest conversation from Firestore
    let doc = await firestore.read(STORE_NAME, makeKey(this._contextId));

    // If document doesn't exist, create a new one
    if (!doc || !Array.isArray(doc.messages)) {
      const timestamp = Date.now();
      const messages = [];

      if (this._instructions && this._instructions.trim()) {
        messages.push({ role: 'system', content: this._instructions, context: 'global' });
      }

      doc = {
        contextId: this._contextId,
        userId: this._userId,
        messages,
        createdAt: timestamp,
        updatedAt: timestamp
      };
    }

    const timestamp = Date.now();
    message.timestamp = timestamp;
    message.size = JSON.stringify(message).length;

    optimizeConversationHistory(doc);

    doc.messages.push(message);
    doc.updatedAt = timestamp;

    await firestore.write(STORE_NAME, makeKey(this._contextId), doc);
    
    this._usedContextWindow = doc.messages.reduce((acc, message) => acc + (message?.size ?? 0), 0);
    
    return doc.messages;
  }

  /**
   * Evaluates a function call from the AI.
   * Safely parses arguments to prevent crashes due to malformed JSON.
   * @param {Object} toolCall - The tool call object from OpenAI.
   * @returns {Promise<any>} The result of the function call.
   */
  async evaluateFunctionCall(toolCall) {
    if (!toolCall || !toolCall.function) {
      return Promise.reject(new Error('Invalid tool call object'));
    }

    const name = toolCall.function.name;
    const functionData = this._functionMap.get(name);

    if (!functionData || !functionData.handler) {
      return Promise.reject(new Error(`Unknown function: ${name}`));
    }

    const { handler, contextName } = functionData;

    let args = {};
    if (toolCall.function.arguments && toolCall.function.arguments.trim()) {
      args = JSON.parse(toolCall.function.arguments);
    }

    const result = handler(args);
    return result instanceof Promise ? result : Promise.resolve(result);
  }

  /**
   * Prepares messages for the OpenAI API by removing custom fields
   * @param {Array} messages - The messages to prepare
   * @param keepImage
   * @returns {Array} The prepared messages
   * @private
   */
  _prepareMessagesForApi(messages, keepImage = false) {
    if (!messages || !Array.isArray(messages)) {
      return [];
    }

    return messages.map(msg => {
      const apiMsg = { role: msg.role, content: msg.content };

      if (msg.tool_call_id) apiMsg.tool_call_id = msg.tool_call_id;
      if (msg.type) apiMsg.type = msg.type;
      if (msg.name) apiMsg.name = msg.name;
      if (msg.tool_calls) apiMsg.tool_calls = msg.tool_calls;
      
      if (!keepImage && msg.role === 'user' && Array.isArray(msg.content)) {
        const textObject = msg.content.find(o => o.type === 'text');
        if (textObject) {
          apiMsg.content = textObject.text;
        } else {
          throw system.mkError('No text content found in message content array', msg);
        }
      }
      return apiMsg;
    });
  }

  
  /**
   * Sends a user message (text and/or image) to the AI and gets a response
   * @param {string|null} userInput - The text part of the user message
   * @returns {Promise<Object>} The assistant's response message
   */
  async offerUserMessage(userInput) {
    if (!(userInput && typeof userInput === 'string' && userInput.trim())) {
      throw new Error('Must provide user input');
    }
    
    const messages = await this.append({ role: 'user', content: userInput});
    const messagesToSend = this._prepareMessagesForApi(messages);
    const hasFunctions = this._functionDefs && this._functionDefs.length > 0;
    
    const res = await this.client.chat.completions.create({
      model: this._model,
      messages: messagesToSend,
      tools: hasFunctions ? this._functionDefs : undefined,
      tool_choice: hasFunctions ? "auto" : undefined
    });
    
    if (!res || !res.choices || !res.choices[0] || !res.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }
    
    const assistantMsg = res.choices[0].message;
    await this.append(assistantMsg);
    
    return assistantMsg;
  }
  
  
  async offerUserImage(userInput, imageUrl) {
    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }
    
    const messages = await this.append({
      role: 'user', content: [
        {type: 'text', text: userInput || 'analyse this picture'},
        {type: 'image_url', image_url: { url: imageUrl }}
    ]});
    
    const messagesToSend = this._prepareMessagesForApi(messages, true);
    const hasFunctions = this._functionDefs && this._functionDefs.length > 0;

    const res = await this.client.chat.completions.create({
      model: "gpt-4o",
      messages: messagesToSend,
      tools: hasFunctions ? this._functionDefs : undefined,
      tool_choice: hasFunctions ? "auto" : undefined
    });

    if (!res || !res.choices || !res.choices[0] || !res.choices[0].message) {
      throw system.mkError('Invalid response from OpenAI API', res);
    }

    const assistantMsg = res.choices[0].message;
    await this.append(assistantMsg);

    return assistantMsg;
  }

  
  /**
   * Sends function results back to the AI to get a response
   * @param {Array} calls - The function calls that were made
   * @param {Array} results - The results of the function calls
   * @returns {Promise<Object>} The assistant's response message
   */
  async offerFunctionResult(calls, results) {
    if (!calls || !Array.isArray(calls) || !results || !Array.isArray(results)) {
      throw new Error('Invalid calls or results arrays');
    }

    for (let i = 0; i < calls.length; i++) {
      if (!calls[i] || !calls[i].id) continue;

      const toolResult = {
        role: 'tool',
        type: 'function_call_output',
        tool_call_id: calls[i].id,
        content: typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i])
      };

      if (calls[i].contextName) {
        toolResult.context = calls[i].contextName;
        await this.append(toolResult, true);
      } else {
        await this.append(toolResult);
      }
    }

    // Load the latest conversation data
    const doc = await firestore.read(STORE_NAME, makeKey(this._contextId));
    if (!doc || !Array.isArray(doc.messages)) {
      throw new Error('Conversation document not available');
    }

    const messagesToSend = this._prepareMessagesForApi(doc.messages);

    const res = await this.client.chat.completions.create({
      model: this._model,
      messages: messagesToSend
    });

    if (!res || !res.choices || !res.choices[0] || !res.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }

    const assistantMsg = res.choices[0].message;
    await this.append(assistantMsg);

    return assistantMsg;
  }

  
   /**
    * Main conversation method that processes user inputs (text and/or image) and returns the AI response
    * @param {string|null} userInput - The text part of the user's message
    * @param {string|null} imageUrl - The URL of an image to include
    * @returns {Promise<string>} The AI's response content
    */
  async converse(userInput, imageUrl = null) {
    let assistantMessage
    if(imageUrl) {
      assistantMessage = await this.offerUserImage(userInput, imageUrl);
    } else {
      assistantMessage = await this.offerUserMessage(userInput);
    }

    let content = [assistantMessage.content];
    
    if (assistantMessage.tool_calls?.length) {
      const calls = assistantMessage.tool_calls;
      const results = [];
      
      for (const call of calls) {
        try {
          const result = await this.evaluateFunctionCall(call);
          results.push(result);
        } catch (e) {
          system.logError('Error evaluating function call', e, call);
          results.push('Error: ' + e.message);
        }
      }
      
      assistantMessage = await this.offerFunctionResult(calls, results);
      content.push(assistantMessage.content);
    }

    return content.join('\n\n');
  }
  
  
  /**
   * Checks if a conversation context exists.
   * @returns {Promise<boolean>} True if the context exists, false otherwise.
   */
  async contextExists() {
    const doc = await firestore.read(STORE_NAME, makeKey(this._contextId));
    return !!(doc && Array.isArray(doc.messages));
  }

  
  /**
   * Sets a named context in the conversation.
   * @param {string} name - The name of the context.
   * @param {string} value - The value to store in the context.
   * @param {boolean} [overwrite=false] - Whether to overwrite existing contexts with the same name.
   * @returns {Promise<void>}
   */
  setContext(name, value, overwrite = false) {
    this.append({
      role: 'system', 
      content: `#${name}\n\n${value}"}`,
      context: name
    }, overwrite).then(() => this.saveConversation());
  }
}

module.exports = OpenAiDriver;
