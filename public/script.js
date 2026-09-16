// 1. Session Initialization
let sessionId = localStorage.getItem('bbl_session_id');
if (!sessionId) {
    sessionId = 'BBL-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('bbl_session_id', sessionId);
}
// Display the Session ID in the UI header
document.getElementById('session-display').innerText = `Ticket ID: ${sessionId}`;

const chatBox = document.getElementById('chat-box');
const typingIndicator = document.getElementById('typing');

// 2. UI Message Rendering
function appendMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    msgDiv.classList.add(sender === 'You' ? 'msg-user' : 'msg-bot');
    msgDiv.innerText = text;
    
    // Insert before the typing indicator
    chatBox.insertBefore(msgDiv, typingIndicator);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 3. API Communication Pipeline
async function sendRequest(userInput) {
    appendMessage("You", userInput);
    document.getElementById('user-input').value = '';
    
    // Show typing indicator and update system status
    typingIndicator.style.display = 'block';
    document.getElementById('state-status').innerHTML = '<span class="action-badge">Processing Natural Language...</span>';
    chatBox.scrollTop = chatBox.scrollHeight;
    
    try {
        const response = await fetch('/api/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userInput, sessionId })
        });
        
        const data = await response.json();
        typingIndicator.style.display = 'none';
        
        // AGENT UI UPDATE: Visually bind the JSON data to the state panel
        if (data.diagnosed_service) {
            const srvElem = document.getElementById('state-service');
            srvElem.innerText = data.diagnosed_service;
            srvElem.className = 'resolved';
        }
        if (data.customer_name) {
            const nameElem = document.getElementById('state-name');
            nameElem.innerText = data.customer_name;
            nameElem.className = 'resolved';
        }
        if (data.whatsapp_number) {
            const phoneElem = document.getElementById('state-phone');
            phoneElem.innerText = data.whatsapp_number;
            phoneElem.className = 'resolved';
        }

        // Update the System Action Status
        if (data.is_complete) {
            document.getElementById('state-status').innerHTML = '<span class="action-badge action-success">✓ Executing APIs (Sheets/Email/SMS)</span>';
        } else if (data.diagnosed_service) {
            document.getElementById('state-status').innerHTML = '<span class="action-badge">Extracting Contact Info</span>';
        } else {
            document.getElementById('state-status').innerHTML = '<span class="action-badge">Awaiting Clarification</span>';
        }
        
        appendMessage("ConnectBot", data.response_message || data.error);
        
    } catch (error) {
        typingIndicator.style.display = 'none';
        document.getElementById('state-status').innerHTML = '<span class="action-badge" style="background:red;color:white;">Connection Failed</span>';
        appendMessage("System", "Connection lost. Please check the café's Wi-Fi.");
    }
}

// 4. Event Listeners
document.getElementById('btn-sars').addEventListener('click', () => sendRequest("I need help with SARS e-filing"));
document.getElementById('btn-school').addEventListener('click', () => sendRequest("I need to apply for a school online"));
document.getElementById('btn-cv').addEventListener('click', () => sendRequest("I need my CV typed"));

function handleManualInput() {
    const input = document.getElementById('user-input').value.trim();
    if (input) sendRequest(input);
}

function handleEnter(event) {
    if (event.key === 'Enter') {
        handleManualInput();
    }
}

// 5. Session Management
function resetSession() {
    // Wipe the saved Ticket ID from the browser's memory
    localStorage.removeItem('bbl_session_id');
    
    // Hard refresh the page to clear the chat UI and generate a new ID
    window.location.reload();
}