const { Firestore } = require('@google-cloud/firestore');

/**
 * Firestore implementation with transaction support to prevent concurrent reads/writes
 * on the same document. All operations that read and then modify documents use
 * Firestore transactions to ensure data consistency and prevent race conditions.
 * 
 * @see https://firebase.google.com/docs/firestore/manage-data/transactions
 */

const { client_email, private_key } = JSON.parse(process.env.GCP_CREDENTIALS || '{}');
const instance = new Firestore({
  projectId: process.env.GCP_PROJECT,
  credentials: { client_email, private_key }
});


/**
 * Writes data to a document using a Firestore transaction to avoid concurrent operations.
 * @param {string} collection - The collection name
 * @param {string} docId - The document ID
 * @param {object} data - Data to write
 * @returns {Promise<void>}
 */
async function writeDocument(collection, docId, data) {
  const docRef = instance.collection(collection).doc(docId);

  return instance.runTransaction(async (transaction) => {
    transaction.set(docRef, data);
  });
}


/**
 * Reads a document using a Firestore transaction to ensure consistency.
 * @param {string} collection - The collection name
 * @param {string} docId - The document ID
 * @returns {Promise<object|null>} Document data or null if not found
 */
async function readDocument(collection, docId) {
  const docRef = instance.collection(collection).doc(docId);

  return instance.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    if (!doc.exists) {
      return null;
    }

    return doc.data();
  });
}


/**
 * Queries documents in a collection based on a top-level field value.
 * @param {string} collection - The collection to query
 * @param {string} field - The top-level field to query on
 * @param {any} value - The value to match
 * @returns {Promise<Array>} Array of matching documents with their IDs
 */
function queryDocuments(collection, field, value) {
  return instance
    .collection(collection)
    .where(field, '==', value)
    .get()
    .then(snapshot =>
      snapshot.docs.map(doc => ({ _id: doc.id , ...doc.data() }))
    );
}


const listDocuments = async (collection, limit = 100, offset = 0) => {
  const snapshot = await instance.collection(collection)
    .limit(limit + offset)
    .get();
  // Skip offset docs and return rest
  return snapshot.docs.slice(offset).map(doc => ({ id: doc.id, ...doc.data() }));
};


/**
 * Deletes a document from a collection
 * @param {string} collection - The collection containing the document
 * @param {string} docId - The ID of the document to delete
 * @returns {Promise<void>}
 */
function deleteDocument(collection, docId) {
  return instance.collection(collection).doc(docId).delete();
}


/**
 * Queries documents in a collection based on a field within a range of values.
 * @param {string} collection - The collection to query
 * @param {string} field - The field to query on
 * @param {string} operator1 - First comparison operator ('>=', '>', '<=', '<')
 * @param {any} value1 - First comparison value
 * @param {string} operator2 - Second comparison operator
 * @param {any} value2 - Second comparison value
 * @returns {Promise<Array>} Array of matching documents with their IDs
 */
function rangeQuery(collection, field, operator1, value1, operator2, value2) {
  return instance
    .collection(collection)
    .where(field, operator1, value1)
    .where(field, operator2, value2)
    .get()
    .then(snapshot =>
      snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    );
}


/**
 * Performs a read-modify-write operation atomically using a transaction.
 * @param {string} collection - The collection name
 * @param {string} docId - The document ID
 * @param {function} updateFn - Function that receives current data and returns new data
 * @returns {Promise<object>} The updated document data
 */
async function updateDocument(collection, docId, updateFn) {
  const docRef = instance.collection(collection).doc(docId);

  return instance.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    // Get current data or empty object if document doesn't exist
    const currentData = doc.exists ? doc.data() : {};

    // Apply the update function to get new data
    const newData = updateFn(currentData);

    // Write the updated data
    transaction.set(docRef, newData);

    return newData;
  });
}




const firestore = {
  write: writeDocument,
  read: readDocument,
  query: queryDocuments,
  delete: deleteDocument,
  rangeQuery: rangeQuery,
  update: updateDocument,
  instance: instance,
  list: listDocuments
};


module.exports = firestore;