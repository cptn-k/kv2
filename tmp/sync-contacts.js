#!/usr/bin/env osascript -l JavaScript

const Contacts = Application('Contacts');
const groups = Contacts.groups();

console.log('Available contact lists:\n');
groups.forEach((g, i) => {
  console.log(`${i + 1}: ${g.name()}`);
});

const people = Contacts.people();
console.log(`Reading ${people.length} contacts...\n`);
const result = [];

people.forEach((p, i) => {
  if (i % 10 === 0) console.log(`Processed ${i} contacts...`);
  result.push({
    firstName: p.firstName(),
    lastName: p.lastName(),
    nickname: p.nickname(),
    title: p.jobTitle(),
    notes: p.note(),
    emails: p.emails().map(e => e.value()),
    phones: p.phones().map(ph => ph.value())
  });
});

const path = './contacts.json';
const text = JSON.stringify(result, null, 2);

// File writing section fixed
try {
  // Import necessary module from ObjC for file handling.
  ObjC.import('Foundation');

  const fileManager = $.NSFileManager.defaultManager;
  const filePath = $(path).stringByStandardizingPath;
  const fileData = $(text).dataUsingEncoding($.NSUTF8StringEncoding);

  if (!fileManager.fileExistsAtPath(filePath)) {
    fileManager.createFileAtPathContentsAttributes(filePath, fileData, $());
  } else {
    const fileHandle = $.NSFileHandle.fileHandleForWritingAtPath(filePath);
    fileHandle.truncateFileAtOffset(0);
    fileHandle.writeData(fileData);
    fileHandle.closeFile();
  }

  console.log(`Saved ${result.length} contacts to ${path}`);
} catch (error) {
  console.error(`Error saving contacts to file: ${error.message}`);
}