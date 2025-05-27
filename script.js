/*
 * Lead Management Automation
 * 
 * Automatically handles new leads from our Google Sheet:
 * - Sends team notifications to Slack
 * - Emails welcome message to prospects
 * 
 * ONLY TRIGGERS when ALL fields are filled in a row
 */


let isProcessingLead = false;

const WELCOME_EMAIL_SUBJECT = "Thanks for reaching out!";
const WELCOME_EMAIL_BODY = `
Hi {NAME},

Thanks for your interest in our services! We're excited to learn more about your needs.

Your information:
• Company: {COMPANY}
• Phone: {PHONE}
• How you found us: {SOURCE}

Someone from our team will be in touch within 24 hours to discuss how we can help.

Best regards,
The Sales Team
`;

function getSlackSettings() {
  try {
    return {
      token: PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN'),
      channel: PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID')
    };
  } catch (error) {
    console.error('Problem loading Slack settings:', error);
    return { token: null, channel: null };
  }
}

// Initial setup - run this once
function setupLeadAutomation() {
  console.log('Setting up lead automation...');
  
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let leadsSheet;
    
    try {
      leadsSheet = spreadsheet.getSheetByName('Leads');
    } catch (e) {
      leadsSheet = spreadsheet.insertSheet('Leads');
    }
    
    if (leadsSheet.getLastRow() === 0) {
      leadsSheet.getRange(1, 1, 1, 7).setValues([
        ['Name', 'Email', 'Company', 'Phone', 'Source', 'Status', 'Processed Date']
      ]);
      
      leadsSheet.getRange(2, 1, 3, 5).setValues([
        ['John Smith', 'john@acmecorp.com', 'Acme Corp', '555-0123', 'Website'],
        ['Sarah Johnson', 'sarah@techstart.com', 'TechStart Inc', '555-0456', 'Referral'],
        ['Mike Wilson', 'mike@consulting.com', 'Wilson Consulting', '555-0789', 'LinkedIn']
      ]);
      
      console.log('Sample data added to sheet');
    }
    
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'onEdit') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    
    ScriptApp.newTrigger('onEdit')
      .forSpreadsheet(spreadsheet)
      .onEdit()
      .create();
    console.log('Fresh automation trigger installed');
    
    console.log('Setup complete!');
    console.log('Next: Configure Slack settings in Script Properties');
    
  } catch (error) {
    console.error('Setup failed:', error);
  }
}

function grantPermissions() {
  try {
    const user = Session.getActiveUser().getEmail();
    console.log('Current user:', user);
    
    const drafts = GmailApp.getDrafts();
    console.log('Gmail access OK. Drafts found:', drafts.length);
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    console.log('Spreadsheet access OK. URL:', ss.getUrl());
    
    console.log('All permissions granted!');
    
  } catch (error) {
    console.error('Permission error:', error.message);
    console.log('Please authorize when prompted');
  }
}

// FIXED: Main function - triggers when someone edits the sheet
function onEdit(e) {
  if (isProcessingLead) {
    console.log('🔄 Script is processing, ignoring edit event');
    return;
  }
  
  try {
    if (!e || !e.range || !e.source) {
      console.log('⚠️ Invalid edit event, ignoring');
      return;
    }
    
    const range = e.range;
    const sheet = range.getSheet();
    const editedRow = range.getRow();
    const editedCol = range.getColumn();
    
    if (sheet.getName() !== 'Leads') {
      console.log('📝 Edit not on Leads sheet, ignoring');
      return;
    }
    
    if (editedRow <= 1) {
      console.log('📋 Header row edited, ignoring');
      return;
    }
    
    if (editedCol >= 6) {
      console.log('🚫 Status column edited (script-generated), ignoring');
      return;
    }
    
    console.log(`📍 Processing edit in row ${editedRow}, column ${editedCol}`);
    
    if (!isRowComplete(sheet, editedRow)) {
      console.log(`⏳ Row ${editedRow} is not complete yet, waiting for all fields`);
      return;
    }
    
    const leadInfo = extractLeadInfo(sheet, editedRow);
    
    if (!isValidLead(leadInfo)) {
      console.log('❌ Lead data validation failed, skipping');
      return;
    }
    
    if (hasBeenProcessed(sheet, editedRow)) {
      console.log('✅ Lead already processed, skipping');
      return;
    }
    
    if (isDuplicate(sheet, leadInfo, editedRow)) {
      console.log('🔄 Duplicate email detected, skipping');
      return;
    }
    
    console.log('🎯 Processing complete lead:', leadInfo.name);
    
    isProcessingLead = true;
    
    handleNewLead(leadInfo);
    
    markAsProcessed(sheet, editedRow);
    
    console.log('✅ Lead processing complete');
    
  } catch (error) {
    console.error('💥 Error processing lead:', error);
    if (e && e.source) {
      recordError(e.source.getActiveSheet(), error, 'onEdit');
    }
  } finally {
    isProcessingLead = false;
  }
}

