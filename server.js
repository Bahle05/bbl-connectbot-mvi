require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize External Services
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

const PRICING_DB = {
    "SARS e-filing": 40,
    "Online Applications (PSIRA, School, Jobs)": 25,
    "CV & Professional Writing": 30,
    "Printing & Photocopying": 3,
    "Photo Printing": 15,
    "FAX Services": 10,
    "Professional Headshots": 40,
    "Internet Time (Per Hour)": 15
};

const activeSessions = {};

app.post('/api/triage', async (req, res) => {
    const { userInput, sessionId } = req.body;

    if (!activeSessions[sessionId]) {
        activeSessions[sessionId] = {
            diagnosed_service: null,
            customer_name: null,
            whatsapp_number: null,
            is_complete: false,
            executed: false
        };
    }
    
    let session = activeSessions[sessionId];
    const input = userInput.toLowerCase();
    let response_message = "I am not sure I understand. Could you specify if you need Internet Time, CV Typing, or an Online Application?";

    try {
        // STEP 1: Diagnose Service
        if (!session.diagnosed_service) {
            if (input.includes('internet')) session.diagnosed_service = "Internet Time (Per Hour)";
            else if (input.includes('cv') || input.includes('typing')) session.diagnosed_service = "CV & Professional Writing";
            else if (input.includes('psira') || input.includes('school') || input.includes('job')) session.diagnosed_service = "Online Applications (PSIRA, School, Jobs)";
            else if (input.includes('sars') || input.includes('tax')) session.diagnosed_service = "SARS e-filing";
            
            if (session.diagnosed_service) {
                response_message = `Sure thing! ${session.diagnosed_service} is R${PRICING_DB[session.diagnosed_service]}. To secure your ticket in the queue, could you please tell me your Name and WhatsApp number?`;
            }
        } 
        // STEP 2: Extract Contact Info (Upgraded Extraction)
        else if (!session.is_complete) {
            const phoneMatch = userInput.match(/(\+27\d{9})/);
            if (phoneMatch) session.whatsapp_number = phoneMatch[0];

            // Strips out the phone number and grabs the remaining word as the name
            const textWithoutPhone = userInput.replace(/(\+27\d{9})/, '').replace(/[^a-zA-Z\s]/g, '').trim();
            if (textWithoutPhone.length > 1 && !session.customer_name) {
                session.customer_name = textWithoutPhone.split(' ')[0];
            }

            if (session.customer_name && session.whatsapp_number) {
                session.is_complete = true;
                response_message = `Thank you, ${session.customer_name}! Your ticket is queued. Buntu or a staff member will be in touch shortly.`;
            } else if (session.whatsapp_number && !session.customer_name) {
                response_message = "Got the number! Could you also provide your name?";
            } else if (session.customer_name && !session.whatsapp_number) {
                response_message = `Got it, ${session.customer_name}. Please provide your WhatsApp number starting with +27.`;
            } else {
                response_message = "Please ensure your WhatsApp number is formatted with +27 so we can secure the ticket.";
            }
        }

        const agentData = {
            response_message: response_message,
            diagnosed_service: session.diagnosed_service,
            customer_name: session.customer_name,
            whatsapp_number: session.whatsapp_number,
            is_complete: session.is_complete
        };

        // STEP 3: Bulletproof Execution Logic
        if (agentData.is_complete && !session.executed) {
            agentData.verified_price = PRICING_DB[agentData.diagnosed_service];
            session.executed = true; 
            
            // 1. Safe Google Sheets Logging (Changed range to default 'Sheet1!A:F')
            try {
                await sheets.spreadsheets.values.append({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: 'Sheet1!A:F', 
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[sessionId, new Date().toISOString(), agentData.customer_name, agentData.whatsapp_number, agentData.diagnosed_service, agentData.verified_price]] }
                });
            } catch (sheetErr) {
                console.error("Sheets Error:", sheetErr.message);
            }

            // 2. Safe Email Alert
            try {
                transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: 'universalconnexionz@gmail.com',
                    subject: `New ConnectBot Ticket: ${agentData.diagnosed_service}`,
                    text: `New Ticket ID: ${sessionId}\nCustomer: ${agentData.customer_name}\nWhatsApp: ${agentData.whatsapp_number}\nService: ${agentData.diagnosed_service}\nQuoted Price: R${agentData.verified_price}`
                });
            } catch (emailErr) {
                console.error("Email Error:", emailErr.message);
            }

            // 3. Safe WhatsApp SLA
            try {
                const whatsappMsg = `Molo ${agentData.customer_name}! BBL Universal Connexionz has received your request for ${agentData.diagnosed_service}. An employee will be in touch within 30 minutes.`;
                await twilioClient.messages.create({
                    body: whatsappMsg,
                    from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
                    to: `whatsapp:${agentData.whatsapp_number}`
                });
            } catch (twilioErr) {
                console.error("Twilio Error:", twilioErr.message);
            }
        }
        
        res.json(agentData);

    } catch (error) {
        console.error("Backend Fatal Error:", error);
        res.status(500).json({ error: "System offline. Please see staff." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BBL ConnectBot MVI running on port ${PORT}`));