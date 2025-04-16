const { NodeSSH } = require('node-ssh');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LOG_FILE = path.join(__dirname, 'modem_reset.log');

/**
 * Logs a message to console and log file
 * @param {string} message - Message to log
 */
const log = (message) => {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${message}`;
    console.log(logMessage);
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
};

/**
 * Mock implementation of modem reset for testing
 * @returns {Promise<boolean>} - Always returns true
 */
async function mockResetModem() {
    log('MOCK MODE: Simulating modem reset...');

    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    log('MOCK MODE: Connection to modem established');
    log('MOCK MODE: Sending reboot command');

    // Simulate command execution delay
    await new Promise(resolve => setTimeout(resolve, 500));

    log('MOCK MODE: Reboot command accepted');
    log('MOCK MODE: Modem is rebooting (simulated)');
    log('MOCK MODE: Modem should be back online in 1-2 minutes (simulated)');

    return true;
}

/**
 * Resets the modem using SSH
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
async function resetModem() {
    // Check if we should use mock mode (for testing)
    if (process.env.MOCK_MODEM === 'true') {
        return mockResetModem();
    }

    const { MODEM_IP, USERNAME, PASSWORD } = process.env;

    // Validate environment variables
    if (!MODEM_IP || !USERNAME || !PASSWORD) {
        log('Error: Missing required environment variables (MODEM_IP, USERNAME, or PASSWORD)');
        return false;
    }

    log(`Attempting to connect to modem at ${MODEM_IP}...`);

    const ssh = new NodeSSH();

    try {
        // Connect to the modem
        await ssh.connect({
            host: MODEM_IP,
            username: USERNAME,
            password: PASSWORD,
            readyTimeout: 30000, // 30 seconds
            timeout: 30000,
            tryKeyboard: false,
            keepaliveInterval: 1000,
            onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
                if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
                    finish([PASSWORD]);
                }
            }
        });

        log('SSH connection established, sending reboot command...');

        // Execute reboot command
        const result = await ssh.execCommand('reboot', {
            onStdout: (chunk) => {
                log(`SSH stdout: ${chunk.toString('utf8')}`);
            },
            onStderr: (chunk) => {
                log(`SSH stderr: ${chunk.toString('utf8')}`);
            }
        }).catch(error => {
            // If connection drops immediately, the modem might be rebooting
            if (error.message.includes('disconnected') || error.code === 'ECONNRESET') {
                log('Connection lost, which is expected during reboot. Modem is likely rebooting.');
                return { code: 0 };
            }
            throw error;
        });

        // Ensure to close connection
        ssh.dispose();

        // Check result
        if (result && (result.code === 0 || !result.code)) {
            log('Reset command sent successfully. Modem is rebooting...');
            log('Modem should be back online in 1-2 minutes.');
            return true;
        } else {
            log(`Command failed with code: ${result ? result.code : 'unknown'}`);
            log(`Stdout: ${result ? result.stdout : 'none'}`);
            log(`Stderr: ${result ? result.stderr : 'none'}`);
            return false;
        }

    } catch (error) {
        // Handle specific SSH errors
        if (error.message.includes('All configured authentication methods failed')) {
            log('Authentication failed. Check username and password.');
        } else if (error.message.includes('connect ECONNREFUSED')) {
            log('Connection refused. Ensure SSH is enabled on the modem and the IP address is correct.');
        } else if (error.message.includes('connect ETIMEDOUT')) {
            log('Connection timed out. Check if the modem is accessible and the IP address is correct.');
        } else if (error.message.includes('disconnected') || error.code === 'ECONNRESET') {
            // This might actually be a success case if the modem disconnects immediately on reboot
            log('Connection reset/disconnected. This might indicate the modem is rebooting.');
            return true;
        } else {
            log(`SSH error: ${error.message}`);
        }

        // Clean up
        ssh.dispose();
        return false;
    }
}

// Export for use in other modules
module.exports = { resetModem };

// If called directly, execute reset
if (require.main === module) {
    resetModem()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            log(`Unhandled error: ${error.message}`);
            process.exit(1);
        });
} 