function isRowComplete(sheet, row) {
  try {
    const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
    
    for (let i = 0; i < 5; i++) {
      const value = values[i];
      if (!value || value.toString().trim() === '') {
        console.log(`📝 Row ${row}, Column ${i + 1} is empty: "${value}"`);
        return false;
      }
    }
    
    console.log(`✅ Row ${row} is complete with all fields filled`);
    return true;
    
  } catch (error) {
    console.error('Error checking row completion:', error);
    return false;
  }
}

function hasBeenProcessed(sheet, row) {
  try {
    const processedValue = sheet.getRange(row, 6).getValue();
    const isProcessed = processedValue === 'PROCESSED';
    
    if (isProcessed) {
      console.log(`✅ Row ${row} already marked as PROCESSED`);
    }
    
    return isProcessed;
    
  } catch (error) {
    console.error('Error checking processed status:', error);
    return false; // If we can't check, allow processing
  }
}

function markAsProcessed(sheet, row) {
  try {
    // Add "PROCESSED" to column F
    sheet.getRange(row, 6).setValue('PROCESSED');
    sheet.getRange(row, 7).setValue(new Date()); // Add timestamp in column G
    console.log(`✅ Row ${row} marked as processed`);
  } catch (error) {
    console.error('Could not mark row as processed:', error);
  }
}

function extractLeadInfo(sheet, row) {
  const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
  
  return {
    name: values[0] || '',
    email: values[1] || '',
    company: values[2] || '',
    phone: values[3] || '',
    source: values[4] || '',
    row: row,
    timestamp: new Date()
  };
}

function isValidLead(leadInfo) {
  if (!leadInfo.name || !leadInfo.email || !leadInfo.company || !leadInfo.phone || !leadInfo.source) {
    console.log('Missing required fields');
    return false;
  }
  
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(leadInfo.email)) {
    console.log('Invalid email format:', leadInfo.email);
    return false;
  }
  
  return true;
}

function isDuplicate(sheet, leadInfo, currentRow) {
  try {
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    for (let i = 1; i < values.length; i++) {
      const rowNumber = i + 1;
      
      // Skip current row
      if (rowNumber === currentRow) continue;
      
      const existingEmail = values[i][1];
      const isProcessed = values[i][5] === 'PROCESSED';
      
      if (existingEmail && 
          existingEmail.toString().toLowerCase() === leadInfo.email.toLowerCase() && 
          isProcessed) {
        console.log(`🔄 Duplicate found: Row ${rowNumber} already processed this email`);
        return true;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error('Error checking duplicates:', error);
    return false; // If we can't check, allow processing
  }
}

function handleNewLead(leadInfo) {
  const results = {
    slackSent: false,
    emailSent: false,
    errors: []
  };
  
  try {
    notifyTeam(leadInfo);
    results.slackSent = true;
    console.log('📢 Team notified successfully');
  } catch (error) {
    console.error('Failed to notify team:', error);
    results.errors.push('Slack: ' + error.message);
  }
  
  try {
    emailProspect(leadInfo);
    results.emailSent = true;
    console.log('📧 Welcome email sent');
  } catch (error) {
    console.error('Failed to send email:', error);
    results.errors.push('Email: ' + error.message);
  }
  
  if (results.errors.length > 0) {
    console.warn('⚠️ Some issues occurred:', results.errors);
  } else {
    console.log('🎉 Lead processed successfully!');
  }
}

function notifyTeam(leadInfo) {
  const settings = getSlackSettings();
  
  if (!settings.token || !settings.channel) {
    throw new Error('Slack not configured. Check Script Properties.');
  }
  
  let sheetUrl = null;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      sheetUrl = ss.getUrl();
    }
  } catch (error) {
    console.log('Could not get sheet URL:', error.message);
  }
  
  const message = {
    channel: settings.channel,
    text: `New Complete Lead: ${leadInfo.name}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎯 New Complete Lead"
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Name:*\n${leadInfo.name}`
          },
          {
            type: "mrkdwn",
            text: `*Email:*\n${leadInfo.email}`
          },
          {
            type: "mrkdwn",
            text: `*Company:*\n${leadInfo.company}`
          },
          {
            type: "mrkdwn",
            text: `*Phone:*\n${leadInfo.phone}`
          },
          {
            type: "mrkdwn",
            text: `*Source:*\n${leadInfo.source}`
          },
          {
            type: "mrkdwn",
            text: `*Time:*\n${leadInfo.timestamp.toLocaleString()}`
          }
        ]
      }
    ]
  };
  
  if (sheetUrl) {
    message.blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Sheet"
          },
          url: sheetUrl,
          style: "primary"
        }
      ]
    });
  }
  
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.token}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(message)
  };
  
  let attempts = 3;
  while (attempts > 0) {
    try {
      const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', options);
      const responseData = JSON.parse(response.getContentText());
      
      if (!responseData.ok) {
        if (responseData.error === 'rate_limited') {
          console.log('Rate limited, waiting...');
          Utilities.sleep(2000);
          attempts--;
          continue;
        }
        throw new Error(`Slack error: ${responseData.error}`);
      }
      
      return responseData;
    } catch (error) {
      attempts--;
      if (attempts === 0) {
        throw error;
      }
      console.log(`Slack failed, retrying... (${attempts} left)`);
      Utilities.sleep(1000);
    }
  }
}

