/**
 * OBS WebSocket Connector
 * Handles connection, authentication, and communication with OBS Studio via WebSocket
 * Compatible with OBS WebSocket 5.x protocol
 */

class OBSConnector {
    constructor() {
        this.ws = null;
        this.url = 'ws://localhost:4455';
        this.password = '';
        this.connected = false;
        this.identified = false;
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.eventHandlers = new Map();
        this.rpcVersion = 1;
        
        // Connection state callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;
        this.onRecordStateChanged = null;
    }

    /**
     * Generate a unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${++this.requestId}`;
    }

    /**
     * Connect to OBS WebSocket server
     * @param {string} url - WebSocket URL (default: ws://localhost:4455)
     * @param {string} password - Optional password for authentication
     * @returns {Promise<boolean>} - Resolves when connected and identified
     */
    async connect(url = 'ws://localhost:4455', password = '') {
        this.url = url;
        this.password = password;

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(url);
                
                this.ws.onopen = () => {
                    console.log('OBS WebSocket: Connection opened');
                };

                this.ws.onclose = (event) => {
                    console.log('OBS WebSocket: Connection closed', event.code, event.reason);
                    this.connected = false;
                    this.identified = false;
                    if (this.onDisconnected) {
                        this.onDisconnected(event);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('OBS WebSocket: Error', error);
                    if (this.onError) {
                        this.onError(error);
                    }
                    reject(new Error('WebSocket connection error'));
                };

                this.ws.onmessage = async (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        await this.handleMessage(message, resolve, reject);
                    } catch (e) {
                        console.error('OBS WebSocket: Failed to parse message', e);
                    }
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    async handleMessage(message, resolveConnect, rejectConnect) {
        const opCode = message.op;
        const data = message.d;

        switch (opCode) {
            case 0: // Hello
                console.log('OBS WebSocket: Received Hello', data);
                this.connected = true;
                await this.identify(data);
                break;

            case 2: // Identified
                console.log('OBS WebSocket: Identified successfully', data);
                this.identified = true;
                if (this.onConnected) {
                    this.onConnected();
                }
                resolveConnect(true);
                break;

            case 5: // Event
                this.handleEvent(data);
                break;

            case 7: // RequestResponse
                this.handleRequestResponse(data);
                break;

            case 9: // RequestBatchResponse
                console.log('OBS WebSocket: Batch response', data);
                break;

            default:
                console.log('OBS WebSocket: Unknown opcode', opCode, data);
        }
    }

    /**
     * Send Identify message to authenticate with OBS
     */
    async identify(helloData) {
        const identifyData = {
            rpcVersion: this.rpcVersion,
            eventSubscriptions: 64 // Subscribe to Output events (recording)
        };

        // Handle authentication if required
        if (helloData.authentication) {
            const authString = await this.createAuthString(
                this.password,
                helloData.authentication.salt,
                helloData.authentication.challenge
            );
            identifyData.authentication = authString;
        }

        this.sendRaw({
            op: 1, // Identify
            d: identifyData
        });
    }

    /**
     * Create authentication string using SHA256
     */
    async createAuthString(password, salt, challenge) {
        // Concatenate password + salt
        const secretString = password + salt;
        
        // SHA256 hash and base64 encode
        const secretHash = await this.sha256(secretString);
        const base64Secret = btoa(String.fromCharCode(...new Uint8Array(secretHash)));
        
        // Concatenate base64Secret + challenge
        const authString = base64Secret + challenge;
        
        // SHA256 hash and base64 encode again
        const authHash = await this.sha256(authString);
        const base64Auth = btoa(String.fromCharCode(...new Uint8Array(authHash)));
        
        return base64Auth;
    }

    /**
     * SHA256 hash function
     */
    async sha256(message) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        return await crypto.subtle.digest('SHA-256', data);
    }

    /**
     * Send raw message to WebSocket
     */
    sendRaw(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Send a request to OBS and wait for response
     * @param {string} requestType - The OBS request type
     * @param {object} requestData - Optional request data
     * @returns {Promise<object>} - The response data
     */
    async sendRequest(requestType, requestData = {}) {
        return new Promise((resolve, reject) => {
            if (!this.identified) {
                reject(new Error('Not connected to OBS'));
                return;
            }

            const requestId = this.generateRequestId();
            
            // Store the promise handlers
            this.pendingRequests.set(requestId, { resolve, reject });

            // Set a timeout for the request
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Request ${requestType} timed out`));
                }
            }, 10000);

            // Send the request
            this.sendRaw({
                op: 6, // Request
                d: {
                    requestType,
                    requestId,
                    requestData
                }
            });
        });
    }

    /**
     * Handle request responses
     */
    handleRequestResponse(data) {
        const { requestId, requestType, requestStatus, responseData } = data;
        
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            this.pendingRequests.delete(requestId);
            
            if (requestStatus.result) {
                pending.resolve(responseData || {});
            } else {
                pending.reject(new Error(`${requestType} failed: ${requestStatus.comment || 'Unknown error'} (code: ${requestStatus.code})`));
            }
        }
    }

    /**
     * Handle OBS events
     */
    handleEvent(data) {
        const { eventType, eventData } = data;
        console.log('OBS Event:', eventType, eventData);

        // Handle recording state changes
        if (eventType === 'RecordStateChanged') {
            if (this.onRecordStateChanged) {
                this.onRecordStateChanged(eventData);
            }
        }

        // Call registered event handlers
        const handlers = this.eventHandlers.get(eventType);
        if (handlers) {
            handlers.forEach(handler => handler(eventData));
        }
    }

    /**
     * Register an event handler
     */
    on(eventType, handler) {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType).push(handler);
    }

    /**
     * Remove an event handler
     */
    off(eventType, handler) {
        const handlers = this.eventHandlers.get(eventType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * Disconnect from OBS
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.identified = false;
        this.pendingRequests.clear();
    }

    // ==================== OBS Recording Controls ====================

    /**
     * Start recording
     */
    async startRecording() {
        return await this.sendRequest('StartRecord');
    }

    /**
     * Stop recording
     * @returns {Promise<object>} - Contains outputPath of the saved file
     */
    async stopRecording() {
        return await this.sendRequest('StopRecord');
    }

    /**
     * Toggle recording
     */
    async toggleRecording() {
        return await this.sendRequest('ToggleRecord');
    }

    /**
     * Get recording status
     */
    async getRecordStatus() {
        return await this.sendRequest('GetRecordStatus');
    }

    /**
     * Pause recording
     */
    async pauseRecording() {
        return await this.sendRequest('PauseRecord');
    }

    /**
     * Resume recording
     */
    async resumeRecording() {
        return await this.sendRequest('ResumeRecord');
    }

    // ==================== OBS Scene Management ====================

    /**
     * Get list of scenes
     */
    async getSceneList() {
        return await this.sendRequest('GetSceneList');
    }

    /**
     * Create a new scene
     */
    async createScene(sceneName) {
        return await this.sendRequest('CreateScene', { sceneName });
    }

    /**
     * Remove a scene
     */
    async removeScene(sceneName) {
        return await this.sendRequest('RemoveScene', { sceneName });
    }

    /**
     * Set current program scene
     */
    async setCurrentScene(sceneName) {
        return await this.sendRequest('SetCurrentProgramScene', { sceneName });
    }

    // ==================== OBS Input/Source Management ====================

    /**
     * Get list of available input kinds
     */
    async getInputKindList() {
        return await this.sendRequest('GetInputKindList');
    }

    /**
     * Create a new input (source) in a scene
     */
    async createInput(sceneName, inputName, inputKind, inputSettings = {}, sceneItemEnabled = true) {
        return await this.sendRequest('CreateInput', {
            sceneName,
            inputName,
            inputKind,
            inputSettings,
            sceneItemEnabled
        });
    }

    /**
     * Remove an input
     */
    async removeInput(inputName) {
        return await this.sendRequest('RemoveInput', { inputName });
    }

    /**
     * Get input settings
     */
    async getInputSettings(inputName) {
        return await this.sendRequest('GetInputSettings', { inputName });
    }

    /**
     * Set input settings
     */
    async setInputSettings(inputName, inputSettings, overlay = true) {
        return await this.sendRequest('SetInputSettings', {
            inputName,
            inputSettings,
            overlay
        });
    }

    // ==================== OBS Scene Item Management ====================

    /**
     * Get list of scene items in a scene
     */
    async getSceneItemList(sceneName) {
        return await this.sendRequest('GetSceneItemList', { sceneName });
    }

    /**
     * Get scene item ID by source name
     */
    async getSceneItemId(sceneName, sourceName) {
        return await this.sendRequest('GetSceneItemId', { sceneName, sourceName });
    }

    /**
     * Get scene item transform
     */
    async getSceneItemTransform(sceneName, sceneItemId) {
        return await this.sendRequest('GetSceneItemTransform', { sceneName, sceneItemId });
    }

    /**
     * Set scene item transform (position, scale, crop, etc.)
     */
    async setSceneItemTransform(sceneName, sceneItemId, sceneItemTransform) {
        return await this.sendRequest('SetSceneItemTransform', {
            sceneName,
            sceneItemId,
            sceneItemTransform
        });
    }

    /**
     * Set scene item enabled state
     */
    async setSceneItemEnabled(sceneName, sceneItemId, sceneItemEnabled) {
        return await this.sendRequest('SetSceneItemEnabled', {
            sceneName,
            sceneItemId,
            sceneItemEnabled
        });
    }

    // ==================== OBS Video Settings ====================

    /**
     * Get video settings
     */
    async getVideoSettings() {
        return await this.sendRequest('GetVideoSettings');
    }

    /**
     * Set video settings
     */
    async setVideoSettings(settings) {
        return await this.sendRequest('SetVideoSettings', settings);
    }

    // ==================== Helper Methods for Bar Chart Race ====================

    /**
     * Get list of available windows for window capture
     * @param {string} inputName - Name of an existing window_capture input to query
     * @returns {Promise<Array>} - List of available windows
     */
    async getAvailableWindows(inputName) {
        try {
            const result = await this.sendRequest('GetInputPropertiesListPropertyItems', {
                inputName: inputName,
                propertyName: 'window'
            });
            return result.propertyItems || [];
        } catch (error) {
            console.warn('OBS: Could not get available windows:', error);
            return [];
        }
    }

    /**
     * Find a window by partial title match
     * @param {Array} windows - List of available windows from OBS
     * @param {string} searchTitle - Title to search for (case-insensitive partial match)
     * @returns {object|null} - Matching window object or null
     */
    findWindowByTitle(windows, searchTitle) {
        if (!windows || !searchTitle) return null;
        
        const searchLower = searchTitle.toLowerCase();
        
        // First try exact match on itemName
        for (const win of windows) {
            if (win.itemName && win.itemName.toLowerCase().includes(searchLower)) {
                return win;
            }
        }
        
        // Then try itemValue (the actual window identifier)
        for (const win of windows) {
            if (win.itemValue && win.itemValue.toLowerCase().includes(searchLower)) {
                return win;
            }
        }
        
        return null;
    }

    /**
     * Setup automatic capture for bar chart race
     * Creates a scene, adds window capture, and configures crop
     * Simplified for popup window approach (zero-offset cropping)
     * @param {object} captureConfig - Configuration for the capture
     * @returns {Promise<object>} - Result of the setup
     */
    async setupBarChartCapture(captureConfig) {
        const {
            sceneName = 'Bar Chart Race Recording',
            inputName = 'Bar Chart Capture',
            windowTitle,
            // Target dimensions for the recording (exact output size)
            targetWidth,
            targetHeight
        } = captureConfig;

        const result = {
            success: false,
            sceneName,
            inputName,
            sceneItemId: null,
            errors: []
        };

        try {
            // Step 1: Check if scene already exists
            const sceneList = await this.getSceneList();
            const sceneExists = sceneList.scenes.some(s => s.sceneName === sceneName);

            if (!sceneExists) {
                // Create new scene
                await this.createScene(sceneName);
                console.log('OBS: Created scene', sceneName);
            } else {
                console.log('OBS: Scene already exists', sceneName);
                // Remove existing input if it exists
                try {
                    const items = await this.getSceneItemList(sceneName);
                    for (const item of items.sceneItems) {
                        if (item.sourceName === inputName) {
                            await this.removeInput(inputName);
                            console.log('OBS: Removed existing input', inputName);
                            break;
                        }
                    }
                } catch (e) {
                    // Input might not exist, that's OK
                }
            }

            // Step 2: Create window capture input
            const inputKind = 'window_capture';
            
            const initialSettings = {
                capture_cursor: false,
                client_area: true  // Capture only client area (no window chrome)
            };

            const createResult = await this.createInput(
                sceneName,
                inputName,
                inputKind,
                initialSettings,
                true
            );
            
            result.sceneItemId = createResult.sceneItemId;
            console.log('OBS: Created input', inputName, 'with ID', result.sceneItemId);

            // Switch to the scene immediately
            await this.setCurrentScene(sceneName);
            console.log('OBS: Switched to scene', sceneName);

            // Step 3: Find and select the popup window
            const availableWindows = await this.getAvailableWindows(inputName);
            console.log('OBS: Available windows:', availableWindows.map(w => w.itemName || w.itemValue));
            
            const matchingWindow = this.findWindowByTitle(availableWindows, windowTitle);
            
            if (matchingWindow) {
                console.log('OBS: Found matching window:', matchingWindow);
                
                await this.setInputSettings(inputName, {
                    window: matchingWindow.itemValue,
                    capture_cursor: false,
                    client_area: true
                });
                console.log('OBS: Updated window capture to:', matchingWindow.itemValue);
            } else {
                console.warn('OBS: Could not find window matching:', windowTitle);
                console.log('OBS: Available windows were:', availableWindows.map(w => w.itemName || w.itemValue));
                result.errors.push(`Could not find window matching "${windowTitle}". Make sure the recording popup is open.`);
            }

            // Wait for source to initialize
            console.log('OBS: Waiting for source to initialize...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Step 4: Apply crop transform (simplified for popup mode)
            if (result.sceneItemId && targetWidth && targetHeight) {
                // Get the actual source dimensions from OBS
                let sourceWidth = 0;
                let sourceHeight = 0;
                
                // Retry to get source dimensions
                const retryDelays = [500, 1000, 1500, 2000];
                for (let retry = 0; retry < retryDelays.length; retry++) {
                    const transformData = await this.getSceneItemTransform(sceneName, result.sceneItemId);
                    const transform = transformData.sceneItemTransform || transformData;
                    sourceWidth = transform.sourceWidth;
                    sourceHeight = transform.sourceHeight;
                    
                    if (sourceWidth > 0 && sourceHeight > 0) {
                        console.log(`OBS: Got source dimensions on attempt ${retry + 1}:`, { sourceWidth, sourceHeight });
                        break;
                    }
                    
                    if (retry < retryDelays.length - 1) {
                        console.log(`OBS: Source not ready (attempt ${retry + 1}), waiting...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelays[retry]));
                    }
                }
                
                console.log('OBS: Final source dimensions:', { sourceWidth, sourceHeight });
                console.log('OBS: Target dimensions:', { targetWidth, targetHeight });
                
                if (sourceWidth > 0 && sourceHeight > 0) {
                    // Calculate crop values
                    // The source includes browser chrome, so we need to crop it out
                    // Browser chrome height = sourceHeight - targetHeight (title bar + URL bar)
                    // We assume content is at bottom-left of the captured area
                    
                    const chromeHeight = sourceHeight - targetHeight;
                    const chromeWidth = sourceWidth - targetWidth;
                    
                    // Crop from top (browser chrome) and right (if any extra width)
                    let cropLeft = 0;
                    let cropTop = Math.max(0, chromeHeight);  // Crop browser title bar/URL bar
                    let cropRight = Math.max(0, chromeWidth);
                    let cropBottom = 0;
                    
                    console.log('OBS: Calculated browser chrome:', {
                        chromeHeight, chromeWidth,
                        cropTop, cropRight,
                        resultWidth: sourceWidth - cropLeft - cropRight,
                        resultHeight: sourceHeight - cropTop - cropBottom
                    });
                    
                    // Apply crop transform
                    const transformSettings = {
                        positionX: 0,
                        positionY: 0,
                        alignment: 5,  // top-left anchor
                        scaleX: 1,
                        scaleY: 1,
                        cropLeft: cropLeft,
                        cropTop: cropTop,
                        cropRight: cropRight,
                        cropBottom: cropBottom,
                        boundsType: 'OBS_BOUNDS_NONE'
                    };
                    
                    console.log('OBS: Applying transform:', transformSettings);
                    await this.setSceneItemTransform(sceneName, result.sceneItemId, transformSettings);
                    
                    // Verify transform
                    const afterTransform = await this.getSceneItemTransform(sceneName, result.sceneItemId);
                    const t = afterTransform.sceneItemTransform || afterTransform;
                    console.log('OBS: Transform applied:', { 
                        cropLeft: t.cropLeft,
                        cropTop: t.cropTop,
                        cropRight: t.cropRight,
                        cropBottom: t.cropBottom,
                        width: t.width,
                        height: t.height
                    });
                } else {
                    result.errors.push('Could not determine source dimensions. Please try again.');
                }
                
                // Step 5: Set canvas size to target dimensions
                try {
                    // Ensure even dimensions (required by video codecs)
                    const canvasWidth = Math.round(targetWidth / 2) * 2;
                    const canvasHeight = Math.round(targetHeight / 2) * 2;
                    
                    await this.setVideoSettings({
                        baseWidth: canvasWidth,
                        baseHeight: canvasHeight,
                        outputWidth: canvasWidth,
                        outputHeight: canvasHeight
                    });
                    console.log('OBS: Set canvas size to', canvasWidth, 'x', canvasHeight);
                } catch (e) {
                    console.warn('OBS: Could not set canvas size', e);
                    result.errors.push('Could not set canvas size: ' + e.message);
                }
            }

            // Ensure we're on the right scene
            await this.setCurrentScene(sceneName);

            result.success = result.errors.length === 0;

        } catch (error) {
            console.error('OBS: Setup failed', error);
            result.errors.push(error.message);
            
            // Try to switch to scene even on error
            try {
                await this.setCurrentScene(sceneName);
            } catch (switchError) {
                console.warn('OBS: Could not switch to scene:', switchError.message);
            }
        }

        return result;
    }
    /**
     * Get OBS version info
     */
    async getVersion() {
        return await this.sendRequest('GetVersion');
    }

    /**
     * Check if OBS is recording
     */
    async isRecording() {
        const status = await this.getRecordStatus();
        return status.outputActive;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OBSConnector;
}
