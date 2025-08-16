// websocket-helpers.js - Enhanced WebSocket IP Detection for Synchronet BBS
// Improved version with better error handling, caching, and multiple detection methods

load('sbbsdefs.js');

/**
 * WebSocket IP Detection Module
 * Provides multiple methods to detect real client IP addresses
 * through WebSocket proxies and telnet gateways
 */
const WebSocketHelpers = (function() {
  
  // Cache for performance
  const cache = {
    lastIP: null,
    lastCheck: 0,
    cacheDuration: 60000 // 1 minute cache
  };
  
  // Configuration
  const config = {
    defaultTimeout: 1.0,
    maxRetries: 2,
    enableLogging: true,
    logLevel: LOG_DEBUG
  };
  
  /**
   * Safe logging wrapper
   */
  function safeLog(level, message) {
    if (config.enableLogging) {
      try {
        log(level, "WebSocketHelpers: " + message);
      } catch(e) {}
    }
  }
  
  /**
   * Check if we're in a valid telnet session
   */
  function isValidTelnetSession() {
    return (
      typeof client !== 'undefined' &&
      client &&
      client.protocol === 'Telnet' &&
      client.socket &&
      typeof client.socket.data_waiting !== 'undefined' &&
      typeof client.socket.recvBin === 'function' &&
      typeof console.telnet_cmd === 'function'
    );
  }
  
  /**
   * Parse IP address bytes to string
   */
  function bytesToIP(bytes) {
    if (!bytes || bytes.length !== 4) return null;
    
    // Validate each octet
    for (let i = 0; i < 4; i++) {
      if (bytes[i] < 0 || bytes[i] > 255) return null;
    }
    
    return bytes.join('.');
  }
  
  /**
   * Check if IP looks like a public address
   */
  function isPublicIP(ip) {
    if (!ip) return false;
    
    const privateRanges = [
      /^10\./,                        // 10.0.0.0/8
      /^192\.168\./,                  // 192.168.0.0/16
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^127\./,                        // 127.0.0.0/8 (loopback)
      /^169\.254\./,                   // 169.254.0.0/16 (link-local)
      /^::1$/,                         // IPv6 loopback
      /^fe80:/i,                       // IPv6 link-local
      /^fc00:/i,                       // IPv6 unique local
      /^fd00:/i                        // IPv6 unique local
    ];
    
    for (let range of privateRanges) {
      if (range.test(ip)) return false;
    }
    
    return true;
  }
  
  /**
   * Validate IP address format
   */
  function isValidIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    // IPv4 validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(ip)) {
      const octets = ip.split('.').map(Number);
      return octets.every(o => o >= 0 && o <= 255);
    }
    
    // Basic IPv6 validation
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv6Regex.test(ip);
  }
  
  /**
   * Enhanced TTYLOC implementation with better error recovery
   */
  function wstsGetIPAddress(timeoutSeconds) {
    // Check cache first
    const now = Date.now();
    if (cache.lastIP && (now - cache.lastCheck) < cache.cacheDuration) {
      safeLog(LOG_DEBUG, "Returning cached IP: " + cache.lastIP);
      return cache.lastIP;
    }
    
    if (!isValidTelnetSession()) {
      safeLog(LOG_DEBUG, "Not a valid Telnet session");
      return undefined;
    }
    
    const timeout = (typeof timeoutSeconds === 'number' && timeoutSeconds > 0) 
      ? timeoutSeconds 
      : config.defaultTimeout;
    
    let attempt = 0;
    let lastError = null;
    
    while (attempt < config.maxRetries) {
      try {
        const ip = attemptTTYLOC(timeout);
        if (ip) {
          // Cache successful result
          cache.lastIP = ip;
          cache.lastCheck = now;
          safeLog(LOG_INFO, "Successfully detected IP: " + ip);
          return ip;
        }
      } catch (err) {
        lastError = err;
        safeLog(LOG_DEBUG, "TTYLOC attempt " + (attempt + 1) + " failed: " + err);
      }
      
      attempt++;
      if (attempt < config.maxRetries) {
        mswait(100); // Brief delay before retry
      }
    }
    
    if (lastError) {
      safeLog(LOG_WARNING, "All TTYLOC attempts failed: " + lastError);
    }
    
    return undefined;
  }
  
  /**
   * Single TTYLOC attempt
   */
  function attemptTTYLOC(timeout) {
    const data = [];
    let inputLocked = false;
    
    try {
      // Lock console input
      console.lock_input(true);
      inputLocked = true;
      
      // Clear any pending data
      while (client.socket.data_waiting) {
        client.socket.recvBin(1);
      }
      
      // Send IAC DO TTYLOC (255 253 28)
      console.telnet_cmd(253, 28);
      
      const start = system.timer;
      let iacSeen = false;
      let sbSeen = false;
      
      // Read response with state machine
      while (system.timer - start < timeout) {
        if (!client.socket.data_waiting) {
          mswait(10); // Small delay to prevent busy loop
          continue;
        }
        
        const b = client.socket.recvBin(1);
        if (typeof b !== 'number') continue;
        
        data.push(b);
        
        // Look for IAC SE (255 240) to end subnegotiation
        if (data.length >= 2 && 
            data[data.length - 2] === 255 && 
            data[data.length - 1] === 240) {
          break;
        }
        
        // Prevent runaway reads
        if (data.length > 100) {
          throw "Response too long";
        }
      }
      
      // Validate response structure
      if (data.length < 14) {
        throw "Response too short";
      }
      
      if (data[0] !== 255 || // IAC
          data[1] !== 250 || // SB
          data[2] !== 28 ||  // TTYLOC
          data[3] !== 0 ||   // FORMAT (binary)
          data[data.length - 2] !== 255 || // IAC
          data[data.length - 1] !== 240) { // SE
        throw "Invalid TTYLOC response structure";
      }
      
      // Extract IP bytes (un-stuff IAC doubles)
      const ipBytes = [];
      for (let i = 4; i < data.length - 2; i++) {
        ipBytes.push(data[i]);
        if (data[i] === 255 && i + 1 < data.length - 2 && data[i + 1] === 255) {
          i++; // Skip doubled IAC
        }
      }
      
      if (ipBytes.length !== 8) {
        throw "Invalid TTYLOC payload length: " + ipBytes.length;
      }
      
      // Extract local and remote IPs
      const localIP = bytesToIP(ipBytes.slice(0, 4));
      const remoteIP = bytesToIP(ipBytes.slice(4, 8));
      
      // Prefer public IP (some proxies reverse the order)
      if (isPublicIP(remoteIP)) return remoteIP;
      if (isPublicIP(localIP)) return localIP;
      
      // Return remote IP as fallback
      return remoteIP || localIP;
      
    } finally {
      // Always unlock input
      if (inputLocked) {
        try {
          console.lock_input(false);
        } catch(e) {}
      }
    }
  }
  
  /**
   * Enhanced V4 Web UI file reader with validation
   */
  function wsrsGetIPAddress() {
    // Check if user object exists
    if (typeof user === 'undefined' || !user || !user.number) {
      safeLog(LOG_DEBUG, "No user object available");
      return undefined;
    }
    
    const filename = format('%suser/%04d.web', system.data_dir, user.number);
    
    if (!file_exists(filename)) {
      safeLog(LOG_DEBUG, "Web session file not found: " + filename);
      return undefined;
    }
    
    const file = new File(filename);
    if (!file.open('r')) {
      safeLog(LOG_WARNING, "Failed to open web session file: " + filename);
      return undefined;
    }
    
    try {
      const session = file.iniGetObject();
      
      if (!session || !session.ip_address) {
        safeLog(LOG_DEBUG, "No IP address in web session file");
        return undefined;
      }
      
      // Validate the IP
      if (!isValidIP(session.ip_address)) {
        safeLog(LOG_WARNING, "Invalid IP in web session: " + session.ip_address);
        return undefined;
      }
      
      safeLog(LOG_INFO, "Found IP from web session: " + session.ip_address);
      return session.ip_address;
      
    } catch(err) {
      safeLog(LOG_ERROR, "Error reading web session: " + err);
      return undefined;
      
    } finally {
      file.close();
    }
  }
  
  /**
   * Try to detect IP from environment variables (for some proxies)
   */
  function getIPFromEnvironment() {
    const envVars = [
      'HTTP_X_FORWARDED_FOR',
      'HTTP_X_REAL_IP',
      'HTTP_CLIENT_IP',
      'REMOTE_ADDR'
    ];
    
    for (let varName of envVars) {
      try {
        const value = system.get_env(varName);
        if (value) {
          // X-Forwarded-For can contain multiple IPs
          const ip = value.split(',')[0].trim();
          if (isValidIP(ip)) {
            safeLog(LOG_INFO, "Found IP from " + varName + ": " + ip);
            return ip;
          }
        }
      } catch(e) {}
    }
    
    return undefined;
  }
  
  /**
   * Master function to get client IP using all available methods
   */
  function getClientIP(options) {
    options = options || {};
    const timeout = options.timeout || config.defaultTimeout;
    
    // Try methods in order of preference
    const methods = [
      { name: "TTYLOC", fn: () => wstsGetIPAddress(timeout) },
      { name: "WebSession", fn: wsrsGetIPAddress },
      { name: "Environment", fn: getIPFromEnvironment }
    ];
    
    if (options.skipTTYLOC) {
      methods.shift(); // Remove TTYLOC method
    }
    
    for (let method of methods) {
      try {
        const ip = method.fn();
        if (ip) {
          safeLog(LOG_INFO, "Got IP via " + method.name + ": " + ip);
          return ip;
        }
      } catch(err) {
        safeLog(LOG_DEBUG, method.name + " failed: " + err);
      }
    }
    
    // Fallback to socket remote_ip_address if available
    try {
      if (client && client.socket && client.socket.remote_ip_address) {
        const ip = client.socket.remote_ip_address;
        if (isValidIP(ip)) {
          safeLog(LOG_INFO, "Using socket remote IP: " + ip);
          return ip;
        }
      }
    } catch(e) {}
    
    safeLog(LOG_WARNING, "Could not detect client IP");
    return undefined;
  }
  
  /**
   * Get geolocation info for an IP (requires external service)
   */
  function getIPLocation(ip) {
    if (!ip || !isValidIP(ip)) return null;
    
    try {
      // This would need an actual geolocation service
      // Placeholder for future enhancement
      return {
        ip: ip,
        country: "US",
        region: "Unknown",
        city: "Unknown"
      };
    } catch(e) {
      return null;
    }
  }
  
  /**
   * Clear the IP cache
   */
  function clearCache() {
    cache.lastIP = null;
    cache.lastCheck = 0;
    safeLog(LOG_DEBUG, "Cache cleared");
  }
  
  /**
   * Configure the module
   */
  function configure(options) {
    if (options.timeout !== undefined) {
      config.defaultTimeout = options.timeout;
    }
    if (options.retries !== undefined) {
      config.maxRetries = options.retries;
    }
    if (options.logging !== undefined) {
      config.enableLogging = options.logging;
    }
    if (options.logLevel !== undefined) {
      config.logLevel = options.logLevel;
    }
  }
  
  // Public API
  return {
    // Original functions for compatibility
    wstsGetIPAddress: wstsGetIPAddress,
    wsrsGetIPAddress: wsrsGetIPAddress,
    
    // New enhanced functions
    getClientIP: getClientIP,
    getIPLocation: getIPLocation,
    isPublicIP: isPublicIP,
    isValidIP: isValidIP,
    clearCache: clearCache,
    configure: configure,
    
    // Utility exports
    utils: {
      bytesToIP: bytesToIP,
      isPublicIP: isPublicIP,
      isValidIP: isValidIP
    }
  };
})();

// Export for compatibility with existing code
const wstsGetIPAddress = WebSocketHelpers.wstsGetIPAddress;
const wsrsGetIPAddress = WebSocketHelpers.wsrsGetIPAddress;

// Also export the enhanced module
this.WebSocketHelpers = WebSocketHelpers;