function emailProspect(leadInfo) {
  let emailBody = WELCOME_EMAIL_BODY
    .replace(/{NAME}/g, leadInfo.name)
    .replace(/{COMPANY}/g, leadInfo.company)
    .replace(/{PHONE}/g, leadInfo.phone)
    .replace(/{SOURCE}/g, leadInfo.source);
  
  try {
    const userEmail = Session.getActiveUser().getEmail();
    
    GmailApp.sendEmail(
      leadInfo.email,
      WELCOME_EMAIL_SUBJECT,
      emailBody,
      {
        name: 'Sales Team',
        replyTo: userEmail
      }
    );
  } catch (error) {
    if (error.message.includes('quota')) {
      throw new Error('Gmail quota exceeded');
    }
    throw error;
  }
}

function recordError(sheet, error, context) {
  try {
    const spreadsheet = sheet.getParent();
    let errorSheet;
    
    try {
      errorSheet = spreadsheet.getSheetByName('Error Log');
    } catch (e) {
      errorSheet = spreadsheet.insertSheet('Error Log');
      errorSheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Context', 'Error', 'Details']]);
    }
    
    errorSheet.appendRow([
      new Date(),
      context,
      error.message,
      error.stack || 'No details'
    ]);
    
  } catch (logError) {
    console.error('Could not log error:', logError);
  }
}

function clearAllProcessedStatus() {
  console.log('🧹 Clearing all processed status...');
  
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
    if (!sheet) {
      console.log('❌ Leads sheet not found');
      return;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      console.log('No data rows to clear');
      return;
    }
    
    // Clear columns F and G for all data rows
    sheet.getRange(2, 6, lastRow - 1, 2).clearContent();
    
    console.log(`✅ Cleared processed status for ${lastRow - 1} rows`);
    
  } catch (error) {
    console.error('❌ Failed to clear status:', error);
  }
}

function resetForTesting() {
  console.log('🔄 Resetting for fresh testing...');
  
  clearAllProcessedStatus();
  
  isProcessingLead = false;
  
  setupLeadAutomation();
  
  console.log('✅ Reset complete. Try adding new leads now.');
}

function testSystem() {
  console.log('Testing lead automation...');
  
  const testLead = {
    name: 'Test Person',
    email: 'test@example.com',
    company: 'Test Company',
    phone: '555-TEST',
    source: 'Manual Test',
    row: 999,
    timestamp: new Date()
  };
  
  handleNewLead(testLead);
  console.log('Test complete - check Slack and email');
}

function testSlack() {
  console.log('Testing Slack...');
  
  const settings = getSlackSettings();
  
  if (!settings.token || !settings.channel) {
    console.log('Slack not configured. Check Script Properties.');
    return;
  }
  
  const testMessage = {
    channel: settings.channel,
    text: "Test message from lead automation"
  };
  
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.token}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(testMessage)
  };
  
  try {
    const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', options);
    const responseData = JSON.parse(response.getContentText());
    
    if (responseData.ok) {
      console.log('Slack test successful!');
    } else {
      console.log('Slack test failed:', responseData.error);
    }
  } catch (error) {
    console.log('Slack error:', error.message);
  }
}

function checkConfig() {
  console.log('=== Configuration Check ===');
  
  try {
    const settings = getSlackSettings();
    
    console.log('Slack token configured:', !!settings.token);
    console.log('Slack channel configured:', !!settings.channel);
    
    if (settings.token) {
      console.log('Token format OK:', settings.token.startsWith('xoxb-'));
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    console.log('Spreadsheet accessible:', !!ss);
    
    const sheet = ss.getSheetByName('Leads');
    console.log('Leads sheet exists:', !!sheet);
    
    if (sheet) {
      console.log('Rows in sheet:', sheet.getLastRow());
    }
    
    const triggers = ScriptApp.getProjectTriggers();
    const onEditTrigger = triggers.find(t => t.getHandlerFunction() === 'onEdit');
    console.log('Automation trigger active:', !!onEditTrigger);
    
    const user = Session.getActiveUser().getEmail();
    console.log('Current user:', user);
    
    console.log('Processing flag status:', isProcessingLead);
    
    console.log('=== End Check ===');
    
  } catch (error) {
    console.error('Config check failed:', error);
  }
}