require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const twilio = require('twilio')
const path = require('path');;

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

// Local Memory Storage
const activeSessions = {};

app.post('/api/triage', async (req, res) => {
    const { userInput, sessionId } = req.body;

    // Initialize state if new customer
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
        // STEP 1: Diagnose Service locally via keyword matching
        if (!session.diagnosed_service) {
            if (input.includes('internet')) session.diagnosed_service = "Internet Time (Per Hour)";
            else if (input.includes('cv') || input.includes('typing')) session.diagnosed_service = "CV & Professional Writing";
            else if (input.includes('psira') || input.includes('school') || input.includes('job')) session.diagnosed_service = "Online Applications (PSIRA, School, Jobs)";
            else if (input.includes('sars') || input.includes('tax')) session.diagnosed_service = "SARS e-filing";
            
            if (session.diagnosed_service) {
                response_message = `Sure thing! ${session.diagnosed_service} is R${PRICING_DB[session.diagnosed_service]}. To secure your ticket in the queue, could you please tell me your Name and WhatsApp number?`;
            }
        } 
        // STEP 2: Extract Contact Info locally
        else if (!session.is_complete) {
            // Regex to find a standard SA number (e.g., +27712345678)
            const phoneMatch = userInput.match(/(\+27\d{9})/);
            if (phoneMatch) session.whatsapp_number = phoneMatch[0];

            // Simple logic to grab the name
            if (input.includes("i'm ") || input.includes("i am ")) {
                const words = userInput.split(' ');
                const nameIndex = words.findIndex(w => w.toLowerCase().includes("i'm") || w.toLowerCase().includes("am")) + 1;
                if (words[nameIndex]) session.customer_name = words[nameIndex].replace(/[^a-zA-Z]/g, '');
            } else if (!session.customer_name && userInput.length > 2 && !phoneMatch) {
                // Fallback: grabs the first word they type as their name
                session.customer_name = userInput.split(' ')[0].replace(/[^a-zA-Z]/g, '');
            }

            if (session.customer_name && session.whatsapp_number) {
                session.is_complete = true;
                response_message = `Thank you, ${session.customer_name}! Your ticket is queued. Buntu or a staff member will be in touch shortly.`;
            } else if (session.whatsapp_number && !session.customer_name) {
                response_message = "Got the number! Could you also provide your name?";
            } else {
                response_message = "Please ensure your WhatsApp number is formatted with +27 so we can secure the ticket.";
            }
        }

        // Build the final JSON matching our original AI structure
        const agentData = {
            response_message: response_message,
            diagnosed_service: session.diagnosed_service,
            customer_name: session.customer_name,
            whatsapp_number: session.whatsapp_number,
            is_complete: session.is_complete
        };

        // STEP 3: Execution Logic (Only runs once)
        if (agentData.is_complete && !session.executed) {
            agentData.verified_price = PRICING_DB[agentData.diagnosed_service];
            session.executed = true; 
            
            // Log to Google Sheets
            await sheets.spreadsheets.values.append({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'SessionID!A:F',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[sessionId, new Date().toISOString(), agentData.customer_name, agentData.whatsapp_number, agentData.diagnosed_service, agentData.verified_price]] }
            });

            // Send Admin Email
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: 'universalconnexionz@gmail.com',
                subject: `New ConnectBot Ticket: ${agentData.diagnosed_service}`,
                text: `New Ticket ID: ${sessionId}\nCustomer: ${agentData.customer_name}\nWhatsApp: ${agentData.whatsapp_number}\nService: ${agentData.diagnosed_service}\nQuoted Price: R${agentData.verified_price}`
            }, (err) => { if(err) console.error("Email Error:", err); else console.log("Admin Alert Sent"); });

            // Send WhatsApp SLA
            const whatsappMsg = `Molo ${agentData.customer_name}! BBL Universal Connexionz has received your request for ${agentData.diagnosed_service}. An employee will be in touch within 30 minutes.`;
            await twilioClient.messages.create({
                body: whatsappMsg,
                from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
                to: `whatsapp:${agentData.whatsapp_number}`
            }).then(() => console.log("WhatsApp SLA Sent")).catch(err => console.error("Twilio Error:", err));
        }
        
        res.json(agentData);

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: "System offline. Please see staff." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BBL ConnectBot running on port ${PORT}`));