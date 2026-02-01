// Authentication module
class Auth {
  constructor() {
    this.currentUser = null;
  }

  async loginWithTwitch() {
    try {
      console.log('Starting Twitch OAuth login...');
      
      // Use the new unified OAuth flow from preload
      if (!window.electronAPI.startTwitchAuth) {
        console.error('startTwitchAuth API not available');
        throw new Error('OAuth not available. Please restart the app.');
      }
      
      window.utils?.showToast?.('Opening Twitch login window...', 'info');
      
      const result = await window.electronAPI.startTwitchAuth();
      console.log('Auth result:', result);
      
      if (result && result.username) {
        const account = {
          username: result.username,
          avatar: result.avatar || '',
          cookies: result.cookies,
          loginMethod: 'oauth',
          addedAt: Date.now(),
          lastLogin: Date.now()
        };
        
        await Storage.saveAccount(account);
        console.log('Account saved successfully');
        return account;
      } else {
        throw new Error('Could not get username from Twitch');
      }
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async loginWithCookies(cookies) {
    // Validate cookies by checking Twitch API
    try {
      // This would normally validate the cookies
      // For now, we'll just save them
      const username = prompt('Enter your Twitch username:');
      
      if (!username) {
        throw new Error('Username is required');
      }

      const account = {
        username,
        avatar: '',
        cookies,
        loginMethod: 'cookies',
        addedAt: Date.now(),
        lastLogin: Date.now()
      };

      await Storage.saveAccount(account);
      return account;
    } catch (error) {
      throw error;
    }
  }

  async loadSavedAccounts() {
    const accounts = await Storage.getAccounts();
    if (accounts.length > 0) {
      this.currentUser = accounts[0];
      console.log('Loaded saved account:', this.currentUser.username);
    }
    return accounts;
  }

  async logout(username) {
    await Storage.removeAccount(username);
    if (this.currentUser && this.currentUser.username === username) {
      this.currentUser = null;
    }
  }

  async getCurrentAccount() {
    const accounts = await Storage.getAccounts();
    return accounts[0] || null;
  }
}

// Initialize global auth instance
if (!window.auth) {
  window.auth = new Auth();
}
